#!/usr/bin/env node
// CLI entrypoint for the WEB-I18N-FOUNDATION I18N-B anti-hardcoding gate.
// The reusable scanning logic lives in check-i18n-strings-core.mjs (no
// shebang, safely `import`-able from Vitest) — this file only wires it up
// to argv/stdout/exitCode. See check-i18n-strings-core.mjs for the full
// rationale and the gate's own documentation.
//
// Usage: node tools/check-i18n-strings.mjs [root]
// Exit code 0 if clean, 1 if any violation is found.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "./check-i18n-strings-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

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
