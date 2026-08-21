#!/usr/bin/env node
// Quest City Web — off-site backup storage usage alert (Tranche E3
// residual closure, requested directly by the operator after enabling
// Cloudflare R2: R2's free tier caps out at 10GB before billing kicks in,
// so this exists purely for cost control, not for GAP-02/07_06 compliance
// — it is not part of any canonical acceptance criterion.
//
// Sums the size of every object under BACKUP_S3_PREFIX in the configured
// bucket (same BACKUP_S3_* variables staging-backup-target-adapter.mjs's
// s3Adapter reads — no separate credential/config surface) and sends one
// Telegram message via the same alert channel the Master Admin Operations
// Control Center uses (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) when usage is
// at or above BACKUP_S3_STORAGE_ALERT_THRESHOLD_PERCENT of
// BACKUP_S3_STORAGE_LIMIT_BYTES. Provider-neutral: BACKUP_S3_STORAGE_LIMIT_BYTES
// defaults to 10 GiB (Cloudflare R2's free-tier ceiling) but is fully
// configurable for any other S3-compatible provider/plan.
//
// Intended to run on a low-frequency schedule (daily is plenty — backup
// storage does not grow minute to minute); see
// infrastructure/runbooks/03-backups.md for the systemd timer pattern
// this mirrors (disk-space-check.sh/.timer on the VPS).
//
// Usage: node tools/check-backup-storage-usage.mjs

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTelegramMessage } from "./external-uptime-monitor/level1-telegram.mjs";

const DEFAULT_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB — Cloudflare R2 free-tier ceiling
const DEFAULT_THRESHOLD_PERCENT = 90;

/**
 * Pure decision logic — exported for unit testing without touching S3 or
 * Telegram. `usedBytes` is the caller's already-summed total.
 */
export function evaluateStorageUsage({ usedBytes, limitBytes, thresholdPercent }) {
  const percent = limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0;
  return {
    usedBytes,
    limitBytes,
    percent,
    overThreshold: percent >= thresholdPercent,
  };
}

function formatGiB(bytes) {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/** Static, bounded alert text — no free text, no object keys/names, no secret. */
export function buildStorageAlertMessage({ bucket, usedBytes, limitBytes, percent, environment }) {
  return [
    "QUEST CITY ALERT — OFF-SITE BACKUP STORAGE",
    `Bucket: ${bucket}`,
    `Used: ${formatGiB(usedBytes)} / ${formatGiB(limitBytes)} (${percent.toFixed(1)}%)`,
    `Environment: ${environment.toLowerCase()}`,
    "Note: cost-control alert, not a governance/compliance signal.",
  ].join("\n");
}

async function sumBucketBytes({ client, bucket, prefix }) {
  let totalBytes = 0;
  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: continuationToken }),
    );
    for (const object of page.Contents ?? []) {
      totalBytes += object.Size ?? 0;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return totalBytes;
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required to check off-site backup storage usage.`);
  }
  return value;
}

async function main(env = process.env) {
  const bucket = requiredEnv(env, "BACKUP_S3_BUCKET");
  const endpoint = requiredEnv(env, "BACKUP_S3_ENDPOINT");
  const accessKeyId = requiredEnv(env, "BACKUP_S3_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv(env, "BACKUP_S3_SECRET_ACCESS_KEY");
  const region = env.BACKUP_S3_REGION ?? "auto";
  const prefix = env.BACKUP_S3_PREFIX ? `${env.BACKUP_S3_PREFIX.replace(/\/+$/, "")}/` : "";
  const limitBytes = env.BACKUP_S3_STORAGE_LIMIT_BYTES ? Number(env.BACKUP_S3_STORAGE_LIMIT_BYTES) : DEFAULT_LIMIT_BYTES;
  const thresholdPercent = env.BACKUP_S3_STORAGE_ALERT_THRESHOLD_PERCENT
    ? Number(env.BACKUP_S3_STORAGE_ALERT_THRESHOLD_PERCENT)
    : DEFAULT_THRESHOLD_PERCENT;

  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  const usedBytes = await sumBucketBytes({ client, bucket, prefix });
  const result = evaluateStorageUsage({ usedBytes, limitBytes, thresholdPercent });

  let telegramSent = false;
  if (result.overThreshold) {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const message = buildStorageAlertMessage({
        bucket,
        usedBytes: result.usedBytes,
        limitBytes: result.limitBytes,
        percent: result.percent,
        environment: env.NODE_ENV ?? "staging",
      });
      const sendResult = await sendTelegramMessage({ botToken, chatId, text: message });
      telegramSent = sendResult.ok;
    }
  }

  console.log(
    JSON.stringify({
      status: "checked",
      bucket,
      usedBytes: result.usedBytes,
      limitBytes: result.limitBytes,
      percent: Number(result.percent.toFixed(2)),
      overThreshold: result.overThreshold,
      telegramSent,
      timestamp: new Date().toISOString(),
    }),
  );
}

// Cross-platform entrypoint check -- comparing import.meta.url against
// a raw `file://${process.argv[1]}` string breaks on Windows (backslash
// paths, no triple-slash prefix), silently causing main() to never run.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.log(JSON.stringify({ status: "error", error: error.message, timestamp: new Date().toISOString() }));
    process.exitCode = 1;
  });
}
