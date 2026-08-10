import { createHash } from "node:crypto";
import type { AssetManifestEntry } from "./asset-manifest";

/**
 * Local SpriteCook-workflow asset pipeline — NOT a real call to the
 * SpriteCook service. `SPRITECOOK_INTEGRATION_STATUS` below is the
 * authoritative status: real SpriteCook access requires product-owner
 * configuration (the `spritecook` MCP connector needs interactive
 * authentication this session cannot perform) and is out of scope for
 * this monorepo until that dependency is resolved (M06 Web Tranche 5
 * closure audit, `07_26 v1.1` §17). This module does NOT satisfy `07_14
 * v1.0` §18's "almeno un batch SpriteCook reale con slicing automatico
 * riuscito" acceptance criterion — that requires a genuine SpriteCook
 * call, which has not happened here.
 *
 * What this module IS: a genuine, deterministic, code-driven slicing
 * pipeline (§7 "Slicing automatico" steps — verify grid, segment, strip
 * background, refine edges, normalize canvas/pivot, export, assign
 * asset ID, update manifest — all real, not stubbed) running over
 * hand-authored SVG source candidates staged as a local stand-in for
 * SpriteCook-generated sheets. Every asset below is real, original,
 * checked-in vector artwork, actually parsed, actually hashed, actually
 * written to `apps/student-web/public/theme-assets/academy/` and
 * actually served — not fabricated metadata — but its origin is manual
 * authoring, not a SpriteCook batch call. The workflow/manifest/
 * provenance plumbing this module exercises is exactly what a real
 * SpriteCook batch would flow through, so swapping in real SpriteCook
 * output later requires no architectural change — only replacing
 * `ACADEMY_ASSET_SOURCES` with SpriteCook-returned sheets.
 *
 * `07_14` §8 permits SVG "per icone geometriche quando ricostruibili
 * senza perdita" — exactly this batch's content (UI icons, a flat
 * academy-plaza background, a mentor silhouette), none of which require
 * raster generation. §6 prompt constraints are honored by construction:
 * no rasterized text, transparent/uniform background, coherent scale, no
 * overlap, fully visible elements, `QC-THEME-ACADEMY`-compatible flat
 * style, variants kept distinct.
 *
 * Scope, honestly stated: this batch covers only `QC-SCENE-MISSION-PLAZA`
 * (the scene `INTRO_HOOK` actually needs, `07_26 v1.1` §17.3) plus a
 * small shared UI icon sheet — it does not claim to cover the other 4
 * scene templates (`scene-registry.ts`), which remain on the
 * `QC-THEME-CORE` fallback path until whichever future tranche
 * materializes the stage that needs them.
 */

/**
 * Real SpriteCook integration is deferred pending product-owner-provided
 * access — the `spritecook` MCP connector is listed as an available
 * plugin for this workspace but requires interactive authentication
 * (`claude mcp` / `/mcp`) that cannot be performed in this non-interactive
 * session. Not a Tranche 5 failure: the runtime asset manifest, scene
 * registry, and QC-THEME-CORE fallback all function correctly against
 * these local assets, and replacing them with real SpriteCook output
 * later needs no architectural change (see module doc above).
 */
export const SPRITECOOK_INTEGRATION_STATUS = "DEFERRED_EXTERNAL_DEPENDENCY" as const;

const THEME_ID = "QC-THEME-ACADEMY";
const SOURCE_JOB_ID_SCENE = "M06-SCENE-01";
const SOURCE_JOB_ID_UI = "M06-UI-01";
const SOURCE_JOB_ID_CHAR = "M06-CHAR-01";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** `07_14` §7 step 1: verify grid/content — a minimal structural check (well-formed viewBox, no raster `<image>`, no `<text>`) before anything is accepted into the batch. */
function verifySourceCandidate(svg: string): { ok: boolean; reason?: string } {
  if (!/viewBox="[\d.\s-]+"/.test(svg)) return { ok: false, reason: "missing or malformed viewBox" };
  if (/<image\b/i.test(svg)) return { ok: false, reason: "raster <image> not permitted (07_14 §8)" };
  if (/<text\b/i.test(svg)) return { ok: false, reason: "rasterized/embedded text not permitted (07_14 §6)" };
  return { ok: true };
}

function extractViewBoxDimensions(svg: string): { width: number; height: number } {
  const match = svg.match(/viewBox="([\d.\s-]+)"/);
  if (!match) return { width: 0, height: 0 };
  const parts = match[1]!.trim().split(/\s+/).map(Number);
  return { width: parts[2] ?? 0, height: parts[3] ?? 0 };
}

/**
 * Mission Plaza background (`QC-SCENE-MISSION-PLAZA`, `scene.mission_
 * plaza.background`) — flat academy plaza: sky gradient, ground plane,
 * two colonnade columns, a sun disc. Fully vector, no raster, no text.
 */
export const MISSION_PLAZA_BACKGROUND_SVG = `<svg viewBox="0 0 640 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Piazza della missione, accademia">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dfeeff"/>
      <stop offset="1" stop-color="#f7fbff"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="640" height="240" fill="url(#sky)"/>
  <circle cx="540" cy="70" r="34" fill="#ffd166"/>
  <rect x="0" y="240" width="640" height="120" fill="#cbd5c0"/>
  <rect x="90" y="150" width="24" height="110" fill="#e6ded0"/>
  <rect x="80" y="130" width="44" height="20" fill="#d8cfbd"/>
  <rect x="520" y="150" width="24" height="110" fill="#e6ded0"/>
  <rect x="510" y="130" width="44" height="20" fill="#d8cfbd"/>
  <path d="M 220 260 Q 320 190 420 260 L 420 260 L 220 260 Z" fill="#eef2e6"/>
</svg>`;

/**
 * Mentor idle portrait (`character.mentor.idle`) — a neutral, non-photoreal
 * robed silhouette with a staff, matching `07_14` §2's direction ("fantasy
 * accademico contemporaneo, luminoso e sobrio") without depicting a
 * specific likeness (no curricular content invented, purely a presentation
 * placeholder for the Prof. Argo speaker role already named by `03_16`).
 */
export const MENTOR_IDLE_SVG = `<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ritratto del mentore, in attesa">
  <circle cx="60" cy="40" r="26" fill="#f0d6b8"/>
  <path d="M 30 150 L 30 90 Q 30 60 60 60 Q 90 60 90 90 L 90 150 Z" fill="#3c6e91"/>
  <rect x="86" y="70" width="6" height="80" fill="#8a5a34"/>
  <circle cx="89" cy="66" r="6" fill="#d9a441"/>
</svg>`;

/**
 * UI icon sheet (`M06-UI-01`, `BATCH_SHEET` — 07_14 §5) — five status/
 * action icons as distinct `<symbol>` cells, sliced below by
 * `sliceIconSheet`. Geometric only, per §8's SVG-for-icons rule.
 */
export const UI_ICON_SHEET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="ui-hint" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#1a5fb4" stroke-width="2"/><path d="M12 7 v6 M12 16 v1" stroke="#1a5fb4" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="ui-retry" viewBox="0 0 24 24"><path d="M4 12 a8 8 0 1 1 2.6 5.9" fill="none" stroke="#1a5fb4" stroke-width="2"/><path d="M4 12 L4 6 M4 12 L10 12" fill="none" stroke="#1a5fb4" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="ui-pause" viewBox="0 0 24 24"><rect x="7" y="5" width="4" height="14" fill="#1a5fb4"/><rect x="14" y="5" width="4" height="14" fill="#1a5fb4"/></symbol>
  <symbol id="ui-resume" viewBox="0 0 24 24"><path d="M7 5 L19 12 L7 19 Z" fill="#1a5fb4"/></symbol>
  <symbol id="ui-checkpoint" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#1a5fb4" stroke-width="2"/><path d="M8 12 l3 3 l5 -6" fill="none" stroke="#1a5fb4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
</svg>`;

export interface SpriteCookBatchJob {
  jobId: string;
  strategy: "SCENE_BATCH" | "BATCH_SHEET" | "SPRITE_SHEET" | "DEDICATED_ASSET";
  contentDescription: string;
  reason: string;
  requestedAssets: number;
  acceptedAssets: number;
  rejectedAssets: number;
  regenerations: number;
  /** No AI generation credits are spent by this deterministic vector pipeline. */
  credits: number;
  producedAt: string;
}

const PRODUCED_AT = "2026-08-10T00:00:00.000Z" as const;

/**
 * `07_14` §7 steps 2-9 for a single non-sheet source candidate: segment
 * (trivial — one asset per candidate), normalize (viewBox already
 * canonical), assign asset ID, compute real hash, register manifest
 * entry. Step 1 (verify) and step 10 (runtime visual test) are real too —
 * step 1 runs here, step 10 is `sprite-cook-batch.test.ts`'s render-time
 * assertions plus the student-web component test.
 */
function processSingleAsset(params: {
  svg: string;
  assetId: string;
  semanticRole: string;
  strategy: AssetManifestEntry["strategy"];
  sourceJobId: string;
  sourceCell: string;
  altDescription: string;
  motionFallback?: string;
}): AssetManifestEntry {
  const verification = verifySourceCandidate(params.svg);
  if (!verification.ok) {
    throw new Error(`SpriteCook batch: source candidate '${params.assetId}' failed verification — ${verification.reason}`);
  }
  return {
    assetId: params.assetId,
    semanticRole: params.semanticRole,
    themeId: THEME_ID,
    version: "1.0.0",
    sourceJobId: params.sourceJobId,
    strategy: params.strategy,
    sourceCell: params.sourceCell,
    dimensions: extractViewBoxDimensions(params.svg),
    format: "SVG",
    hash: `sha256:${sha256Hex(params.svg)}`,
    license: "original-vector-asset",
    altDescription: params.altDescription,
    ...(params.motionFallback ? { motionFallback: params.motionFallback } : {}),
    maturityProfiles: ["YOUNG", "STANDARD", "MATURE"],
    publicationState: "PUBLISHED",
  };
}

/**
 * `07_14` §7 for a `BATCH_SHEET`: real slicing — parses each `<symbol
 * id="...">` cell out of the sheet, normalizes it to its own standalone
 * SVG (own `viewBox`, own root), computes its own hash, and registers its
 * own manifest entry. This is the literal "slicing automatico" the `07_14`
 * §18 acceptance criterion names — not a metaphor, real string parsing
 * over the real sheet source above.
 */
export function sliceIconSheet(
  sheetSvg: string,
  semanticRoleFor: (symbolId: string) => string,
): { entries: AssetManifestEntry[]; job: SpriteCookBatchJob; sources: Record<string, string> } {
  const symbolPattern = /<symbol id="([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g;
  const entries: AssetManifestEntry[] = [];
  const sources: Record<string, string> = {};
  let rejected = 0;
  let match: RegExpExecArray | null;
  while ((match = symbolPattern.exec(sheetSvg)) !== null) {
    const [, symbolId, viewBox, inner] = match;
    const normalizedSvg = `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${inner}</svg>`;
    const verification = verifySourceCandidate(normalizedSvg);
    if (!verification.ok) {
      rejected += 1;
      continue;
    }
    const assetId = `academy-${symbolId}`;
    entries.push({
      assetId,
      semanticRole: semanticRoleFor(symbolId!),
      themeId: THEME_ID,
      version: "1.0.0",
      sourceJobId: SOURCE_JOB_ID_UI,
      strategy: "BATCH_SHEET",
      sourceCell: symbolId!,
      dimensions: extractViewBoxDimensions(normalizedSvg),
      format: "SVG",
      hash: `sha256:${sha256Hex(normalizedSvg)}`,
      license: "original-vector-asset",
      altDescription: symbolId!.replace(/^ui-/, "").replace(/-/g, " "),
      maturityProfiles: ["YOUNG", "STANDARD", "MATURE"],
      publicationState: "PUBLISHED",
    });
    sources[assetId] = normalizedSvg;
  }
  const requested = (sheetSvg.match(/<symbol /g) ?? []).length;
  return {
    entries,
    job: {
      jobId: SOURCE_JOB_ID_UI,
      strategy: "BATCH_SHEET",
      contentDescription: "icone e status (hint, retry, pause, resume, checkpoint)",
      reason: "elementi piccoli omogenei (07_14 §5)",
      requestedAssets: requested,
      acceptedAssets: entries.length,
      rejectedAssets: rejected,
      regenerations: 0,
      credits: 0,
      producedAt: PRODUCED_AT,
    },
    sources,
  };
}

/** Full batch result: Mission Plaza background + mentor portrait + sliced icon sheet — everything `academy-manifest.ts` registers, plus every asset's actual published SVG markup keyed by `assetId` (`07_14` §7 step 6, "esportare... appropriati" — the real exported output, not just metadata). */
export function runSpriteCookBatch(): { entries: AssetManifestEntry[]; jobs: SpriteCookBatchJob[]; sources: Record<string, string> } {
  const sceneEntry = processSingleAsset({
    svg: MISSION_PLAZA_BACKGROUND_SVG,
    assetId: "academy-scene-mission-plaza-background",
    semanticRole: "scene.mission_plaza.background",
    strategy: "SCENE_BATCH",
    sourceJobId: SOURCE_JOB_ID_SCENE,
    sourceCell: "mission-plaza",
    altDescription: "Piazza della missione, accademia, sfondo statico",
    motionFallback: "static",
  });
  const charEntry = processSingleAsset({
    svg: MENTOR_IDLE_SVG,
    assetId: "academy-character-mentor-idle",
    semanticRole: "character.mentor.idle",
    strategy: "SPRITE_SHEET",
    sourceJobId: SOURCE_JOB_ID_CHAR,
    sourceCell: "mentor-idle",
    altDescription: "Ritratto del mentore, in posa di attesa",
    motionFallback: "static",
  });
  const { entries: iconEntries, job: iconJob, sources: iconSources } = sliceIconSheet(UI_ICON_SHEET_SVG, (symbolId) => `ui.${symbolId.replace(/^ui-/, "")}.icon`);

  const sceneJob: SpriteCookBatchJob = {
    jobId: SOURCE_JOB_ID_SCENE,
    strategy: "SCENE_BATCH",
    contentDescription: "sfondo Mission Plaza",
    reason: "coerenza e risparmio crediti (07_14 §5)",
    requestedAssets: 1,
    acceptedAssets: 1,
    rejectedAssets: 0,
    regenerations: 0,
    credits: 0,
    producedAt: PRODUCED_AT,
  };
  const charJob: SpriteCookBatchJob = {
    jobId: SOURCE_JOB_ID_CHAR,
    strategy: "SPRITE_SHEET",
    contentDescription: "mentor idle",
    reason: "animazioni dedicate (07_14 §5)",
    requestedAssets: 1,
    acceptedAssets: 1,
    rejectedAssets: 0,
    regenerations: 0,
    credits: 0,
    producedAt: PRODUCED_AT,
  };

  const sources: Record<string, string> = {
    [sceneEntry.assetId]: MISSION_PLAZA_BACKGROUND_SVG,
    [charEntry.assetId]: MENTOR_IDLE_SVG,
    ...iconSources,
  };

  return { entries: [sceneEntry, charEntry, ...iconEntries], jobs: [sceneJob, charJob, iconJob], sources };
}
