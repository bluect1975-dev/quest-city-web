#!/usr/bin/env node
// WEB-I18N-FOUNDATION I18N-B anti-hardcoding gate (02_34 §9, AGENTS.md
// v4.31 D4): flags new literal, student/teacher-facing UI text in
// apps/student-web and apps/dashboard so copy is always sourced from a
// t(catalog, "key") lookup, never a hardcoded string.
//
// This is a foundation-scale heuristic line scanner (modeled on the same
// pragmatic approach as check-fixture-isolation.mjs), not a full JSX/AST
// parser. It fails closed on the common case -- a literal string placed
// directly as JSX text, or as a metadata title/description value -- and
// is not a substitute for code review.
//
// Usage: node tools/check-i18n-strings.mjs [root]
// Exit code 0 if clean, 1 if any violation is found.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

const SCAN_DIRS = [path.join("apps", "student-web"), path.join("apps", "dashboard")];
const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".pnpm-store"]);

function isAllowedContext(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (/\.test\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/\.spec\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (normalized.endsWith(".d.ts")) return true;
  return false;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// A JSX text node directly between tags: >TEXT<. An expression child like
// {t(...)} is excluded automatically because it contains { or }, which the
// capture group does not allow.
const JSX_TEXT_RE = />([^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*)</g;

// metadata.title / metadata.description assigned a literal string instead
// of a t(...) call.
const METADATA_STRING_RE = /\b(title|description)\s*:\s*"([^"]{3,})"/g;

// Allowed-by-shape exceptions (02_34 §9 / AGENTS.md v4.31 D4's stated
// false-positive classes): route paths, ID/enum-like tokens, technical
// log fragments, leftover expression wrappers.
function looksLikeIdentifierOrPath(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("/")) return true; // route path, e.g. /dashboard
  if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) return true; // ENUM_LIKE / error code
  if (/^\{.*\}$/.test(trimmed)) return true; // leftover expression wrapper
  return false;
}

async function walk(dir, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else if (/\.(tsx|jsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Scans `root`'s configured directories and returns a list of
 * { file, line, snippet } violations. Exported so tests can exercise it
 * directly against fixture directories without shelling out.
 */
export async function scan(root) {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const full = path.join(root, dir);
    try {
      await walk(full, files);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  const violations = [];
  for (const file of files) {
    const relative = path.relative(root, file);
    if (isAllowedContext(relative)) continue;

    const raw = await readFile(file, "utf8");
    const content = stripComments(raw);
    const lines = content.split("\n");

    lines.forEach((line, index) => {
      JSX_TEXT_RE.lastIndex = 0;
      let match;
      while ((match = JSX_TEXT_RE.exec(line))) {
        const text = match[1];
        if (looksLikeIdentifierOrPath(text)) continue;
        // The `>` opening this match is itself the second character of a
        // TypeScript arrow `=>` (e.g. `() => Promise<void>`), not a JSX
        // tag close — a false positive this line-based heuristic cannot
        // otherwise distinguish from real `>text<` JSX content.
        if (line[match.index - 1] === "=") continue;
        violations.push({ file: relative, line: index + 1, snippet: text.trim() });
      }
      METADATA_STRING_RE.lastIndex = 0;
      while ((match = METADATA_STRING_RE.exec(line))) {
        violations.push({ file: relative, line: index + 1, snippet: `${match[1]}: "${match[2]}"` });
      }
    });
  }
  return violations;
}

async function main(root) {
  const violations = await scan(root);
  if (violations.length > 0) {
    console.error("i18n hardcoding violation: literal UI text found outside a t() catalog lookup:");
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line}: "${v.snippet}"`);
    }
    console.error('\nWrap student/teacher-facing text in t(catalog, "key") and add the key to the it-IT catalog (02_34).');
    process.exitCode = 1;
    return;
  }
  console.log("check-i18n-strings: OK — scanned apps/student-web and apps/dashboard, no hardcoded UI text found.");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;
  main(root).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
