#!/usr/bin/env node
// Minimal forward-only SQL migration runner (02_25 §16: "migrazioni
// versionate; SQL migrations + typed query layer; ORM is optional but not
// the source of the model"). No ORM/migration framework is introduced
// here without an ADR, per the WEB-M0 constraint against unnecessary
// components — this is deliberately small and auditable.
//
// Usage: node tools/migrate.mjs [--dir <migrationsDir>]
//
// Applies every `NNNN_description.sql` file in order that is not yet
// recorded in the `schema_migrations` table, inside a transaction per file.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isMigrationFile } from "./migration-filename.mjs";

const { Client } = pg;

// Resolved relative to this file (not process.cwd()) so the default works
// whether invoked as `node tools/migrate.mjs` from the repo root or as
// `pnpm --filter @quest-city-web/tools run migrate`, which runs with cwd
// set to tools/.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { dir: path.resolve(REPO_ROOT, "infrastructure/database/migrations") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && argv[i + 1]) {
      args.dir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

async function listMigrationFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && isMigrationFile(e.name))
    .map((e) => e.name)
    .sort();
}

async function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const files = await listMigrationFiles(dir);
    const appliedResult = await client.query("SELECT filename FROM schema_migrations");
    const applied = new Set(appliedResult.rows.map((r) => r.filename));

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    for (const filename of pending) {
      const sql = await readFile(path.join(dir, filename), "utf8");
      console.log(`Applying ${filename} ...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${filename} failed and was rolled back: ${error.message}`);
      }
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
