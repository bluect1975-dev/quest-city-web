#!/usr/bin/env node
// WEB-M2 fixture isolation gate (AGENTS.md v4.30, docs/adr/0003):
// CrossRuntimeReconciliationFixtureDriver simulates a result that has no
// real controlled-resolution implementation yet (no staff auth exists).
// It must never be reachable from production code (apps/api,
// packages/attempts, packages/content-runtime, packages/identity, ...) —
// only from test files (*.test.ts) or the tests/integration workspace.
//
// Usage: node tools/check-fixture-isolation.mjs [root]
// Exit code 0 if isolation holds, 1 if any production file imports it.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".pnpm-store"]);

// Two independent markers: the class name (matches any import regardless of
// path — file path, "@quest-city-web/test-fixtures/fixture-driver" subpath
// export, or a future re-export) and the source filename (belt-and-suspenders
// for a raw path reference without the class name, e.g. a dynamic import
// string).
const FIXTURE_DRIVER_MARKERS = ["CrossRuntimeReconciliationFixtureDriver", "cross-runtime-reconciliation-fixture-driver"];
const FIXTURE_DRIVER_SOURCE_DIR = path.join("packages", "test-fixtures", "src");

// Strip comments before scanning so documentation-only mentions of the class
// name (e.g. a JSDoc note pointing readers at the fixture driver, as in
// packages/attempts/src/services/cross-runtime-reconciliation-service.ts)
// don't trip the gate — only an actual import/usage in live code should.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function isAllowedContext(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (normalized.startsWith("packages/test-fixtures/")) return true;
  if (normalized.startsWith("tests/integration/")) return true;
  if (normalized === "tools/check-fixture-isolation.mjs") return true; // self-reference in this script's own text
  if (/\.test\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/\.spec\.[cm]?[jt]sx?$/.test(normalized)) return true;
  return false;
}

async function walk(dir, root, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, files);
    } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function main(root) {
  const files = await walk(root, root, []);
  const violations = [];

  for (const file of files) {
    const relative = path.relative(root, file);
    if (relative.startsWith(FIXTURE_DRIVER_SOURCE_DIR)) continue; // the driver's own file
    if (isAllowedContext(relative)) continue;

    const content = stripComments(await readFile(file, "utf8"));
    if (FIXTURE_DRIVER_MARKERS.some((marker) => content.includes(marker))) {
      violations.push(relative);
    }
  }

  if (violations.length > 0) {
    console.error("Fixture isolation violation: CrossRuntimeReconciliationFixtureDriver referenced outside test context:");
    for (const v of violations) console.error(`  - ${v}`);
    console.error("\nThis driver simulates an unimplemented real resolution (no staff auth exists yet, AGENTS.md v4.30 D3)");
    console.error("and must only be used from test files or tests/integration, never from production code.");
    process.exitCode = 1;
    return;
  }

  console.log(`check-fixture-isolation: OK — scanned ${files.length} files, no production reference found.`);
}

const root = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;
main(root).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
