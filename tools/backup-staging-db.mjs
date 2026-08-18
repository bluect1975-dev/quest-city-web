#!/usr/bin/env node
// Quest City Web — staging database backup (Tranche E design report §21-22;
// ACN/MePA Gap Analysis GAP-02). Pipeline: pg_dump -Fc (a real consistent
// logical snapshot, never a raw filesystem copy — mission §17: "Do not use
// a raw hot filesystem copy as the database backup") → sha256 checksum →
// AES-256-GCM encryption → upload via the configured target adapter →
// checksum verified post-upload → tiered retention enforced → status
// reported.
//
// Required env: DATABASE_URL, BACKUP_ENCRYPTION_KEY (32 random bytes,
// base64). Optional: BACKUP_TARGET_ADAPTER/BACKUP_TARGET_PATH (see
// staging-backup-target-adapter.mjs), BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY
// (design report §22 — product/operations targets, not legal requirements).
//
// Usage: node tools/backup-staging-db.mjs

import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBackupTargetAdapter } from "./staging-backup-target-adapter.mjs";

/**
 * Filename-safe stamp that embeds the epoch millis as an unambiguous,
 * trivially-reversible prefix (parseBackupDate below reads it back
 * directly — no ISO-string reconstruction/regex guessing), followed by a
 * human-readable ISO rendering for operators scanning a directory listing.
 */
function nowStamp(date = new Date()) {
  return `${date.getTime()}-${date.toISOString().replace(/[:.]/g, "-")}`;
}

function runPgDump(databaseUrl, outFile) {
  return new Promise((resolve, reject) => {
    // -Fc: custom format, compressed, restorable selectively with
    // pg_restore — a real consistent snapshot, not a text/SQL dump.
    const child = spawn("pg_dump", ["-Fc", "-f", outFile, databaseUrl], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
  });
}

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * AES-256-GCM: authenticated encryption, so tampering is detected at
 * decrypt time, not merely at checksum time. Output layout: 12-byte IV ||
 * 16-byte auth tag || ciphertext, all in one file — self-describing, no
 * separate metadata file that could go missing independently.
 */
async function encryptFile(sourcePath, destPath, keyB64) {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    throw new Error(`BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.length}.`);
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = await readFile(sourcePath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  await writeFile(destPath, Buffer.concat([iv, tag, ciphertext]));
}

/**
 * Tiered retention (design report §22): a backup survives if it is within
 * the daily window, OR it is the first backup of its ISO week and within
 * the weekly window (in weeks), OR the first backup of its month and
 * within the monthly window (in months). Everything else is pruned.
 * Exported for unit testing.
 */
export function shouldRetain(backupDate, now, retention) {
  const ageMs = now.getTime() - backupDate.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= retention.dailyDays) return true;

  const isFirstOfIsoWeek = backupDate.getUTCDay() === 1; // Monday
  const ageWeeks = ageDays / 7;
  if (isFirstOfIsoWeek && ageWeeks <= retention.weeklyWeeks) return true;

  const isFirstOfMonth = backupDate.getUTCDate() === 1;
  const ageMonths =
    (now.getUTCFullYear() - backupDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - backupDate.getUTCMonth());
  if (isFirstOfMonth && ageMonths <= retention.monthlyMonths) return true;

  return false;
}

/**
 * Parses the `qcweb-staging-<epochMillis>-<human-readable>.dump.enc` naming
 * convention back into a Date, reading the leading epoch-millis token
 * directly (no ISO-string reconstruction). Returns null if unparseable —
 * callers use this to skip files this script didn't create, never to
 * delete them.
 */
export function parseBackupDate(filename) {
  const match = /^qcweb-staging-(\d+)-/.exec(path.basename(filename));
  if (!match) return null;
  const date = new Date(Number.parseInt(match[1], 10));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function enforceRetention(adapter, retention, now) {
  const entries = await adapter.list();
  let removed = 0;
  for (const entry of entries) {
    const date = parseBackupDate(entry);
    if (!date) continue; // never delete files this script didn't create
    if (!shouldRetain(date, now, retention)) {
      await adapter.remove(entry);
      removed += 1;
    }
  }
  return removed;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("BACKUP_ENCRYPTION_KEY is required — see .env.staging.example.");

  const tempDir = await mkdtemp(path.join(tmpdir(), "qcweb-backup-"));
  const dumpPath = path.join(tempDir, "db.dump");
  const encryptedPath = path.join(tempDir, "db.dump.enc");

  try {
    console.log("Running pg_dump -Fc ...");
    await runPgDump(databaseUrl, dumpPath);
    const dumpStats = await stat(dumpPath);
    console.log(`Dump complete: ${dumpStats.size} bytes.`);

    const preEncryptChecksum = await sha256File(dumpPath);
    console.log(`Pre-encryption sha256: ${preEncryptChecksum}`);

    await encryptFile(dumpPath, encryptedPath, encryptionKey);
    const postEncryptChecksum = await sha256File(encryptedPath);
    console.log(`Post-encryption sha256: ${postEncryptChecksum}`);

    const adapter = getBackupTargetAdapter();
    const destName = `qcweb-staging-${nowStamp()}.dump.enc`;
    const destIdentifier = await adapter.upload(encryptedPath, destName);
    console.log(`Uploaded to: ${destIdentifier}`);

    // Sidecar checksum file: records the PRE-encryption (plaintext dump)
    // sha256, so restore-staging-db.mjs can verify the decrypted plaintext
    // matches what was actually dumped — a check GCM's own auth tag alone
    // does not give you (the auth tag proves the ciphertext wasn't
    // tampered with, not that it matches a specific known-good dump).
    const checksumSidecarPath = path.join(tempDir, "checksum.sha256");
    await writeFile(checksumSidecarPath, preEncryptChecksum);
    const checksumDestIdentifier = await adapter.upload(checksumSidecarPath, `${destName}.sha256`);
    console.log(`Checksum sidecar uploaded to: ${checksumDestIdentifier}`);

    // Verify post-upload: download it back and re-checksum, rather than
    // trusting that "upload succeeded" implies "bytes are intact".
    const verifyPath = path.join(tempDir, "verify.dump.enc");
    await adapter.download(destIdentifier, verifyPath);
    const verifyChecksum = await sha256File(verifyPath);
    if (verifyChecksum !== postEncryptChecksum) {
      throw new Error(
        `Post-upload checksum mismatch: uploaded ${postEncryptChecksum}, downloaded back ${verifyChecksum}. Backup is NOT trustworthy.`,
      );
    }
    console.log("Post-upload checksum verified — uploaded bytes match.");

    const retention = {
      dailyDays: Number.parseInt(process.env.BACKUP_RETENTION_DAILY ?? "14", 10),
      weeklyWeeks: Number.parseInt(process.env.BACKUP_RETENTION_WEEKLY ?? "8", 10),
      monthlyMonths: Number.parseInt(process.env.BACKUP_RETENTION_MONTHLY ?? "6", 10),
    };
    const removed = await enforceRetention(adapter, retention, new Date());
    console.log(`Retention enforced: ${removed} expired backup(s) removed.`);

    console.log(
      JSON.stringify({
        status: "success",
        destIdentifier,
        checksum: postEncryptChecksum,
        sizeBytes: dumpStats.size,
        timestamp: new Date().toISOString(),
      }),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
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
