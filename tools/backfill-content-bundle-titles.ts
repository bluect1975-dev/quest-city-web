#!/usr/bin/env node
// Pilot Product Experience Residual Closure — Tranche H2.
// Closes NEW-GAP-CONTENT-BUNDLE-NO-TITLE-01 for the 7 known M06 pilot
// content_bundle rows, using ContentBundleRepository.updateTitle (the
// sanctioned repository write) rather than raw SQL, per the mission's own
// rule against direct SQL for a value a real API surface should own.
//
// Every title below is traced to a real, cited source — never invented:
//
//   - `bnd_web_m4_mat_m06_balance`: direct canonical "Titolo studente"
//     match, `docs/03-mathematics/03_14_..._Balance_Machine_Challenge_
//     Package_Specification_v1_0.md` (challenge MAT-M06-VS-CH001).
//   - The other 6 (tranche1/2/3/4/5/6) each cover one or two of the 8
//     canonical M06 Web stage types (`07_13 §4`, quoted verbatim:
//     INTRO_HOOK, PREREQUISITE_CHECK, MICRO_LESSON, QUICK_QUESTION_SET,
//     GUIDED_PRACTICE, INTERACTIVE_EXERCISE, BALANCE_MACHINE_CHALLENGE,
//     REFLECTION_AND_RESULT). Their title is composed from the real,
//     already-shipped lesson title ("Equilibrio: capire e risolvere
//     un'equazione", `docs/03-mathematics/03_13_..._Lesson_Package_
//     Specification_v1_0.md` + `quest-city-roblox/content/mathematics/
//     MAT-M06/U01/L01/localization/it-IT.json`) plus the real,
//     already-shipped stage-type label(s) from
//     `packages/i18n/src/locales/it-IT/student-web.json`'s
//     `path.stageTypeLabel` map (used today by the M06 full-sequence
//     stepper) — never a free-text title invented for this script.
//   - tranche6 stands for the whole 8-stage sequence's final reflection
//     (its own manifest source comment: "standalone REFLECTION_AND_RESULT
//     for the unified 8-stage sequence — reuses all prior 5 bundles'
//     content"), so it is labelled "Riepilogo finale" (not just
//     "Riepilogo", which tranche1 already uses for its own partial
//     reflection sub-phase) to keep the two distinguishable — an editorial
//     framing of a real, cited fact, not a new fabricated fact.
//
// Idempotent: safe to re-run, always sets the exact same 7 titles.
//
// Usage:
//   pnpm --filter @quest-city-web/tools run backfill:content-bundle-titles

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { ContentBundleRepository } from "@quest-city-web/attempts";
import {
  WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE1_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE2_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE3_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE4_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE5_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE6_REFLECTION_CONTENT_BUNDLE_PUBLIC_ID,
} from "@quest-city-web/content-runtime";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const M06_LESSON_TITLE = "Equilibrio: capire e risolvere un'equazione";

const TITLES: Array<{ publicId: string; title: string }> = [
  { publicId: WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID, title: "Riattiva la Balance Machine" },
  { publicId: WEB_TRANCHE5_CONTENT_BUNDLE_PUBLIC_ID, title: `${M06_LESSON_TITLE} — Introduzione` },
  { publicId: WEB_TRANCHE3_CONTENT_BUNDLE_PUBLIC_ID, title: `${M06_LESSON_TITLE} — Verifica e Lezione` },
  { publicId: WEB_TRANCHE2_CONTENT_BUNDLE_PUBLIC_ID, title: `${M06_LESSON_TITLE} — Domande rapide` },
  { publicId: WEB_TRANCHE1_CONTENT_BUNDLE_PUBLIC_ID, title: `${M06_LESSON_TITLE} — Pratica guidata e Riepilogo` },
  { publicId: WEB_TRANCHE4_CONTENT_BUNDLE_PUBLIC_ID, title: `${M06_LESSON_TITLE} — Esercizio` },
  { publicId: WEB_TRANCHE6_REFLECTION_CONTENT_BUNDLE_PUBLIC_ID, title: `${M06_LESSON_TITLE} — Riepilogo finale` },
];

function assertGitRootMatches(): void {
  try {
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    const normalizedGitRoot = path.resolve(gitRoot);
    const normalizedRepoRoot = path.resolve(REPO_ROOT);
    if (normalizedGitRoot.toLowerCase() !== normalizedRepoRoot.toLowerCase()) {
      throw new Error(
        `Git root (${normalizedGitRoot}) does not match the expected repository root (${normalizedRepoRoot}) — refusing to run.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not match")) {
      throw error;
    }
    // git not available or not a repo — best-effort only, same as seed-content-bundle.ts.
  }
}

async function main(): Promise<void> {
  assertGitRootMatches();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the backfill.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const repo = new ContentBundleRepository(pool);

  try {
    let updated = 0;
    let skippedNotFound = 0;
    for (const { publicId, title } of TITLES) {
      const result = await repo.updateTitle(publicId, title);
      if (result) {
        updated += 1;
        // eslint-disable-next-line no-console -- controlled, non-secret summary output.
        console.log(`Set title for '${publicId}': "${title}"`);
      } else {
        skippedNotFound += 1;
        // eslint-disable-next-line no-console -- controlled, non-secret summary output.
        console.log(`Skipped '${publicId}': no matching content_bundle row (not seeded in this environment).`);
      }
    }
    // eslint-disable-next-line no-console -- controlled, non-secret summary output.
    console.log(`Done: ${updated} title(s) set, ${skippedNotFound} skipped (not found).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
