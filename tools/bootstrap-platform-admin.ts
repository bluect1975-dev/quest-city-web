#!/usr/bin/env node
// School Pilot Readiness Tranche A: controlled, offline PLATFORM_ADMIN
// bootstrap (02_38 §4.1: "nessun umano tramite auto-registrazione...
// provisioning amministrativo controllato offline"). This script IS the
// controlled provisioning process for the very first platform admin --
// canon is explicitly silent on the literal bootstrap mechanism beyond
// "never a public endpoint" (02_38 §4.1's invite-based flow for
// *subsequent* admins presupposes an already-active PLATFORM_ADMIN,
// which cannot exist yet for the first one), so this mirrors
// tools/seed-staff.ts's already-established security pattern for the
// exact same class of problem:
//   - the generated (or operator-supplied) password is written ONLY to
//     the --out file, in plaintext, exactly once;
//   - nothing resembling a secret is ever printed to stdout/stderr/log;
//   - --out is required, has no default, must resolve outside the
//     repository's Git root, and refuses to overwrite an existing file;
//   - idempotent: if a staff_account with this email already holds an
//     ACTIVE platform_admin_grant, the script succeeds as a no-op and
//     writes nothing (§7: "Deve essere idempotente");
//   - refuses to run against a NODE_ENV=production database unless
//     --allow-production is explicitly passed (§7: "non creare
//     automaticamente dati demo in production mode" -- this is not demo
//     data, but the same production-safety discipline applies to any
//     script capable of creating a privileged identity);
//   - grants exactly the five Tranche A capabilities, least-privilege
//     (no capability this tranche does not define is ever granted).
//
// Usage:
//   pnpm --filter @quest-city-web/tools run bootstrap:platform-admin -- \
//     --out <path> --email admin@example.org [--password <explicit-password>] [--allow-production]

import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPassword } from "@quest-city-web/staff-identity";
import { CAPABILITIES } from "@quest-city-web/platform-admin";

const { Client } = pg;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP_ACTOR_ID = "tools/bootstrap-platform-admin.ts@1.0.0";

interface Args {
  out: string;
  email: string;
  password: string | undefined;
  allowProduction: boolean;
}

function parseArgs(argv: string[]): Args {
  const values: Record<string, string> = {};
  let allowProduction = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-production") {
      allowProduction = true;
      continue;
    }
    if (arg?.startsWith("--") && argv[i + 1] && !argv[i + 1]?.startsWith("--")) {
      values[arg.slice(2)] = argv[i + 1] as string;
      i += 1;
    }
  }

  const required = ["out", "email"];
  const missing = required.filter((k) => !values[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.map((k) => `--${k}`).join(", ")}`);
  }

  return {
    out: values["out"] as string,
    email: (values["email"] as string).trim().toLowerCase(),
    password: values["password"],
    allowProduction,
  };
}

function assertOutsideRepo(outPath: string): void {
  const resolved = path.resolve(process.cwd(), outPath);
  const relative = path.relative(REPO_ROOT, resolved);
  const isInsideRepo = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (isInsideRepo) {
    throw new Error(`--out must resolve outside the repository root (${REPO_ROOT}); got: ${resolved}`);
  }
}

function assertGitRootMatches(): void {
  try {
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    const normalizedGitRoot = path.resolve(gitRoot);
    const normalizedRepoRoot = path.resolve(REPO_ROOT);
    if (normalizedGitRoot.toLowerCase() !== normalizedRepoRoot.toLowerCase()) {
      throw new Error(
        `Git root (${normalizedGitRoot}) does not match the expected repository root (${normalizedRepoRoot}) -- refusing to run.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not match")) {
      throw error;
    }
    // git not available or not a repo -- best-effort only, same as seed-staff.ts.
  }
}

function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertGitRootMatches();

  if (process.env.NODE_ENV === "production" && !args.allowProduction) {
    throw new Error("NODE_ENV=production -- pass --allow-production to bootstrap a platform admin against a production database.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the bootstrap.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const existingAccount = await client.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, [args.email]);
    const existingAccountId = existingAccount.rows[0]?.id;

    if (existingAccountId) {
      const existingGrant = await client.query<{ status: string }>(
        `SELECT status FROM platform_admin_grant WHERE staff_account_id = $1`,
        [existingAccountId],
      );
      if (existingGrant.rows[0]?.status === "ACTIVE") {
        // eslint-disable-next-line no-console -- idempotent no-op summary, no secret involved.
        console.log(`Platform admin already bootstrapped for ${args.email} -- no changes made.`);
        return;
      }
      throw new Error(
        `A staff_account with email '${args.email}' already exists but is not an ACTIVE platform admin -- refusing to modify an unrelated identity. Choose a different email or resolve manually.`,
      );
    }

    if (existsSync(args.out)) {
      throw new Error(`--out path already exists, refusing to overwrite: ${args.out}`);
    }
    assertOutsideRepo(args.out);

    const password = args.password ?? generatePassword();
    const passwordHash = await hashPassword(password);

    await client.query("BEGIN");

    const accountResult = await client.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_BOOTSTRAP_SCRIPT', $3)
       RETURNING id`,
      [args.email, passwordHash, BOOTSTRAP_ACTOR_ID],
    );
    const account = accountResult.rows[0];
    if (!account) {
      throw new Error("staff_account insert produced no row");
    }

    const grantResult = await client.query<{ id: string }>(
      `INSERT INTO platform_admin_grant (staff_account_id, status, granted_by_actor_type, granted_by_actor_id)
       VALUES ($1, 'ACTIVE', 'ADMIN_BOOTSTRAP_SCRIPT', $2)
       RETURNING id`,
      [account.id, BOOTSTRAP_ACTOR_ID],
    );
    const grant = grantResult.rows[0];
    if (!grant) {
      throw new Error("platform_admin_grant insert produced no row");
    }

    for (const capability of CAPABILITIES) {
      await client.query(`INSERT INTO capability_grant (platform_admin_grant_id, capability) VALUES ($1, $2)`, [
        grant.id,
        capability,
      ]);
    }

    await client.query(
      `INSERT INTO audit_event (tenant_id, actor_type, actor_id, action, target_type, target_id, result, metadata_redacted)
       VALUES (NULL, 'PLATFORM_ADMIN', $1, 'platform_admin.bootstrapped', 'staff_account', $1, 'SUCCESS', $2::jsonb)`,
      [account.id, JSON.stringify({ capabilityCount: CAPABILITIES.length })],
    );

    await client.query("COMMIT");

    const secrets = { email: args.email, password };
    await writeFile(args.out, JSON.stringify(secrets, null, 2), { encoding: "utf8", mode: 0o600 });
    try {
      await chmod(args.out, 0o600);
    } catch {
      // Best-effort: some filesystems (e.g. NTFS without POSIX permission emulation) do not support chmod.
    }

    // eslint-disable-next-line no-console -- controlled, non-secret summary output.
    console.log(`Bootstrapped 1 platform admin (${CAPABILITIES.length} capabilities granted). Secrets written to: ${args.out}`);
    // eslint-disable-next-line no-console -- required handoff/deletion instructions for the operator.
    console.log(
      "Hand this file to the authorized platform operator, then delete it manually. " +
        "No automatic deletion is performed, to avoid losing the only copy before handoff is confirmed.",
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
