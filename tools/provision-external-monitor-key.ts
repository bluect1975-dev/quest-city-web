#!/usr/bin/env -S npx tsx
// Tranche E2 Level 2 -- External Monitor M2M key metadata server-side
// provisioning (02_42 v1.2 §54; Security & Operations micro-closure
// mission §4). Wires the first/rotated `external_monitor_key_metadata`
// CURRENT row from server-side environment variables so live acceptance
// and staging/pilot deployment never require a manual SQL INSERT by an
// operator. Same discipline as tools/provision-telegram-alert-channel.ts:
// never reads, prints, or persists the actual EXTERNAL_MONITOR_HMAC_SECRET_*
// value -- only the key-id (a non-secret rotation label) is ever written
// to the database. Idempotent: safe to run on every deploy/bootstrap.
//
// EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT/_PREVIOUS are provisioning-only
// inputs, read directly from process.env here -- they are never part of
// apps/api's own ApiEnv/loadEnv() (the running API process never needs a
// key-id, only the secret bytes for whichever status a presented
// X-QC-Monitor-Key-Id resolves to; the key-id/status mapping lives
// entirely in external_monitor_key_metadata, looked up by keyId).
//
// Usage: DATABASE_URL=postgresql://... \
//   EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT=... EXTERNAL_MONITOR_HMAC_SECRET_CURRENT=... \
//   [EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS=... EXTERNAL_MONITOR_HMAC_SECRET_PREVIOUS=...] \
//   pnpm --filter @quest-city-web/tools run provision:external-monitor-key

import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
const { Pool } = pg;
import { ExternalMonitorKeyMetadataRepository } from "@quest-city-web/operations";

function requireBothOrNeither(idKey: string, idValue: string | undefined, secretKey: string, secretValue: string | undefined): void {
  if (Boolean(idValue) !== Boolean(secretValue)) {
    const missing = idValue ? secretKey : idKey;
    throw new Error(`Incomplete external monitor key configuration: ${missing} is not set while its counterpart is. Set both or neither.`);
  }
}

export async function main(): Promise<void> {
  const currentKeyId = process.env.EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT;
  const currentSecret = process.env.EXTERNAL_MONITOR_HMAC_SECRET_CURRENT;
  const previousKeyId = process.env.EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS;
  const previousSecret = process.env.EXTERNAL_MONITOR_HMAC_SECRET_PREVIOUS;

  requireBothOrNeither("EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT", currentKeyId, "EXTERNAL_MONITOR_HMAC_SECRET_CURRENT", currentSecret);
  requireBothOrNeither("EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS", previousKeyId, "EXTERNAL_MONITOR_HMAC_SECRET_PREVIOUS", previousSecret);

  if (!currentKeyId) {
    // eslint-disable-next-line no-console -- no-op summary, no secret involved.
    console.log(
      "EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT/EXTERNAL_MONITOR_HMAC_SECRET_CURRENT are not set in this environment -- skipping external monitor key provisioning (POST /platform/operations/external-monitor-report stays fail-closed for every caller, 02_42 §53.4 check 1).",
    );
    return;
  }
  if (previousKeyId && previousKeyId === currentKeyId) {
    throw new Error("EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS must not equal EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to provision the external monitor key metadata.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repo = new ExternalMonitorKeyMetadataRepository(pool);
    const existingCurrent = await repo.findCurrent();

    if (existingCurrent?.keyId === currentKeyId) {
      // Idempotent no-op: this key-id is already CURRENT, nothing to
      // rotate (02_42 §54 -- rotation is a deliberate operator action,
      // not something a repeated provisioning run should trigger by
      // re-running with the same configuration).
      // eslint-disable-next-line no-console -- controlled, non-secret summary output (key-id only, never the secret).
      console.log(`External monitor key already CURRENT: keyId=${currentKeyId}. No rotation performed.`);
    } else {
      // rotateIn demotes any existing CURRENT row to PREVIOUS and inserts
      // the new CURRENT row atomically (02_42 §54 steps 3-4) -- this is
      // exactly the documented rotation procedure, not a bespoke write.
      await repo.rotateIn(currentKeyId, null);
      // eslint-disable-next-line no-console -- controlled, non-secret summary output.
      console.log(
        existingCurrent
          ? `External monitor key rotated: keyId=${currentKeyId} is now CURRENT (previous CURRENT keyId=${existingCurrent.keyId} demoted to PREVIOUS).`
          : `External monitor key provisioned: keyId=${currentKeyId} is now CURRENT (first key -- no prior CURRENT row existed).`,
      );
    }

    // Consistency check only, never a write: EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS
    // describes what the operator EXPECTS the current PREVIOUS row to be
    // (typically the key-id that was CURRENT immediately before this
    // rotation) -- rotateIn above is the only path that ever creates a
    // PREVIOUS row (02_42 §54 has no independent "provision a PREVIOUS
    // key" operation), so this step only surfaces a mismatch, it never
    // tries to fabricate one.
    if (previousKeyId) {
      const previousRow = await repo.findByKeyId(previousKeyId);
      if (!previousRow) {
        console.warn(
          `EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS=${previousKeyId} is set, but no row with that keyId exists in external_monitor_key_metadata. ` +
            `A PREVIOUS row is only ever created by a rotation (02_42 §54) -- if this is the first-ever provisioning run, this is expected and harmless.`,
        );
      } else if (previousRow.status !== "PREVIOUS") {
        console.warn(
          `EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS=${previousKeyId} exists but has status=${previousRow.status}, not PREVIOUS -- ` +
            `EXTERNAL_MONITOR_HMAC_SECRET_PREVIOUS will not be resolvable for verification until this is reconciled.`,
        );
      } else {
        // eslint-disable-next-line no-console -- controlled, non-secret summary output.
        console.log(`External monitor PREVIOUS key confirmed: keyId=${previousKeyId}, status=PREVIOUS (overlap window active, 02_42 §54).`);
      }
    }
  } finally {
    await pool.end();
  }
}

// Cross-platform entrypoint check -- comparing import.meta.url against a
// raw `file://${process.argv[1]}` string breaks on Windows (backslash
// paths, no triple-slash prefix), silently causing main() to never run.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
