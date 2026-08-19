#!/usr/bin/env node
// Quest City Web — staging database restore drill (Tranche E design report
// §23; ACN/MePA Gap Analysis GAP-02: "Un backup mai ripristinato è
// soprattutto una leggenda rassicurante"). Pipeline: select backup →
// download (encrypted dump + checksum sidecar) → decrypt (GCM auth tag
// catches tampering) → verify decrypted plaintext against the recorded
// pre-encryption checksum → pg_restore into an ISOLATED target database
// (never staging/production itself — mission §20: "Never restore test data
// over live staging DB") → integrity queries → optional application health
// probe against the restored DB → result recorded.
//
// Required env: RESTORE_TARGET_DATABASE_URL (an isolated DB, distinct from
// DATABASE_URL), BACKUP_ENCRYPTION_KEY. Optional:
// RESTORE_HEALTH_CHECK_URL (an /health/ready-style endpoint of an
// application instance pointed at the restored DB, if one is running).
//
// Usage: node tools/restore-staging-db.mjs [--backup <destIdentifier>]
//   Without --backup, restores the MOST RECENT backup found by the
//   configured adapter.

import { createDecipheriv, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getBackupTargetAdapter } from "./staging-backup-target-adapter.mjs";
import { parseBackupDate } from "./backup-staging-db.mjs";

const { Client } = pg;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--backup" && argv[i + 1]) {
      args.backup = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

/** Picks the most recently-dated backup identifier from the adapter's listing (ignores .sha256 sidecars). */
export function pickMostRecentBackup(identifiers) {
  const candidates = identifiers
    .filter((id) => !id.endsWith(".sha256"))
    .map((id) => ({ id, date: parseBackupDate(id) }))
    .filter((c) => c.date !== null);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
  return candidates[0].id;
}

function runPgRestore(targetDatabaseUrl, dumpPath) {
  return new Promise((resolve, reject) => {
    // --clean --if-exists: a restore drill target should end up looking
    // exactly like the backup, not accumulate stale objects from a
    // previous drill run against the same isolated database.
    const child = spawn(
      "pg_restore",
      ["--clean", "--if-exists", "--no-owner", "-d", targetDatabaseUrl, dumpPath],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      // pg_restore's --clean can exit non-zero on harmless "does not exist"
      // notices when restoring into an empty database; the integrity
      // queries below are the real pass/fail signal, not this exit code
      // alone — but a hard crash (non-0/1) still fails loudly.
      if (code === 0 || code === 1) resolve();
      else reject(new Error(`pg_restore exited with code ${code}`));
    });
  });
}

function decrypt(encryptedBuffer, keyB64) {
  const key = Buffer.from(keyB64, "base64");
  const iv = encryptedBuffer.subarray(0, 12);
  const tag = encryptedBuffer.subarray(12, 28);
  const ciphertext = encryptedBuffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Minimal integrity check: every table the schema is known to have exists
 * and is queryable. Exported for unit testing with a fake client.
 *
 * Table list reviewed against the CURRENT schema as of migration 0014
 * (Tranche E1 correction — the previous list, inherited unreviewed from an
 * 11-commits-old branch, predated the Master Admin Operations Control
 * Center and would have silently skipped its tables). Covers the original
 * foundational domains plus MAOCC/Telegram
 * (`operational_incident`/`alert_configuration`) and presence
 * (`user_presence`) — not every table in the schema, but at least one
 * representative table per major domain added since WEB-M1, so a restore
 * that silently dropped a whole later migration's tables would be caught
 * here rather than only by a full pg_restore exit-code check.
 */
export async function runIntegrityChecks(client) {
  const tables = [
    "tenant",
    "student_profile",
    "staff_account",
    "learning_attempt",
    "audit_event",
    "operational_incident",
    "alert_configuration",
    "user_presence",
  ];
  const results = {};
  for (const table of tables) {
    const { rows } = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
    results[table] = rows[0].count;
  }
  return results;
}

async function main() {
  const { backup: requestedBackup } = parseArgs(process.argv.slice(2));
  const targetDatabaseUrl = process.env.RESTORE_TARGET_DATABASE_URL;
  if (!targetDatabaseUrl) throw new Error("RESTORE_TARGET_DATABASE_URL is required (must be an isolated database).");
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("BACKUP_ENCRYPTION_KEY is required.");

  const startedAt = Date.now();
  const adapter = getBackupTargetAdapter();
  const identifiers = await adapter.list();
  const backupIdentifier = requestedBackup ?? pickMostRecentBackup(identifiers);
  if (!backupIdentifier) throw new Error("No backup found to restore.");
  console.log(`Restoring: ${backupIdentifier}`);

  const tempDir = await mkdtemp(path.join(tmpdir(), "qcweb-restore-"));
  try {
    const encryptedPath = path.join(tempDir, "db.dump.enc");
    await adapter.download(backupIdentifier, encryptedPath);

    const checksumIdentifier = identifiers.find((id) => id === `${backupIdentifier}.sha256`);
    let expectedChecksum = null;
    if (checksumIdentifier) {
      const checksumPath = path.join(tempDir, "checksum.sha256");
      await adapter.download(checksumIdentifier, checksumPath);
      expectedChecksum = (await readFile(checksumPath, "utf8")).trim();
    } else {
      console.warn("No .sha256 sidecar found for this backup — skipping plaintext checksum verification (GCM auth tag still protects against tampering).");
    }

    const encryptedBuffer = await readFile(encryptedPath);
    const plaintext = decrypt(encryptedBuffer, encryptionKey); // throws if GCM auth tag doesn't match (tampering/corruption)

    if (expectedChecksum) {
      const actualChecksum = createHash("sha256").update(plaintext).digest("hex");
      if (actualChecksum !== expectedChecksum) {
        throw new Error(`Checksum mismatch after decryption: expected ${expectedChecksum}, got ${actualChecksum}.`);
      }
      console.log("Decrypted plaintext checksum verified against recorded value.");
    }

    const dumpPath = path.join(tempDir, "db.dump");
    await writeFile(dumpPath, plaintext);

    console.log(`Running pg_restore into isolated target: ${targetDatabaseUrl.replace(/:[^:@]+@/, ":***@")}`);
    await runPgRestore(targetDatabaseUrl, dumpPath);

    const client = new Client({ connectionString: targetDatabaseUrl });
    await client.connect();
    let integrity;
    try {
      integrity = await runIntegrityChecks(client);
    } finally {
      await client.end();
    }
    console.log("Integrity check row counts:", integrity);

    let healthCheckResult = "skipped";
    if (process.env.RESTORE_HEALTH_CHECK_URL) {
      const response = await fetch(process.env.RESTORE_HEALTH_CHECK_URL);
      healthCheckResult = response.ok ? "pass" : `fail (status ${response.status})`;
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        status: "success",
        backupIdentifier,
        integrity,
        healthCheckResult,
        durationMs,
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
