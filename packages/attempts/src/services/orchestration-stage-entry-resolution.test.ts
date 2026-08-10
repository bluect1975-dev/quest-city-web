import { describe, expect, it } from "vitest";
import { WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID, WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID } from "@quest-city-web/content-runtime";
import { isWhollyNonInteractiveContentBundle } from "./orchestration-stage-entry-resolution";

describe("isWhollyNonInteractiveContentBundle", () => {
  it("is true for INTRO_HOOK's content bundle — a single stage, isInteractive:false, no engineDispatchRef (07_26 v1.1 §17.2)", () => {
    expect(isWhollyNonInteractiveContentBundle(WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID)).toBe(true);
  });

  it("is false for a content bundle whose sequence has an interactive stage (Tranche 1 GUIDED_PRACTICE) — never eligible for this trigger even though the same bundle also has a non-interactive REFLECTION_AND_RESULT stage", () => {
    expect(isWhollyNonInteractiveContentBundle(WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID)).toBe(false);
  });

  it("is false for an unknown content bundle id — never a default-true fallback", () => {
    expect(isWhollyNonInteractiveContentBundle("unknown-content-bundle-id")).toBe(false);
  });
});
