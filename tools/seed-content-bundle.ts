#!/usr/bin/env node
// Administrative offline content bundle seed (WEB-M4, 07_25 v1.0 §9/§17):
// "un bundle reale... prodotto amministrativamente/via seed (stesso
// precedente di assegnazione/dati staff)". No public write endpoint exists
// for content_bundle (AGENTS.md convention, see content-bundle-repository.ts
// doc comment: "Administrative/seed provisioning only") — this script IS
// that controlled process, mirroring tools/seed-assignment.ts exactly:
// single transaction, refuses to overwrite an existing public_id, prints
// only non-secret identifiers.
//
// The seeded row uses a FIXED `id` (not the column default
// `gen_random_uuid()`) because `packages/attempts/src/services/
// engine-dispatch-resolution.ts` must resolve the real Learning Engine
// config from `attempt.contentId`, which launch-context sets to
// `content_bundle.id` — the dispatch table is keyed on that same fixed id
// (`WEB_M4_MAT_M06_CONTENT_BUNDLE_ID`), so the two must agree by
// construction, not by convention.
//
// Usage:
//   pnpm --filter @quest-city-web/tools run seed:content-bundle

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadBundleManifest } from "@quest-city-web/content-runtime";
import {
  WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST,
  WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID,
} from "@quest-city-web/content-runtime";

const { Client } = pg;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_ACTOR_ID = "tools/seed-content-bundle.ts@1.0.0";

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
    // git not available or not a repo — best-effort only, same as seed-pilot.ts / seed-assignment.ts.
  }
}

async function main(): Promise<void> {
  assertGitRootMatches();

  // Real validation, not shape-only trust: refuses to seed a manifest that
  // does not pass schema + servable-type + safe-path checks (bundle-loader.ts).
  const validation = loadBundleManifest(WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST);
  if (!validation.ok) {
    throw new Error(`WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST failed validation: ${validation.errors.join("; ")}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the seed.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query<{ id: string }>(`SELECT id FROM content_bundle WHERE public_id = $1`, [
      WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID,
    ]);
    if (existing.rows.length > 0) {
      throw new Error(`Content bundle with public_id '${WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID}' already exists — refusing to overwrite.`);
    }

    const manifest = WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST;
    await client.query(
      `INSERT INTO content_bundle
         (id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
        WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID,
        manifest.subjectId,
        manifest.bundleVersion,
        manifest.bundleType,
        manifest.status,
        `sha256:${manifest.integrity.digest}`,
        `pkg://@quest-city-web/content-runtime/content/web-m4-real-content#WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST`,
        manifest.publishedAt,
      ],
    );

    await client.query(
      `INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`,
      [WEB_M4_MAT_M06_CONTENT_BUNDLE_ID],
    );

    await client.query("COMMIT");

    // eslint-disable-next-line no-console -- controlled, non-secret summary output.
    console.log(
      `Created content_bundle '${WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID}' (id ${WEB_M4_MAT_M06_CONTENT_BUNDLE_ID}, ` +
        `type ${manifest.bundleType}, version ${manifest.bundleVersion}) by ${SEED_ACTOR_ID}.`,
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
