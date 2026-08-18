#!/usr/bin/env node
// Quest City Web — staging monitoring checks (Tranche E design report §27;
// mission §23: "minimum monitoring for public uptime, /api/health/live,
// /api/health/ready, DB availability, HTTP errors, disk, CPU, RAM, backup
// result, TLS certificate expiry. Avoid enterprise APM overbuild.")
//
// Runs each check, prints a structured JSON summary, and delivers an alert
// (design report §28 thresholds) to a configurable webhook if one is set —
// or logs only, never a hardcoded destination (mission §24: "No secret
// webhook committed"). Intended to run on a schedule (cron/systemd timer)
// against a running staging deployment — this script does not start or
// manage the application itself.
//
// Usage: node tools/staging-healthcheck.mjs

import { statfs } from "node:fs/promises";
import tls from "node:tls";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { getBackupTargetAdapter } from "./staging-backup-target-adapter.mjs";
import { parseBackupDate } from "./backup-staging-db.mjs";

async function checkHttp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message ?? String(error) };
  }
}

/** Node's fs.statfs (Linux) — no shelling out to `df`. Returns null where unsupported (e.g. non-Linux dev machines). */
export async function checkDiskUsage(diskPath, thresholdPercent) {
  try {
    const stats = await statfs(diskPath);
    const totalBlocks = stats.blocks;
    const freeBlocks = stats.bfree;
    const usedPercent = totalBlocks > 0 ? Math.round(((totalBlocks - freeBlocks) / totalBlocks) * 100) : 0;
    return { ok: usedPercent < thresholdPercent, usedPercent, thresholdPercent };
  } catch (error) {
    return { ok: null, error: error.message ?? String(error), note: "statfs unsupported on this platform" };
  }
}

/** Fetches the leaf TLS certificate and reports days until expiry. Exported for unit testing with a fake connector. */
export function daysUntilExpiry(validToDate, now = new Date()) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((validToDate.getTime() - now.getTime()) / msPerDay);
}

async function checkCertExpiry(hostname, port, alertDays) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) {
        resolve({ ok: false, error: "no certificate returned" });
        return;
      }
      const days = daysUntilExpiry(new Date(cert.valid_to));
      resolve({ ok: days >= alertDays, daysUntilExpiry: days });
    });
    socket.on("error", (error) => resolve({ ok: false, error: error.message ?? String(error) }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, error: "TLS connection timed out" });
    });
  });
}

/** Age (in hours) of the most recent parseable backup found via the configured adapter. Null if none exist. */
export async function mostRecentBackupAgeHours(adapter, now = new Date()) {
  const identifiers = await adapter.list();
  const dates = identifiers.map((id) => parseBackupDate(id)).filter((d) => d !== null);
  if (dates.length === 0) return null;
  const mostRecent = dates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  return (now.getTime() - mostRecent.getTime()) / (1000 * 60 * 60);
}

async function deliverAlert(webhookUrl, payload) {
  if (!webhookUrl) {
    console.log("No STAGING_ALERT_WEBHOOK_URL configured — alert logged only:", JSON.stringify(payload));
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.error("Failed to deliver alert to webhook:", error.message ?? String(error));
  }
}

async function main() {
  const baseUrl = process.env.STAGING_HEALTH_BASE_URL;
  if (!baseUrl) throw new Error("STAGING_HEALTH_BASE_URL is required.");
  const diskPath = process.env.STAGING_DISK_PATH ?? "/";
  const diskThreshold = Number.parseInt(process.env.STAGING_DISK_ALERT_THRESHOLD_PERCENT ?? "85", 10);
  const certAlertDays = Number.parseInt(process.env.STAGING_CERT_EXPIRY_ALERT_DAYS ?? "14", 10);
  const webhookUrl = process.env.STAGING_ALERT_WEBHOOK_URL || null;
  const domain = new URL(baseUrl).hostname;

  const results = {
    timestamp: new Date().toISOString(),
    uptime: await checkHttp(`${baseUrl}/api/health/live`),
    readiness: await checkHttp(`${baseUrl}/api/health/ready`),
    disk: await checkDiskUsage(diskPath, diskThreshold),
    certExpiry: await checkCertExpiry(domain, 443, certAlertDays),
  };

  const adapter = getBackupTargetAdapter();
  const backupAgeHours = await mostRecentBackupAgeHours(adapter);
  // 26h tolerance on a 24h cadence — enough slack for reasonable job jitter
  // without masking a genuinely missed/failed backup run.
  results.backup = {
    ok: backupAgeHours !== null && backupAgeHours <= 26,
    ageHours: backupAgeHours,
  };

  const failing = Object.entries(results).filter(([key, value]) => key !== "timestamp" && value.ok === false);

  console.log(JSON.stringify(results, null, 2));

  if (failing.length > 0) {
    await deliverAlert(webhookUrl, {
      severity: "check-failed",
      failing: failing.map(([key]) => key),
      results,
    });
    process.exitCode = 1;
  }
}

// Cross-platform entrypoint check -- comparing import.meta.url against
// a raw `file://${process.argv[1]}` string breaks on Windows (backslash
// paths, no triple-slash prefix), silently causing main() to never run
// when this script is invoked directly with plain `node script.mjs`.
// Resolving both sides to real filesystem paths is safe on every platform.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "failure", error: error.message ?? String(error) }));
    process.exitCode = 1;
  });
}
