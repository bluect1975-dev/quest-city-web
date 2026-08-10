#!/usr/bin/env node
// Administrative offline content bundle seed (M06 Web Full Vertical Slice
// Tranche 6, `07_26 v1.1` §17.4). Mirrors `tools/seed-tranche5-content-bundle.ts`
// exactly, for the one new real content bundle Tranche 6 introduces: the
// Full M06 Sequence's standalone `REFLECTION_AND_RESULT` group (all other 6
// stage groups reuse content bundles seeded by prior tranches' own scripts,
// unchanged). No public write endpoint exists for `content_bundle`
// (AGENTS.md convention) — this script IS the controlled process.
//
// The seeded row uses a FIXED `id` (not the column default
// `gen_random_uuid()`) for the same reason as prior tranches' scripts:
// `packages/attempts/src/services/orchestration-stage-entry-resolution.ts`
// resolves the non-interactive trigger's eligibility from `attempt.contentId`,
// which launch-context sets to `content_bundle.id`.
//
// Usage:
//   pnpm --filter @quest-city-web/tools run seed:tranche6-content-bundle

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  loadBundleManifest,
  WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST,
  WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE6_REFLECTION_CONTENT_BUNDLE_PUBLIC_ID,
} from "@quest-city-web/content-runtime";

const { Client } = pg;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_ACTOR_ID = "tools/seed-tranche6-content-bundle.ts@1.0.0";

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
    // git not available or not a repo — best-effort only, same as prior tranches' scripts.
  }
}

async function main(): Promise<void> {
  assertGitRootMatches();

  // Real validation, not shape-only trust: refuses to seed a manifest that
  // does not pass schema + servable-type + safe-path checks (bundle-loader.ts).
  const validation = loadBundleManifest(WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST);
  if (!validation.ok) {
    throw new Error(`WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST failed validation: ${validation.errors.join("; ")}`);
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
      WEB_TRANCHE6_REFLECTION_CONTENT_BUNDLE_PUBLIC_ID,
    ]);
    if (existing.rows.length > 0) {
      throw new Error(
        `Content bundle with public_id '${WEB_TRANCHE6_REFLECTION_CONTENT_BUNDLE_PUBLIC_ID}' already exists — refusing to overwrite.`,
      );
    }

    const manifest = WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST;
    await client.query(
      `INSERT INTO content_bundle
         (id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID,
        WEB_TRANCHE6_REFLECTION_CONTENT_BUNDLE_PUBLIC_ID,
        manifest.subjectId,
        manifest.bundleVersion,
        manifest.bundleType,
        manifest.status,
        `sha256:${manifest.integrity.digest}`,
        "pkg://@quest-city-web/content-runtime/content/web-tranche6-full-sequence-content#WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST",
        manifest.publishedAt,
      ],
    );

    await client.query(
      `INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`,
      [WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID],
    );

    await client.query("COMMIT");

    // eslint-disable-next-line no-console -- controlled, non-secret summary output.
    console.log(
      `Created content_bundle '${WEB_TRANCHE6_REFLECTION_CONTENT_BUNDLE_PUBLIC_ID}' (id ${WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID}, ` +
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
