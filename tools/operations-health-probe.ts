#!/usr/bin/env -S npx tsx
// Master Admin Operations Control Center -- local metric collector +
// health probe (02_42 v1.1 §20, mission §20/§26/§55). Intended to run on
// a schedule (cron/systemd timer), mirroring the pattern already
// established by quest-city-web's own prior staging health-check
// tooling. Local-first: reads host CPU/RAM/disk via safe Node runtime
// APIs only -- never a shell command, never a Docker socket.
//
// Usage: DATABASE_URL=postgresql://... npx tsx tools/operations-health-probe.ts

import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";
import {
  HealthProbeService,
  PresenceService,
  OperationalMetricSampleRepository,
  LocalMockAlertChannelAdapter,
  TelegramAlertChannelAdapter,
  collectHostMetrics,
  type AlertChannelAdapter,
} from "@quest-city-web/operations";

const RETENTION_DAYS = Number.parseInt(process.env.OPERATIONS_METRIC_RETENTION_DAYS ?? "30", 10);

function getAdapter(): AlertChannelAdapter {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return botToken && chatId ? new TelegramAlertChannelAdapter({ botToken, chatId }) : new LocalMockAlertChannelAdapter();
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // 1. Service health probes (API self-check, Postgres SELECT 1) --
    // reconciles operational_incident state and evaluates Telegram
    // escalation (02_42 §21-27).
    const healthProbe = new HealthProbeService(pool, getAdapter());
    const health = await healthProbe.runProbes();
    console.log(JSON.stringify({ step: "health", ...health }));

    // 2. Host metrics (CPU/RAM/disk) -- local-first collector (02_42 §20).
    const metrics = new OperationalMetricSampleRepository(pool);
    const hostSamples = await collectHostMetrics(process.env.OPERATIONS_DISK_PATH ?? "/");
    for (const sample of hostSamples) {
      await metrics.record({ source: "HOST", ...sample });
    }
    console.log(JSON.stringify({ step: "host_metrics", samples: hostSamples }));

    // 3. Concurrency snapshot -- feeds the peak-24h/7d/30d KPI queries
    // (02_42 §17), never recomputed from raw presence history.
    const presence = new PresenceService(pool);
    const counts = await presence.concurrentCounts();
    await metrics.record({ source: "APPLICATION", metricKey: "concurrent_students", value: counts.concurrentStudents, unit: "count", status: "OK" });
    await metrics.record({ source: "APPLICATION", metricKey: "concurrent_staff", value: counts.concurrentStaff, unit: "count", status: "OK" });
    await metrics.record({ source: "APPLICATION", metricKey: "concurrent_total", value: counts.concurrentTotal, unit: "count", status: "OK" });
    console.log(JSON.stringify({ step: "concurrency", ...counts }));

    // 4. Bounded retention (02_42 §45) -- pruning is caller-driven, never
    // automatic on a read path.
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const pruned = await metrics.pruneOlderThan(cutoff);
    console.log(JSON.stringify({ step: "retention_prune", prunedRows: pruned, cutoff: cutoff.toISOString() }));
  } finally {
    await pool.end();
  }
}

// Cross-platform entrypoint check -- comparing import.meta.url against a
// raw `file://${process.argv[1]}` string breaks on Windows (backslash
// paths, no triple-slash prefix), silently causing main() to never run.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "failure", error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
