import { describe, expect, it } from "vitest";
import { resolveSceneAssets, resolveSemanticRole, type AssetManifestEntry } from "./asset-manifest";

const PUBLISHED_ENTRY: AssetManifestEntry = {
  assetId: "academy-scene-mission-plaza-background",
  semanticRole: "scene.mission_plaza.background",
  themeId: "QC-THEME-ACADEMY",
  version: "1.0.0",
  sourceJobId: "M06-SCENE-01",
  strategy: "SCENE_BATCH",
  sourceCell: "mission-plaza",
  dimensions: { width: 640, height: 360 },
  format: "SVG",
  hash: "sha256:abc",
  license: "original-vector-asset",
  altDescription: "Piazza della missione, accademia, sfondo statico",
  motionFallback: "static",
  maturityProfiles: ["YOUNG", "STANDARD", "MATURE"],
  publicationState: "PUBLISHED",
};

describe("semantic role resolution and missing-asset fallback (07_14 v1.0 §12/§18, 07_26 v1.1 §13)", () => {
  it("resolves a published, theme-matching entry from the manifest", () => {
    const resolved = resolveSemanticRole("scene.mission_plaza.background", [PUBLISHED_ENTRY], "STANDARD", "QC-THEME-ACADEMY");
    expect(resolved.source).toBe("MANIFEST");
    expect(resolved.assetId).toBe("academy-scene-mission-plaza-background");
    expect(resolved.altDescription).toBe("Piazza della missione, accademia, sfondo statico");
  });

  it("falls back to QC-THEME-CORE when no entry exists for the role — never throws", () => {
    const resolved = resolveSemanticRole("scene.does_not_exist.background", [PUBLISHED_ENTRY], "STANDARD", "QC-THEME-ACADEMY");
    expect(resolved.source).toBe("FALLBACK");
    expect(resolved.themeId).toBe("QC-THEME-CORE");
    expect(resolved.assetId).toBeUndefined();
  });

  it("falls back when the only entry is for a different theme (QC-THEME-ACADEMY <-> QC-THEME-CORE switch, 07_15 §16)", () => {
    const resolved = resolveSemanticRole("scene.mission_plaza.background", [PUBLISHED_ENTRY], "STANDARD", "QC-THEME-CORE");
    expect(resolved.source).toBe("FALLBACK");
  });

  it("falls back when the only entry is CANDIDATE (not yet published), not REJECTED-only either — an unpublished asset never blocks the stage", () => {
    const candidate: AssetManifestEntry = { ...PUBLISHED_ENTRY, publicationState: "CANDIDATE" };
    expect(resolveSemanticRole(candidate.semanticRole, [candidate], "STANDARD", "QC-THEME-ACADEMY").source).toBe("FALLBACK");
    const rejected: AssetManifestEntry = { ...PUBLISHED_ENTRY, publicationState: "REJECTED" };
    expect(resolveSemanticRole(rejected.semanticRole, [rejected], "STANDARD", "QC-THEME-ACADEMY").source).toBe("FALLBACK");
  });

  it("falls back to hash-mismatch-equivalent behavior: an entry present but effectively unusable resolves exactly like a missing one (07_15 §16 'hash errato')", () => {
    // Simulated by publicationState !== PUBLISHED, since a real corrupted-hash
    // asset would fail integrity verification upstream and never reach PUBLISHED.
    const corrupted: AssetManifestEntry = { ...PUBLISHED_ENTRY, publicationState: "REJECTED", hash: "sha256:0000" };
    const resolved = resolveSemanticRole(corrupted.semanticRole, [corrupted], "STANDARD", "QC-THEME-ACADEMY");
    expect(resolved.source).toBe("FALLBACK");
  });

  it("applies REDUCED motion profile when the entry declares a motionFallback", () => {
    const resolved = resolveSemanticRole("scene.mission_plaza.background", [PUBLISHED_ENTRY], "REDUCED", "QC-THEME-ACADEMY");
    expect(resolved.appliedMotionProfile).toBe("REDUCED");
  });

  it("degrades REDUCED to STANDARD when the entry has no motionFallback, rather than blocking", () => {
    const withoutMotionFallback = { ...PUBLISHED_ENTRY };
    delete withoutMotionFallback.motionFallback;
    const noFallback: AssetManifestEntry = withoutMotionFallback;
    const resolved = resolveSemanticRole("scene.mission_plaza.background", [noFallback], "REDUCED", "QC-THEME-ACADEMY");
    expect(resolved.appliedMotionProfile).toBe("STANDARD");
  });

  it("resolveSceneAssets resolves every role in order", () => {
    const resolved = resolveSceneAssets(
      ["scene.mission_plaza.background", "character.mentor.idle"],
      [PUBLISHED_ENTRY],
      "STANDARD",
      "QC-THEME-ACADEMY",
    );
    expect(resolved.map((r) => r.semanticRole)).toEqual(["scene.mission_plaza.background", "character.mentor.idle"]);
    expect(resolved[1]!.source).toBe("FALLBACK");
  });
});
