#!/usr/bin/env node
// Administrative offline assignment seed (WEB-M2B). Extends the WEB-M1
// Fase 2 seed pattern (see tools/seed-pilot.ts) to assignments: AGENTS.md
// v4.30 §4.21 rule 16 — "Le assegnazioni non hanno un endpoint pubblico di
// creazione o modifica: sono pre-provisionate tramite processo
// amministrativo offline controllato." No staff authentication exists yet
// (D3) — this script IS the controlled provisioning process, run by an
// operator with direct database access, never by the application.
//
// Security pattern reused from seed-pilot.ts:
//   - controlled output: only counts/identifiers are printed, nothing
//     resembling a secret (there is none here — assignments carry no PIN
//     or class code — but the same discipline is kept for consistency);
//   - no file is ever produced in the repository or elsewhere — this
//     script only writes to the database;
//   - refuses to overwrite an existing assignment (same public_id);
//   - validates tenant/class/content_bundle/runtime before writing
//     anything, inside a single transaction (all-or-nothing).
//
// Usage:
//   pnpm --filter @quest-city-web/tools run seed:assignment -- \
//     --tenant-public-id sch_XXXXXXXX --class-public-id cls_XXXXXXXX \
//     --content-bundle-public-id bnd_XXXXXXXX --title "Balance Machine" \
//     --public-id asn_demo1 --runtime-channels WEB \
//     [--completion-policy FIRST_VALID_COMPLETION] [--status PUBLISHED]

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_ACTOR_ID = "tools/seed-assignment.ts@1.0.0";

interface Args {
  tenantPublicId: string;
  classPublicId: string;
  contentBundlePublicId: string;
  title: string;
  publicId: string;
  runtimeChannels: Array<"WEB" | "ROBLOX">;
  completionPolicy: "FIRST_VALID_COMPLETION";
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  opensAt: string | undefined;
  dueAt: string | undefined;
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

  const required = ["tenant-public-id", "class-public-id", "content-bundle-public-id", "title", "public-id", "runtime-channels"];
  const missing = required.filter((k) => !values[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.map((k) => `--${k}`).join(", ")}`);
  }

  const runtimeChannels = (values["runtime-channels"] as string).split(",").map((s) => s.trim());
  for (const ch of runtimeChannels) {
    if (ch !== "WEB" && ch !== "ROBLOX") {
      throw new Error(`--runtime-channels must be a comma-separated list of WEB/ROBLOX, got: ${ch}`);
    }
  }
  const completionPolicy = (values["completion-policy"] ?? "FIRST_VALID_COMPLETION") as "FIRST_VALID_COMPLETION";
  if (completionPolicy !== "FIRST_VALID_COMPLETION") {
    throw new Error("--completion-policy: only FIRST_VALID_COMPLETION is supported (02_26 v1.6 §18.1).");
  }
  const status = (values["status"] ?? "DRAFT") as "DRAFT" | "PUBLISHED" | "ARCHIVED";
  if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) {
    throw new Error("--status must be DRAFT, PUBLISHED or ARCHIVED.");
  }

  return {
    tenantPublicId: values["tenant-public-id"] as string,
    classPublicId: values["class-public-id"] as string,
    contentBundlePublicId: values["content-bundle-public-id"] as string,
    title: values["title"] as string,
    publicId: values["public-id"] as string,
    runtimeChannels: runtimeChannels as Array<"WEB" | "ROBLOX">,
    completionPolicy,
    status,
    opensAt: values["opens-at"],
    dueAt: values["due-at"],
  };
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertGitRootMatches();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the seed.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query<{ id: string }>(`SELECT id FROM assignment WHERE public_id = $1`, [args.publicId]);
    if (existing.rows.length > 0) {
      throw new Error(`Assignment with public_id '${args.publicId}' already exists — refusing to overwrite.`);
    }

    const tenantResult = await client.query<{ id: string }>(`SELECT id FROM tenant WHERE public_id = $1`, [args.tenantPublicId]);
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      throw new Error(`Tenant not found: ${args.tenantPublicId}`);
    }

    const classResult = await client.query<{ id: string }>(
      `SELECT id FROM school_class WHERE public_id = $1 AND tenant_id = $2`,
      [args.classPublicId, tenant.id],
    );
    const schoolClass = classResult.rows[0];
    if (!schoolClass) {
      throw new Error(`Class not found for this tenant: ${args.classPublicId}`);
    }

    const bundleResult = await client.query<{ id: string }>(
      `SELECT id FROM content_bundle WHERE public_id = $1 AND status = 'PUBLISHED'`,
      [args.contentBundlePublicId],
    );
    const bundle = bundleResult.rows[0];
    if (!bundle) {
      throw new Error(`Published content bundle not found: ${args.contentBundlePublicId}`);
    }

    const bundleChannels = await client.query<{ runtime_channel: "WEB" | "ROBLOX" }>(
      `SELECT runtime_channel FROM content_bundle_runtime_channel WHERE content_bundle_id = $1`,
      [bundle.id],
    );
    const bundleChannelSet = new Set(bundleChannels.rows.map((r) => r.runtime_channel));
    const unsupported = args.runtimeChannels.filter((ch) => !bundleChannelSet.has(ch));
    if (unsupported.length > 0) {
      throw new Error(
        `Content bundle ${args.contentBundlePublicId} does not support runtime channel(s): ${unsupported.join(", ")}`,
      );
    }

    const assignmentResult = await client.query<{ id: string }>(
      `INSERT INTO assignment
         (tenant_id, class_id, public_id, title, status, opens_at, due_at,
          created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ADMIN_SEED_SCRIPT', $8, $9, $10)
       RETURNING id`,
      [
        tenant.id,
        schoolClass.id,
        args.publicId,
        args.title,
        args.status,
        args.opensAt ?? null,
        args.dueAt ?? null,
        SEED_ACTOR_ID,
        args.completionPolicy,
        bundle.id,
      ],
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) {
      throw new Error("assignment insert produced no row");
    }

    for (const channel of args.runtimeChannels) {
      await client.query(
        `INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, $3)`,
        [assignment.id, tenant.id, channel],
      );
    }

    await client.query("COMMIT");

    // eslint-disable-next-line no-console -- controlled, non-secret summary output.
    console.log(
      `Created assignment '${args.publicId}' (${args.title}) for tenant ${args.tenantPublicId}, class ${args.classPublicId}, ` +
        `runtime channels [${args.runtimeChannels.join(", ")}], status ${args.status}.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
