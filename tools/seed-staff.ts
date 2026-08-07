#!/usr/bin/env node
// Administrative offline staff seed (WEB-M3B, 02_35 §4.2). Per the
// canonical contract: "No public self-registration endpoint exists
// anywhere in this milestone" — this script IS the controlled
// provisioning process, run by an operator with direct database access,
// never by the application. Mirrors tools/seed-pilot.ts's security
// pattern, adapted for staff credentials:
//   - the generated (or operator-supplied) password is written ONLY to
//     the --out file, in plaintext, exactly once;
//   - nothing resembling a secret — password or hash — is ever printed
//     to stdout, stderr, or any log, and nothing is ever written to a
//     .env file;
//   - --out is required, has no default, must resolve outside the
//     repository's Git root, and the script refuses to overwrite an
//     existing file;
//   - refuses to overwrite an existing staff_account (same normalized
//     email) — no account is ever silently updated by this script;
//   - the output file's permissions are set to 0600 where supported.
//
// Usage:
//   pnpm --filter @quest-city-web/tools run seed:staff -- \
//     --out <path> --email teacher@example.org --tenant-public-id sch_XXXXXXXX \
//     --role TEACHER --class-public-ids cls_AAAAAAAA,cls_BBBBBBBB \
//     [--password <explicit-password>]
//
//   pnpm --filter @quest-city-web/tools run seed:staff -- \
//     --out <path> --email admin@example.org --tenant-public-id sch_XXXXXXXX --role SCHOOL_ADMIN

import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPassword } from "@quest-city-web/staff-identity";

const { Client } = pg;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_ACTOR_ID = "tools/seed-staff.ts@1.0.0";
const STAFF_ROLES = ["TEACHER", "SCHOOL_ADMIN"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

interface Args {
  out: string;
  email: string;
  tenantPublicId: string;
  role: StaffRole;
  classPublicIds: string[];
  password: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg?.startsWith("--") && argv[i + 1] && !argv[i + 1]?.startsWith("--")) {
      values[arg.slice(2)] = argv[i + 1] as string;
      i += 1;
    }
  }

  const required = ["out", "email", "tenant-public-id", "role"];
  const missing = required.filter((k) => !values[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.map((k) => `--${k}`).join(", ")}`);
  }

  const role = values["role"] as string;
  if (!STAFF_ROLES.includes(role as StaffRole)) {
    throw new Error(`--role must be one of: ${STAFF_ROLES.join(", ")}`);
  }

  const classPublicIds = (values["class-public-ids"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (role === "TEACHER" && classPublicIds.length === 0) {
    throw new Error("--class-public-ids is required for --role TEACHER (02_35 §3.2 — TEACHER's scope is explicit classes, never implicit).");
  }
  if (role === "SCHOOL_ADMIN" && classPublicIds.length > 0) {
    throw new Error("--class-public-ids must not be set for --role SCHOOL_ADMIN — its scope is the whole tenant, implicitly (02_35 §3.2).");
  }

  return {
    out: values["out"] as string,
    email: (values["email"] as string).trim().toLowerCase(),
    tenantPublicId: values["tenant-public-id"] as string,
    role: role as StaffRole,
    classPublicIds,
    password: values["password"],
  };
}

/** Refuses any --out path resolving inside this Git repository (same discipline as tools/seed-pilot.ts). */
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
        `Git root (${normalizedGitRoot}) does not match the expected repository root (${normalizedRepoRoot}) — refusing to seed.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not match")) {
      throw error;
    }
    // git not available or not a repo — best-effort only, same as seed-pilot.ts.
  }
}

/** Never printed or logged — only ever written to --out. */
function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertGitRootMatches();
  assertOutsideRepo(args.out);
  if (existsSync(args.out)) {
    throw new Error(`--out path already exists, refusing to overwrite: ${args.out}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the seed.");
  }

  const password = args.password ?? generatePassword();
  const passwordHash = await hashPassword(password);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const secrets: {
    email: string;
    password: string;
    tenantPublicId: string;
    role: StaffRole;
    classPublicIds: string[];
  } = {
    email: args.email,
    password,
    tenantPublicId: args.tenantPublicId,
    role: args.role,
    classPublicIds: args.classPublicIds,
  };

  try {
    await client.query("BEGIN");

    const existingAccount = await client.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, [args.email]);
    if (existingAccount.rows.length > 0) {
      throw new Error(`A staff_account with email '${args.email}' already exists — refusing to overwrite.`);
    }

    const tenantResult = await client.query<{ id: string }>(`SELECT id FROM tenant WHERE public_id = $1`, [args.tenantPublicId]);
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      throw new Error(`Tenant not found: ${args.tenantPublicId}`);
    }

    const classIds: string[] = [];
    for (const classPublicId of args.classPublicIds) {
      const classResult = await client.query<{ id: string }>(
        `SELECT id FROM school_class WHERE public_id = $1 AND tenant_id = $2`,
        [classPublicId, tenant.id],
      );
      const schoolClass = classResult.rows[0];
      if (!schoolClass) {
        throw new Error(`Class not found for this tenant: ${classPublicId}`);
      }
      classIds.push(schoolClass.id);
    }

    const accountResult = await client.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', $3)
       RETURNING id`,
      [args.email, passwordHash, SEED_ACTOR_ID],
    );
    const account = accountResult.rows[0];
    if (!account) {
      throw new Error("staff_account insert produced no row");
    }

    const membershipResult = await client.query<{ id: string }>(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       RETURNING id`,
      [account.id, tenant.id, args.role],
    );
    const membership = membershipResult.rows[0];
    if (!membership) {
      throw new Error("staff_tenant_membership insert produced no row");
    }

    for (const classId of classIds) {
      await client.query(
        `INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`,
        [membership.id, tenant.id, classId],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  await writeFile(args.out, JSON.stringify(secrets, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(args.out, 0o600);
  } catch {
    // Best-effort: some filesystems (e.g. NTFS without POSIX permission emulation) do not support chmod.
  }

  // Deliberately the ONLY output of this script: counts and the output
  // path. No password or hash is ever printed here, and nothing is
  // written to any .env file.
  // eslint-disable-next-line no-console -- controlled, non-secret summary output.
  console.log(
    `Created 1 staff_account (${args.role}) for tenant ${args.tenantPublicId}` +
      (args.classPublicIds.length > 0 ? ` scoped to ${args.classPublicIds.length} class(es)` : "") +
      `. Secrets written to: ${args.out}`,
  );
  // eslint-disable-next-line no-console -- required handoff/deletion instructions for the operator.
  console.log(
    "Hand this file to the authorized staff member, then delete it manually. " +
      "No automatic deletion is performed, to avoid losing the only copy before handoff is confirmed.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
