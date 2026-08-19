#!/usr/bin/env node
// Quest City Web — CI dependency/CVE gate (Tranche E design report §36;
// mission §25). Wraps `pnpm audit --json` with: a fixed blocking severity
// threshold (CRITICAL/HIGH — design report §36), and a documented,
// time-boxed exception list (tools/audit-exceptions.json) rather than
// silent suppression. No new runtime dependency is introduced — this
// parses pnpm's own `--json` output, piped in on stdin, with the same
// "deliberately small and auditable" discipline as tools/migrate.mjs.
//
// Usage:
//   pnpm audit --json --audit-level=high | node tools/check-dependency-audit.mjs
//
// Exit code: 0 if nothing blocking remains after exceptions are applied,
// 1 otherwise. Also exits 1 if an exception entry has expired — an
// expired exception is treated as "no exception", not "still valid".

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const EXCEPTIONS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "audit-exceptions.json");

/**
 * Tolerant extraction of findings from pnpm/npm audit JSON — the exact
 * shape has varied across pnpm versions, so this accepts either the
 * npm-style `{ advisories: { [id]: {...} } }` shape or a `vulnerabilities`
 * map, and normalizes to `{ id, severity, moduleName }[]`. Exported for
 * unit testing against fixtures rather than a live registry call.
 */
export function extractFindings(auditJson) {
  const findings = [];
  if (auditJson.advisories && typeof auditJson.advisories === "object") {
    for (const advisory of Object.values(auditJson.advisories)) {
      findings.push({
        id: String(advisory.id ?? advisory.github_advisory_id ?? advisory.url ?? "unknown"),
        severity: String(advisory.severity ?? "unknown").toLowerCase(),
        moduleName: advisory.module_name ?? advisory.name ?? "unknown",
      });
    }
  }
  if (auditJson.vulnerabilities && typeof auditJson.vulnerabilities === "object") {
    for (const [moduleName, vuln] of Object.entries(auditJson.vulnerabilities)) {
      const via = Array.isArray(vuln.via) ? vuln.via : [vuln.via];
      for (const entry of via) {
        if (typeof entry === "object" && entry !== null) {
          findings.push({
            id: String(entry.source ?? entry.url ?? `${moduleName}-${entry.title ?? "unknown"}`),
            severity: String(vuln.severity ?? "unknown").toLowerCase(),
            moduleName,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Filters findings against the exception list. An exception matches by
 * `id` (advisory id) OR `moduleName`, and only applies if `expiresOn`
 * (ISO date string) is in the future relative to `now`. Exported for unit
 * testing.
 */
export function applyExceptions(findings, exceptions, now = new Date()) {
  const survivors = [];
  const applied = [];
  for (const finding of findings) {
    const match = exceptions.find(
      (exception) => exception.id === finding.id || exception.moduleName === finding.moduleName,
    );
    if (match) {
      const expiresOn = new Date(match.expiresOn);
      if (!Number.isNaN(expiresOn.getTime()) && expiresOn.getTime() > now.getTime()) {
        applied.push({ finding, exception: match });
        continue;
      }
    }
    survivors.push(finding);
  }
  return { survivors, applied };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.log("No audit output received on stdin — nothing to check.");
    return;
  }

  let auditJson;
  try {
    auditJson = JSON.parse(raw);
  } catch {
    // pnpm audit sometimes emits non-JSON diagnostic lines before the JSON
    // payload; try the last line as a fallback before giving up.
    const lastLine = raw.trim().split("\n").pop();
    auditJson = JSON.parse(lastLine);
  }

  const exceptionsFile = JSON.parse(await readFile(EXCEPTIONS_PATH, "utf8"));
  const findings = extractFindings(auditJson).filter((f) => BLOCKING_SEVERITIES.has(f.severity));
  const { survivors, applied } = applyExceptions(findings, exceptionsFile.exceptions ?? []);

  for (const { finding, exception } of applied) {
    console.log(`Exception applied: ${finding.id} (${finding.moduleName}, ${finding.severity}) — ${exception.justification} (expires ${exception.expiresOn})`);
  }

  if (survivors.length > 0) {
    console.error(`${survivors.length} blocking (HIGH/CRITICAL) dependency finding(s) with no valid exception:`);
    for (const finding of survivors) {
      console.error(`  - [${finding.severity.toUpperCase()}] ${finding.moduleName} (${finding.id})`);
    }
    console.error("Add a time-boxed, justified entry to tools/audit-exceptions.json only if this is a genuine false positive or an accepted, tracked risk — never to silence a real finding.");
    process.exitCode = 1;
    return;
  }

  console.log("Dependency audit gate PASSED — no unresolved HIGH/CRITICAL findings.");
}

// Cross-platform entrypoint check -- comparing import.meta.url against
// a raw `file://${process.argv[1]}` string breaks on Windows (backslash
// paths, no triple-slash prefix), silently causing main() to never run
// when this script is invoked directly with plain `node script.mjs`.
// Resolving both sides to real filesystem paths is safe on every platform.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
