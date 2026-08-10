import { describe, expect, it } from "vitest";
import { loadBundleManifest } from "../bundle-loader";
import { initializeSequence, advanceStage, isSequenceComplete } from "../stage-orchestrator";
import {
  WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST,
  WEB_TRANCHE5_INTRO_HOOK_CONTENT,
  WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION,
  WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
  WEB_TRANCHE5_INTRO_HOOK_SCENE_ID,
} from "./web-tranche5-intro-hook-content";

describe("M06 Web Full Vertical Slice Tranche 5 real content — INTRO_HOOK (07_26 v1.1 §13/§17)", () => {
  it("the bundle manifest is a real, schema-valid, non-fixture, servable bundle", () => {
    expect(WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST.status).toBe("PUBLISHED");
    const result = loadBundleManifest(WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("has no MAT.* objective and no validator — matching 07_26 v1.1 §17.2's canonical determination that INTRO_HOOK carries no pedagogical evidence", () => {
    expect(WEB_TRANCHE5_INTRO_HOOK_CONTENT).not.toHaveProperty("objectiveIds");
    expect(WEB_TRANCHE5_INTRO_HOOK_CONTENT).not.toHaveProperty("validatorRef");
  });

  it("the sequence is a single, non-interactive INTRO_HOOK stage (order 0, no engine dispatch), matching 07_13 §4's canonical stageType", () => {
    const stages = WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION.stages;
    expect(stages).toHaveLength(1);
    const stage = stages[0];
    expect(stage).toMatchObject({
      stageId: WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
      stageType: "INTRO_HOOK",
      order: 0,
      isInteractive: false,
    });
    expect(stage).not.toHaveProperty("engineDispatchRef");
    expect(stage).not.toHaveProperty("activityRef");
  });

  it("full orchestrator traversal: advancing the single non-interactive stage completes the sequence (same 'Continua' pattern as REFLECTION_AND_RESULT/MICRO_LESSON)", () => {
    const definition = WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION;
    let state = initializeSequence(definition, "test-runtime-state-tr5-intro-hook");
    expect(state.currentStageId).toBe(WEB_TRANCHE5_INTRO_HOOK_STAGE_ID);
    expect(isSequenceComplete(state)).toBe(false);
    state = advanceStage(definition, state);
    expect(isSequenceComplete(state)).toBe(true);
  });

  it("declares the canonical Mission Plaza scene (07_12 §4/§7) as a content-level reference — the presentation layer (student-web) is the only consumer that resolves it to real assets, keeping content/presentation/engine logic separate", () => {
    expect(WEB_TRANCHE5_INTRO_HOOK_CONTENT.sceneId).toBe(WEB_TRANCHE5_INTRO_HOOK_SCENE_ID);
    expect(WEB_TRANCHE5_INTRO_HOOK_CONTENT.semanticRoles).toEqual(["scene.mission_plaza.background", "character.mentor.idle"]);
  });

  it("no content field is invented: objective chip and dialogue text match 03_13 §6/§7 verbatim", () => {
    expect(WEB_TRANCHE5_INTRO_HOOK_CONTENT.objectiveChipText).toBe("Mantieni uguali i due membri");
    expect(WEB_TRANCHE5_INTRO_HOOK_CONTENT.mentorDialogueText).toBe(
      "La Balance Machine confronta due lati. Se cambiamo un lato, dobbiamo fare lo stesso sull'altro.",
    );
  });
});
