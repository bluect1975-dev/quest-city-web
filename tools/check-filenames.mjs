#!/usr/bin/env node
// Reject non-canonical filenames (download-artifact suffixes such as "(1)",
// "%20", trailing spaces, or "copy"/"backup"/"old" suffixes). Mirrors the
// intent of quest-city-roblox/tools/ci/check_filenames.py, adapted to Node.
//
// Usage: node tools/check-filenames.mjs [root]
// Exit code 0 if every filename is clean, 1 otherwise.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");
const ALLOWLIST_PATH = path.join(__dirname, "filename-check-allowlist.txt");

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".pnpm-store",
]);

const SUFFIX_COPY_NUMBER = /\(\d+\)(?=\.[^./]+$|$)/;
const SUFFIX_ENCODED_SPACE = /%20/;
const SUFFIX_TRAILING_SPACE_BEFORE_EXT = / +(?=\.[^./]+$)/;
const BAD_WORDS = ["copy", "backup", "old"];

async function loadAllowlist() {
  try {
    const content = await readFile(ALLOWLIST_PATH, "utf8");
    return new Set(
      content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    );
  } catch {
    return new Set();
  }
}

function checkFilename(filename) {
  const reasons = [];
  if (SUFFIX_COPY_NUMBER.test(filename)) reasons.push("copy-number suffix like '(1)'");
  if (SUFFIX_ENCODED_SPACE.test(filename)) reasons.push("URL-encoded space '%20'");
  if (SUFFIX_TRAILING_SPACE_BEFORE_EXT.test(filename)) reasons.push("trailing space before extension");

  const ext = path.extname(filename);
  const stem = path.basename(filename, ext).toLowerCase();
  for (const badWord of BAD_WORDS) {
    if (new RegExp(`[\\s_-]${badWord}$`).test(stem)) {
      reasons.push(`non-canonical suffix '${badWord}'`);
    }
  }
  return reasons;
}

async function walk(dir, root, violations, grandfathered, allowlist) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), root, violations, grandfathered, allowlist);
    } else if (entry.isFile()) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath).split(path.sep).join("/");
      const reasons = checkFilename(entry.name);
      if (reasons.length > 0) {
        const entryText = `${relPath}: ${reasons.join(", ")}`;
        if (allowlist.has(relPath)) {
          grandfathered.push(entryText);
        } else {
          violations.push(entryText);
        }
      }
    }
  }
}

async function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;
  const allowlist = await loadAllowlist();
  const violations = [];
  const grandfathered = [];
  await walk(root, root, violations, grandfathered, allowlist);

  if (grandfathered.length > 0) {
    console.log(`${grandfathered.length} pre-existing violation(s) grandfathered:`);
    for (const entry of grandfathered) console.log(`  - ${entry}`);
    console.log("");
  }

  if (violations.length > 0) {
    console.error("Non-canonical filenames found:");
    for (const entry of violations) console.error(`  - ${entry}`);
    console.error(`\n${violations.length} file(s) must be renamed or removed before merge.`);
    process.exitCode = 1;
    return;
  }

  console.log("Filename check passed: no new download-artifact suffixes found.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
