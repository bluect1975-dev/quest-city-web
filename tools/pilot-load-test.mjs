#!/usr/bin/env node
// Pilot load/capacity acceptance tool (Tranche F, mission §7-13). Simulates
// a realistic classroom access pattern (jittered login burst + warm-session
// activity) against a REAL target -- staging today, never local/CI, never
// production without a separately authorized run. Reads synthetic student
// credentials from a `tools/seed-pilot.ts` --out secrets file; never prints
// a class code, alias or PIN to stdout/stderr/the report.
//
// Usage:
//   node tools/pilot-load-test.mjs --base-url https://staging.questcity.net \
//     --secrets /path/to/pilot-seed-secrets.json --concurrency 25 \
//     --ramp-seconds 120 --warm-seconds 180 --scenario L3 [--out report.json]
//
// Each virtual student: (1) resolve the class code (pre-auth, mirrors the
// real login page's first call), (2) session/start with alias+pin, (3) a
// handful of authenticated read calls spaced over the warm window, mirroring
// `/w/home` polling + a progress check, not a synthetic HTTP hammer.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    baseUrl: null,
    secretsPath: null,
    concurrency: 5,
    rampSeconds: 30,
    warmSeconds: 60,
    warmIntervalSeconds: 20,
    scenario: "L1",
    outPath: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      out.baseUrl = argv[i += 1];
    } else if (arg === "--secrets" && argv[i + 1]) {
      out.secretsPath = argv[i += 1];
    } else if (arg === "--concurrency" && argv[i + 1]) {
      out.concurrency = Number.parseInt(argv[i += 1], 10);
    } else if (arg === "--ramp-seconds" && argv[i + 1]) {
      out.rampSeconds = Number.parseInt(argv[i += 1], 10);
    } else if (arg === "--warm-seconds" && argv[i + 1]) {
      out.warmSeconds = Number.parseInt(argv[i += 1], 10);
    } else if (arg === "--warm-interval-seconds" && argv[i + 1]) {
      out.warmIntervalSeconds = Number.parseInt(argv[i += 1], 10);
    } else if (arg === "--scenario" && argv[i + 1]) {
      out.scenario = argv[i += 1];
    } else if (arg === "--out" && argv[i + 1]) {
      out.outPath = argv[i += 1];
    }
  }
  if (!out.baseUrl) throw new Error("--base-url is required");
  if (!out.secretsPath) throw new Error("--secrets is required");
  if (!Number.isFinite(out.concurrency) || out.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  return out;
}

function loadSecrets(secretsPath) {
  const raw = JSON.parse(readFileSync(secretsPath, "utf8"));
  if (!raw.class?.classCode || !Array.isArray(raw.enrollments)) {
    throw new Error("secrets file does not look like a tools/seed-pilot.ts --out file");
  }
  return raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sortedLatencies, p) {
  if (sortedLatencies.length === 0) return null;
  const idx = Math.min(sortedLatencies.length - 1, Math.ceil((p / 100) * sortedLatencies.length) - 1);
  return sortedLatencies[Math.max(0, idx)];
}

class Metrics {
  constructor() {
    this.samples = [];
  }

  record(name, status, ms, ok) {
    this.samples.push({ name, status, ms, ok, t: Date.now() });
  }

  summaryFor(filterFn) {
    const rows = filterFn ? this.samples.filter(filterFn) : this.samples;
    const latencies = rows.map((r) => r.ms).sort((a, b) => a - b);
    const byStatus = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }
    const errors = rows.filter((r) => !r.ok);
    return {
      requests: rows.length,
      successRate: rows.length ? (rows.length - errors.length) / rows.length : null,
      errorCount: errors.length,
      statusBreakdown: byStatus,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      minMs: latencies[0] ?? null,
      maxMs: latencies[latencies.length - 1] ?? null,
    };
  }
}

async function timedFetch(metrics, name, url, init) {
  const start = performance.now();
  let status = 0;
  let ok = false;
  let body = null;
  let headers = null;
  try {
    const res = await fetch(url, init);
    status = res.status;
    ok = res.status < 500 || res.status === 429 || res.status === 409 || res.status === 404;
    // Note: 4xx (including 401/403/404/409/429) counts as a "handled" HTTP
    // outcome for load-test purposes, not an infrastructure error -- the
    // load test measures capacity/stability, not functional correctness
    // (that is Part B/C/H's job). Only 5xx and network failures are "errors".
    ok = res.status < 500;
    headers = res.headers;
    body = await res.text();
  } catch (error) {
    status = 0;
    ok = false;
    body = String(error?.message ?? error);
  }
  const ms = performance.now() - start;
  metrics.record(name, status, ms, ok);
  return { status, ms, body, headers };
}

function extractSetCookie(headers) {
  if (!headers) return null;
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  if (!raw || raw.length === 0) return null;
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function runVirtualStudent({ baseUrl, secrets, enrollment, metrics, warmSeconds, warmIntervalSeconds }) {
  const classCode = secrets.class.classCode;

  await timedFetch(metrics, "class-code-resolve", `${baseUrl}/api/web-auth/class-code/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ classCode }),
  });

  const startResult = await timedFetch(metrics, "session-start", `${baseUrl}/api/web-auth/session/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ classCode, accessAlias: enrollment.accessAlias, pin: enrollment.pin }),
  });

  if (startResult.status !== 200) {
    // Login itself failed (rate-limited, invalid credentials, 5xx) -- no
    // point simulating an authenticated session for this virtual user.
    return;
  }

  let cookie = extractSetCookie(startResult.headers);
  let csrfToken = null;
  try {
    csrfToken = JSON.parse(startResult.body)?.data?.csrfToken ?? null;
  } catch {
    csrfToken = null;
  }

  const authHeaders = () => ({
    cookie: cookie ?? "",
    ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
  });

  const deadline = Date.now() + warmSeconds * 1000;
  while (Date.now() < deadline) {
    const jitterMs = warmIntervalSeconds * 1000 * (0.5 + Math.random());
    await sleep(jitterMs);
    if (Date.now() >= deadline) break;
    await timedFetch(metrics, "student-context", `${baseUrl}/api/me/student-context`, {
      headers: authHeaders(),
    });
    await timedFetch(metrics, "progress-summary", `${baseUrl}/api/progress/summary`, {
      headers: authHeaders(),
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const secrets = loadSecrets(args.secretsPath);
  const pool = secrets.enrollments.slice(0, args.concurrency);
  if (pool.length < args.concurrency) {
    throw new Error(
      `secrets file only has ${secrets.enrollments.length} enrollment(s), fewer than --concurrency ${args.concurrency}`,
    );
  }

  const metrics = new Metrics();
  const wallStart = Date.now();

  console.log(
    `[pilot-load-test] scenario=${args.scenario} concurrency=${args.concurrency} ramp=${args.rampSeconds}s warm=${args.warmSeconds}s target=${args.baseUrl}`,
  );

  const tasks = pool.map((enrollment, i) => {
    const delayMs = pool.length > 1 ? (args.rampSeconds * 1000 * i) / (pool.length - 1) : 0;
    return sleep(delayMs).then(() =>
      runVirtualStudent({
        baseUrl: args.baseUrl,
        secrets,
        enrollment,
        metrics,
        warmSeconds: args.warmSeconds,
        warmIntervalSeconds: args.warmIntervalSeconds,
      }),
    );
  });

  await Promise.all(tasks);
  const wallSeconds = (Date.now() - wallStart) / 1000;

  const report = {
    scenario: args.scenario,
    baseUrl: args.baseUrl,
    concurrency: args.concurrency,
    rampSeconds: args.rampSeconds,
    warmSeconds: args.warmSeconds,
    wallSeconds,
    overall: metrics.summaryFor(),
    byEndpoint: Object.fromEntries(
      [...new Set(metrics.samples.map((s) => s.name))].map((name) => [name, metrics.summaryFor((s) => s.name === name)]),
    ),
  };

  console.log(JSON.stringify(report, null, 2));
  if (args.outPath) {
    writeFileSync(args.outPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`[pilot-load-test] report written to ${args.outPath}`);
  }
}

const isMainModule = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { Metrics, percentile, extractSetCookie };
