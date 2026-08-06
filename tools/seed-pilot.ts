#!/usr/bin/env node
// Administrative offline pilot seed (WEB-M1 Fase 2). Per 02_25 §6.11:
// "Tenant, class, student profile and enrollment provisioning for WEB-M1
// happens exclusively through a controlled offline administrative seed
// process; no public endpoint creates a profile or enrollment." This
// script IS that process — it never runs as part of the application, and
// it never runs unattended (a human must supply --out and hand the result
// to an authorized administrator).
//
// Secret handling (WEB-M1 Fase 2 correction report §3 — binding, not
// optional):
//   - the class code, every generated alias, and every generated PIN are
//     written ONLY to the --out file, in plaintext, exactly once;
//   - nothing resembling a secret is ever written to stdout, stderr, or
//     any log — stdout carries only counts and the output path;
//   - --out is required, has no default, must resolve outside the
//     repository's Git root, and the script refuses to overwrite an
//     existing file;
//   - the output file's permissions are set to 0600 where the filesystem
//     supports it;
//   - deleting the file after handoff to the school administrator is a
//     manual step (printed in the summary) — this script does not delete
//     it automatically, to avoid destroying the only copy before the
//     handoff is confirmed.
//
// Usage:
//   pnpm --filter @quest-city-web/tools run seed -- --out <path> \
//     [--tenant-name "Istituto Esempio"] [--class-name "1A"] [--students 5]

import { randomUUID } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  decodeClassCodePepper,
  generateClassCode,
  generatePin,
  hashClassCode,
  hashPin,
  normalizeAlias,
  normalizeClassCode,
} from "@quest-city-web/identity";

const { Client } = pg;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Args {
  out: string;
  tenantName: string;
  className: string;
  studentCount: number;
}

function parseArgs(argv: string[]): Args {
  let out: string | undefined;
  let tenantName = "Pilot School";
  let className = "Pilot Class";
  let studentCount = 5;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) {
      out = argv[i + 1];
      i += 1;
    } else if (arg === "--tenant-name" && argv[i + 1]) {
      tenantName = argv[i + 1] as string;
      i += 1;
    } else if (arg === "--class-name" && argv[i + 1]) {
      className = argv[i + 1] as string;
      i += 1;
    } else if (arg === "--students" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1] as string, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        throw new Error("--students must be a positive integer");
      }
      studentCount = parsed;
      i += 1;
    }
  }

  if (!out) {
    throw new Error("--out <path> is required — no default output path exists by design (WEB-M1 Fase 2, seed requirements).");
  }

  return { out, tenantName, className, studentCount };
}

/** Refuses any --out path resolving inside this Git repository. */
function assertOutsideRepo(outPath: string): void {
  const resolved = path.resolve(process.cwd(), outPath);
  const relative = path.relative(REPO_ROOT, resolved);
  const isInsideRepo = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (isInsideRepo) {
    throw new Error(`--out must resolve outside the repository root (${REPO_ROOT}); got: ${resolved}`);
  }
}

function assertGitRootMatches(): void {
  // Defensive cross-check against REPO_ROOT (derived from import.meta.url)
  // using `git rev-parse` when available — best-effort only, since a
  // seed run must not hard-depend on git being installed on the host.
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
    // git not available or not a repo — fall back to the import.meta.url-derived REPO_ROOT alone.
  }
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
  // No default, ever (WEB-M1 Fase 2 correction #1) — decodeClassCodePepper's
  // own error message never includes the raw value.
  let pepper: Buffer;
  try {
    pepper = decodeClassCodePepper(process.env.CLASS_CODE_HASH_PEPPER);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail} Set CLASS_CODE_HASH_PEPPER before running the seed — there is no default value.`);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const secrets: {
    tenant: { publicId: string; name: string };
    class: { publicId: string; name: string; classCode: string };
    enrollments: Array<{ studentPublicId: string; accessAlias: string; pin: string }>;
  } = {
    tenant: { publicId: "", name: args.tenantName },
    class: { publicId: "", name: args.className, classCode: "" },
    enrollments: [],
  };

  try {
    await client.query("BEGIN");

    const tenantPublicId = `sch_${randomUUID().slice(0, 8)}`;
    const tenantResult = await client.query<{ id: string }>(
      `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', $2) RETURNING id`,
      [tenantPublicId, args.tenantName],
    );
    const [tenantRow] = tenantResult.rows;
    if (!tenantRow) {
      throw new Error("tenant insert produced no row");
    }
    secrets.tenant.publicId = tenantPublicId;

    const classPublicId = `cls_${randomUUID().slice(0, 8)}`;
    const classResult = await client.query<{ id: string }>(
      `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [tenantRow.id, classPublicId, args.className],
    );
    const [classRow] = classResult.rows;
    if (!classRow) {
      throw new Error("school_class insert produced no row");
    }
    secrets.class.publicId = classPublicId;

    const classCode = generateClassCode();
    const classCodeHash = hashClassCode(normalizeClassCode(classCode), pepper);
    await client.query(
      `INSERT INTO class_access_code (tenant_id, class_id, code_hash, status) VALUES ($1, $2, $3, 'ACTIVE')`,
      [tenantRow.id, classRow.id, classCodeHash],
    );
    secrets.class.classCode = classCode;

    for (let i = 1; i <= args.studentCount; i += 1) {
      const studentPublicId = `std_${randomUUID().slice(0, 8)}`;
      const profileResult = await client.query<{ id: string }>(
        `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
        [tenantRow.id, studentPublicId],
      );
      const [profileRow] = profileResult.rows;
      if (!profileRow) {
        throw new Error("student_profile insert produced no row");
      }

      const accessAlias = `student${i}`;
      const pin = generatePin();
      const pinHash = await hashPin(pin);

      await client.query(
        `INSERT INTO school_enrollment
           (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'INVITED')`,
        [tenantRow.id, classRow.id, profileRow.id, accessAlias, normalizeAlias(accessAlias), pinHash],
      );

      secrets.enrollments.push({ studentPublicId, accessAlias, pin });
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
    // Best-effort: some filesystems (e.g. NTFS without POSIX permission
    // emulation) do not support chmod. Not fatal — ownership/ACLs at the
    // OS/filesystem level are the operator's responsibility in that case.
  }

  // Deliberately the ONLY output of this script: counts and the output
  // path. No class code, alias or PIN is ever printed here.
  // eslint-disable-next-line no-console -- this CLI's whole purpose is printing this one summary line.
  console.log(
    `Created 1 tenant, 1 class, ${secrets.enrollments.length} enrollment(s). Secrets written to: ${args.out}`,
  );
  // eslint-disable-next-line no-console -- required handoff/deletion instructions for the operator.
  console.log(
    "Hand this file to the authorized school administrator, then delete it manually. " +
      "No automatic deletion is performed, to avoid losing the only copy before handoff is confirmed.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
