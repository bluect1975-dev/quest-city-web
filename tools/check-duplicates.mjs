#!/usr/bin/env node
// Detect byte-identical duplicate files across the repository (05_01 §12
// CI quality gate: "naming/duplicate check"). Mirrors the intent of
// quest-city-roblox/tools/ci/check_duplicates.py, adapted to Node for this
// TypeScript monorepo.
//
// Usage: node tools/check-duplicates.mjs [root]
// Exit code 0 if no unexpected duplicate is found, 1 otherwise.

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");
const ALLOWLIST_PATH = path.join(__dirname, "duplicate-check-allowlist.txt");

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".pnpm-store",
]);

// Runtime-generated, gitignored data — not source, and not meaningful for a
// duplicate-source-file check. The Postgres data volume in particular
// legitimately contains many byte-identical files by design (template
// database catalog files copied verbatim for template0/template1), which
// would otherwise flood this check with false positives every time the
// local environment has actually been started.
const EXCLUDED_RELATIVE_PATHS = new Set(["infrastructure/database/data"]);

async function loadAllowlist() {
  try {
    const content = await readFile(ALLOWLIST_PATH, "utf8");
    const groups = new Set();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed
        .split(",")
        .map((p) => p.trim())
        .sort();
      groups.add(parts.join("|"));
    }
    return groups;
  } catch {
    return new Set();
  }
}

async function hashFile(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

// Local, gitignored env files (.env, .env.local, .env.*.local) are never
// committed and must never fail a "duplicate file" check just because a
// developer copied .env.example locally — only the tracked .env.example
// itself is in scope.
function isIgnoredLocalEnvFile(filename) {
  return filename !== ".env.example" && /^\.env(\..+)?$/.test(filename);
}

async function walk(dir, root, byHash) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      const childPath = path.join(dir, entry.name);
      const childRelPath = path.relative(root, childPath).split(path.sep).join("/");
      if (EXCLUDED_RELATIVE_PATHS.has(childRelPath)) continue;
      await walk(childPath, root, byHash);
    } else if (entry.isFile()) {
      if (isIgnoredLocalEnvFile(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const { size } = await stat(fullPath);
      if (size === 0) continue; // Empty files are not meaningful duplicates.
      const hash = await hashFile(fullPath);
      const relPath = path.relative(root, fullPath).split(path.sep).join("/");
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(relPath);
    }
  }
}

async function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;
  const allowlist = await loadAllowlist();
  const byHash = new Map();
  await walk(root, root, byHash);

  const unexpectedGroups = [];
  for (const paths of byHash.values()) {
    if (paths.length < 2) continue;
    const sorted = [...paths].sort();
    if (allowlist.has(sorted.join("|"))) continue;
    unexpectedGroups.push(sorted);
  }

  if (unexpectedGroups.length > 0) {
    console.error("Unexpected byte-identical duplicate files found:");
    for (const group of unexpectedGroups) {
      console.error(`  - ${group.join("  ==  ")}`);
    }
    console.error(`\n${unexpectedGroups.length} duplicate group(s) must be resolved before merge.`);
    process.exitCode = 1;
    return;
  }

  console.log("Duplicate check passed: no unexpected identical files found.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
