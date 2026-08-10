import { QC_THEME_CORE } from "./theme-package";
import type { MotionProfile } from "./motion-profile";

/**
 * Asset manifest entry (M06 Web Full Vertical Slice Tranche 5, `07_26
 * v1.1` §13/§17.3). Fields are `07_14 v1.0` §12 verbatim ("Campi minimi:
 * assetId, semanticRole, themeId, version, sourceJobId, strategy,
 * sourceCell/frame, dimensions, format, hash, license/provenance, alt
 * description, motion fallback, maturity profiles, publication state") —
 * no field invented, no field dropped.
 */
export interface AssetManifestEntry {
  assetId: string;
  semanticRole: string;
  themeId: string;
  version: string;
  sourceJobId: string;
  strategy: "SCENE_BATCH" | "BATCH_SHEET" | "SPRITE_SHEET" | "DEDICATED_ASSET";
  sourceCell: string;
  dimensions: { width: number; height: number };
  format: "SVG" | "PNG" | "WEBP" | "AVIF";
  /** `sha256:<hex>` of the exact published asset bytes. */
  hash: string;
  license: string;
  altDescription: string;
  /** `07_14` §11: every essential animation must have an equivalent static state. `undefined` for assets that are inherently static already (nothing to fall back from). */
  motionFallback?: string;
  maturityProfiles: Array<"YOUNG" | "STANDARD" | "MATURE">;
  publicationState: "CANDIDATE" | "PUBLISHED" | "REJECTED";
}

export interface ResolvedSemanticRole {
  semanticRole: string;
  /** `MANIFEST` when a published, theme-matching entry was found; `FALLBACK` when `QC-THEME-CORE` was used instead — never throws, never blocks (`07_14` §18, `07_26` §13 "missing-asset fallback"). */
  source: "MANIFEST" | "FALLBACK";
  assetId?: string;
  themeId: string;
  altDescription: string;
  /** The motion profile actually applied — may differ from the requested one if the resolved entry has no `motionFallback` for `REDUCED` (falls back to `STANDARD`, since a missing reduced-motion asset must never block the stage). */
  appliedMotionProfile: MotionProfile;
  dimensions?: { width: number; height: number };
}

function fallbackDescription(semanticRole: string): string {
  return semanticRole.replace(/[._]/g, " ");
}

/**
 * Resolves a single semantic role to a manifest entry, honoring theme and
 * motion profile, with a mandatory, non-blocking fallback to
 * `QC-THEME-CORE` (`07_14` §18 acceptance criterion: "QC-THEME-CORE
 * funzionante senza asset academy"). Only `PUBLISHED` entries for the
 * requested `themeId` are eligible — a `CANDIDATE`/`REJECTED` entry, a
 * theme mismatch, or no entry at all all resolve to the same fallback
 * path, deliberately indistinguishable to the caller (the stage must
 * render identically either way).
 */
export function resolveSemanticRole(
  semanticRole: string,
  manifest: AssetManifestEntry[],
  motionProfile: MotionProfile,
  themeId: string,
): ResolvedSemanticRole {
  const entry = manifest.find((e) => e.semanticRole === semanticRole && e.themeId === themeId && e.publicationState === "PUBLISHED");
  if (!entry) {
    return {
      semanticRole,
      source: "FALLBACK",
      themeId: QC_THEME_CORE.themeId,
      altDescription: fallbackDescription(semanticRole),
      appliedMotionProfile: "STANDARD",
    };
  }
  const appliedMotionProfile: MotionProfile = motionProfile === "REDUCED" && entry.motionFallback ? "REDUCED" : "STANDARD";
  return {
    semanticRole,
    source: "MANIFEST",
    assetId: entry.assetId,
    themeId: entry.themeId,
    altDescription: entry.altDescription,
    appliedMotionProfile,
    dimensions: entry.dimensions,
  };
}

/** Resolves every semantic role a scene declares, in order — convenience wrapper over `resolveSemanticRole`. */
export function resolveSceneAssets(
  semanticRoles: string[],
  manifest: AssetManifestEntry[],
  motionProfile: MotionProfile,
  themeId: string,
): ResolvedSemanticRole[] {
  return semanticRoles.map((role) => resolveSemanticRole(role, manifest, motionProfile, themeId));
}
