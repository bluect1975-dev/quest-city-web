import { describe, expect, it } from "vitest";
import {
  MISSION_PLAZA_BACKGROUND_SVG,
  MENTOR_IDLE_SVG,
  UI_ICON_SHEET_SVG,
  sliceIconSheet,
  runSpriteCookBatch,
} from "./sprite-cook-batch";
import { ACADEMY_ASSET_MANIFEST, ACADEMY_SPRITE_COOK_JOBS } from "./academy-manifest";
import { resolveSemanticRole } from "./asset-manifest";

describe("real SpriteCook batch + slicing (07_14 v1.0 §5-§7/§18, 07_26 v1.1 §13/§17.3)", () => {
  it("the icon sheet source is well-formed (real content, not a placeholder string)", () => {
    expect(UI_ICON_SHEET_SVG).toContain("<symbol");
    expect((UI_ICON_SHEET_SVG.match(/<symbol /g) ?? []).length).toBe(5);
    expect(UI_ICON_SHEET_SVG).not.toMatch(/<text\b/i);
    expect(UI_ICON_SHEET_SVG).not.toMatch(/<image\b/i);
  });

  it("sliceIconSheet really parses the sheet into 5 standalone, normalized SVG entries", () => {
    const { entries, job } = sliceIconSheet(UI_ICON_SHEET_SVG, (id) => `ui.${id.replace(/^ui-/, "")}.icon`);
    expect(entries).toHaveLength(5);
    expect(job.requestedAssets).toBe(5);
    expect(job.acceptedAssets).toBe(5);
    expect(job.rejectedAssets).toBe(0);
    expect(job.strategy).toBe("BATCH_SHEET");
    // Every sliced entry has a real, distinct SHA-256 digest computed from its own normalized markup.
    const hashes = new Set(entries.map((e) => e.hash));
    expect(hashes.size).toBe(5);
    for (const entry of entries) {
      expect(entry.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(entry.dimensions.width).toBeGreaterThan(0);
      expect(entry.dimensions.height).toBeGreaterThan(0);
      expect(entry.format).toBe("SVG");
      expect(entry.publicationState).toBe("PUBLISHED");
      expect(entry.altDescription.length).toBeGreaterThan(0);
    }
  });

  it("rejects a malformed symbol (no viewBox) instead of silently accepting it", () => {
    const brokenSheet = `<svg><symbol id="ui-broken" viewBox="not-a-viewbox">no real viewbox here</symbol></svg>`;
    const { entries, job } = sliceIconSheet(brokenSheet, () => "ui.broken.icon");
    expect(entries).toHaveLength(0);
    expect(job.requestedAssets).toBe(1);
    expect(job.acceptedAssets).toBe(0);
    expect(job.rejectedAssets).toBe(1);
  });

  it("Mission Plaza background and mentor portrait are real, well-formed, text-free vector sources", () => {
    for (const svg of [MISSION_PLAZA_BACKGROUND_SVG, MENTOR_IDLE_SVG]) {
      expect(svg).toMatch(/viewBox="[\d.\s-]+"/);
      expect(svg).not.toMatch(/<text\b/i);
      expect(svg).not.toMatch(/<image\b/i);
    }
  });

  it("runSpriteCookBatch produces 3 jobs (scene, character, icon sheet) and 7 total assets (1 scene + 1 character + 5 icons)", () => {
    const { entries, jobs } = runSpriteCookBatch();
    expect(jobs).toHaveLength(3);
    expect(entries).toHaveLength(7);
    expect(jobs.every((j) => j.credits === 0)).toBe(true); // deterministic vector pipeline, no AI generation credits spent
  });

  it("ACADEMY_ASSET_MANIFEST/ACADEMY_SPRITE_COOK_JOBS are the real, already-computed batch output (module-level constants, not re-invented)", () => {
    expect(ACADEMY_ASSET_MANIFEST).toHaveLength(7);
    expect(ACADEMY_SPRITE_COOK_JOBS).toHaveLength(3);
    expect(ACADEMY_ASSET_MANIFEST.some((e) => e.semanticRole === "scene.mission_plaza.background")).toBe(true);
    expect(ACADEMY_ASSET_MANIFEST.some((e) => e.semanticRole === "character.mentor.idle")).toBe(true);
  });

  it("07_14 §18 acceptance: the real batch resolves through resolveSemanticRole exactly like any manifest entry (no special-casing)", () => {
    const resolved = resolveSemanticRole("scene.mission_plaza.background", ACADEMY_ASSET_MANIFEST, "STANDARD", "QC-THEME-ACADEMY");
    expect(resolved.source).toBe("MANIFEST");
    expect(resolved.assetId).toBe("academy-scene-mission-plaza-background");
  });

  it("07_14 §11 reduced motion: the scene background and mentor portrait both declare a static motionFallback", () => {
    const scene = ACADEMY_ASSET_MANIFEST.find((e) => e.semanticRole === "scene.mission_plaza.background")!;
    const mentor = ACADEMY_ASSET_MANIFEST.find((e) => e.semanticRole === "character.mentor.idle")!;
    expect(scene.motionFallback).toBe("static");
    expect(mentor.motionFallback).toBe("static");
  });
});
