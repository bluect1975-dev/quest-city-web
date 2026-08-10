#!/usr/bin/env node
// Writes the local SpriteCook-workflow batch output
// (`@quest-city-web/theme-system`'s `runSpriteCookBatch()`,
// `SPRITECOOK_INTEGRATION_STATUS = "DEFERRED_EXTERNAL_DEPENDENCY"` — this
// is NOT a real SpriteCook call, see that module's doc comment) to
// `apps/student-web/public/theme-assets/academy/` (M06 Web Full Vertical
// Slice Tranche 5, `07_26 v1.1` §13/§17). This does NOT satisfy `07_14
// v1.0` §18's "almeno un batch SpriteCook reale con slicing automatico
// riuscito" acceptance criterion, which requires a genuine SpriteCook
// call. It does perform the real `07_14` §7 step 6 ("esportare
// PNG/WebP/SVG appropriati") for this locally-staged batch — actual
// files, actual bytes, one per published `assetId`, filename convention
// owned entirely by the presentation layer (never referenced by content)
// — so swapping in real SpriteCook output later needs no changes here.
//
// Usage:
//   pnpm --filter @quest-city-web/tools run generate:theme-assets

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACADEMY_ASSET_MANIFEST, ACADEMY_ASSET_SOURCES } from "@quest-city-web/theme-system";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "apps", "student-web", "public", "theme-assets", "academy");

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  let written = 0;
  for (const entry of ACADEMY_ASSET_MANIFEST) {
    const source = ACADEMY_ASSET_SOURCES[entry.assetId];
    if (!source) {
      throw new Error(`No source markup found for published asset '${entry.assetId}' — refusing to leave a manifest entry without a real file.`);
    }
    const filePath = path.join(OUTPUT_DIR, `${entry.assetId}.svg`);
    writeFileSync(filePath, source, "utf8");
    written += 1;
  }
  // eslint-disable-next-line no-console -- controlled, non-secret summary output.
  console.log(`Wrote ${written} real theme asset file(s) to ${OUTPUT_DIR}`);
}

main();
