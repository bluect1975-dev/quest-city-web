import { runSpriteCookBatch } from "./sprite-cook-batch";
import type { AssetManifestEntry } from "./asset-manifest";
import type { SpriteCookBatchJob } from "./sprite-cook-batch";

/**
 * Published `QC-THEME-ACADEMY` asset manifest (M06 Web Full Vertical
 * Slice Tranche 5) — the actual output of the local SpriteCook-workflow
 * pipeline in `sprite-cook-batch.ts` (`SPRITECOOK_INTEGRATION_STATUS =
 * "DEFERRED_EXTERNAL_DEPENDENCY"` — this is real, published data, not
 * re-invented, but its assets are locally staged, not SpriteCook output;
 * see that module's doc comment), computed once at module load. Consumed
 * by `resolveSceneAssets`/`resolveSemanticRole` (`asset-manifest.ts`)
 * exactly like any other manifest; the fallback path is identical
 * whether an entry is simply absent or present-but-unpublished.
 */
const batchResult = runSpriteCookBatch();

export const ACADEMY_ASSET_MANIFEST: AssetManifestEntry[] = batchResult.entries;
export const ACADEMY_SPRITE_COOK_JOBS: SpriteCookBatchJob[] = batchResult.jobs;
/** `assetId -> published SVG markup`, real batch output (locally staged — see `SPRITECOOK_INTEGRATION_STATUS`) — the source `tools/generate-theme-assets.ts` writes to `apps/student-web/public/theme-assets/academy/`. */
export const ACADEMY_ASSET_SOURCES: Record<string, string> = batchResult.sources;
