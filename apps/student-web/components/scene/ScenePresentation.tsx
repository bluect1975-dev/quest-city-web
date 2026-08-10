"use client";

import { useEffect, useState } from "react";
import {
  resolveSceneAssets,
  pickMotionProfile,
  ACADEMY_ASSET_MANIFEST,
  type MotionProfile,
  type ResolvedSemanticRole,
} from "@quest-city-web/theme-system";

export interface ScenePresentationProps {
  /** Content-declared semantic roles (07_08 §4) — never a filename, resolved here at runtime. */
  semanticRoles: string[];
  themeId?: string;
}

/**
 * Real semantic-role -> asset resolution at the presentation boundary
 * (M06 Web Full Vertical Slice Tranche 5, `07_26 v1.1` §12 acceptance
 * criterion 4: "il campo `semanticRoles` è consumato a runtime"). Content
 * (`@quest-city-web/content-runtime`) only ever declares role strings —
 * this component is the one place that turns them into real assets,
 * keeping content/presentation/engine logic separate (this authorization's
 * explicit constraint). Reads `prefers-reduced-motion` once on mount and
 * on subsequent OS-level changes, applying the resulting `MotionProfile`
 * theme-wide (`07_14` §11), not per engine. Every role always renders
 * something — a real asset or the always-available `QC-THEME-CORE`
 * fallback (`07_14` §18) — never a blocked or missing render.
 */
function readInitialMotionProfile(): MotionProfile {
  if (typeof window === "undefined" || !window.matchMedia) return "STANDARD";
  return pickMotionProfile(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function ScenePresentation({ semanticRoles, themeId = "QC-THEME-ACADEMY" }: ScenePresentationProps) {
  const [motionProfile, setMotionProfile] = useState<MotionProfile>(readInitialMotionProfile);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => setMotionProfile(pickMotionProfile(event.matches));
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const resolved = resolveSceneAssets(semanticRoles, ACADEMY_ASSET_MANIFEST, motionProfile, themeId);

  return (
    <div className="scenePresentation" data-motion-profile={motionProfile}>
      {resolved.map((role) => (
        <SceneAsset key={role.semanticRole} resolved={role} />
      ))}
    </div>
  );
}

function assetVariantClassName(semanticRole: string): string {
  if (semanticRole.startsWith("scene.")) return "sceneAssetBackground";
  if (semanticRole.startsWith("character.")) return "sceneAssetCharacter";
  return "sceneAsset";
}

function SceneAsset({ resolved }: { resolved: ResolvedSemanticRole }) {
  if (resolved.source === "FALLBACK") {
    return (
      <div
        className={`sceneAssetFallback ${assetVariantClassName(resolved.semanticRole)}`}
        role="img"
        aria-label={resolved.altDescription}
        data-semantic-role={resolved.semanticRole}
        data-fallback="true"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG theme assets are tiny, already vector, and resolved at runtime by assetId; next/image's raster optimizer buys nothing here.
    <img
      className={`sceneAsset ${assetVariantClassName(resolved.semanticRole)}`}
      src={`/theme-assets/academy/${resolved.assetId}.svg`}
      alt={resolved.altDescription}
      data-semantic-role={resolved.semanticRole}
      data-asset-id={resolved.assetId}
      loading="eager"
    />
  );
}
