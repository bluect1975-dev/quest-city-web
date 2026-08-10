import { describe, expect, it } from "vitest";
import { loadBundleManifest } from "../bundle-loader";
import { parseSequenceDefinition } from "../stage-orchestration-types";
import { advanceStage, initializeSequence, isSequenceComplete } from "../stage-orchestrator";
import { WEB_M4_ACTIVITY_STAGE_ID } from "./web-m4-real-content";
import { WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID } from "./web-tranche1-guided-practice-content";
import { WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID } from "./web-tranche2-quick-question-set-content";
import { WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID } from "./web-tranche3-prerequisite-check-micro-lesson-content";
import { WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID } from "./web-tranche4-interactive-exercise-content";
import { WEB_TRANCHE5_INTRO_HOOK_STAGE_ID } from "./web-tranche5-intro-hook-content";
import {
  UnknownWebTranche6StageError,
  resolveWebTranche6StageGroup,
  WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION,
  WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST,
  WEB_TRANCHE6_REFLECTION_STAGE_ID,
} from "./web-tranche6-full-sequence-content";

const CANONICAL_STAGE_TYPE_ORDER = [
  "INTRO_HOOK",
  "PREREQUISITE_CHECK",
  "MICRO_LESSON",
  "MICRO_LESSON",
  "MICRO_LESSON",
  "MICRO_LESSON",
  "MICRO_LESSON",
  "MICRO_LESSON",
  "MICRO_LESSON",
  "QUICK_QUESTION_SET",
  "GUIDED_PRACTICE",
  "INTERACTIVE_EXERCISE",
  "BALANCE_MACHINE_CHALLENGE",
  "REFLECTION_AND_RESULT",
];

describe("M06 Web Full Vertical Slice Tranche 6 — Full M06 Sequence (07_26 v1.1 §17.4)", () => {
  it("the standalone REFLECTION_AND_RESULT bundle manifest is a real, schema-valid, non-fixture, servable bundle", () => {
    expect(WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST.status).toBe("PUBLISHED");
    const result = loadBundleManifest(WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("has exactly 14 stages in the canonical 07_13 §4 stageType order (MICRO_LESSON expanded to its own 7 sub-steps)", () => {
    const stages = [...WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION.stages].sort((a, b) => a.order - b.order);
    expect(stages).toHaveLength(14);
    expect(stages.map((s) => s.stageType)).toEqual(CANONICAL_STAGE_TYPE_ORDER);
    expect(stages.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("every stageId is unique", () => {
    const stageIds = WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION.stages.map((s) => s.stageId);
    expect(new Set(stageIds).size).toBe(stageIds.length);
  });

  it("preserves each stage's original activityRef/engineDispatchRef/progressionRule/hintPolicy/checkpointPolicy verbatim — nothing invented or altered by the merge", () => {
    const byId = new Map(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION.stages.map((s) => [s.stageId, s]));

    expect(byId.get(WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID)).toMatchObject({
      isInteractive: true,
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_ANY" },
    });
    expect(byId.get(WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID)).toMatchObject({
      isInteractive: true,
      engineDispatchRef: { runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
    });
    expect(byId.get(WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID)).toMatchObject({
      isInteractive: true,
      engineDispatchRef: { runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
      progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 5 },
      hintPolicy: { maxHintLevel: 4 },
      checkpointPolicy: { isCheckpoint: true },
    });
    expect(byId.get(WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID)).toMatchObject({
      isInteractive: true,
      engineDispatchRef: { runtimeAdapterId: "QC-WEB-ENGINE-DRAG-DROP" },
    });
    expect(byId.get(WEB_M4_ACTIVITY_STAGE_ID)).toMatchObject({
      isInteractive: true,
      engineDispatchRef: { runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE" },
    });
    expect(byId.get(WEB_TRANCHE5_INTRO_HOOK_STAGE_ID)).toMatchObject({ isInteractive: false });
    expect(byId.get(WEB_TRANCHE5_INTRO_HOOK_STAGE_ID)).not.toHaveProperty("engineDispatchRef");
    expect(byId.get(WEB_TRANCHE6_REFLECTION_STAGE_ID)).toMatchObject({ isInteractive: false, stageType: "REFLECTION_AND_RESULT" });
    expect(byId.get(WEB_TRANCHE6_REFLECTION_STAGE_ID)).not.toHaveProperty("engineDispatchRef");
  });

  it("REFLECTION_AND_RESULT is excluded from GUIDED_PRACTICE's original position (immediately after it) and placed last — the two canonical stages Tranche 1 originally paired are now separated by INTERACTIVE_EXERCISE and BALANCE_MACHINE_CHALLENGE", () => {
    const stages = [...WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION.stages].sort((a, b) => a.order - b.order);
    const guidedIndex = stages.findIndex((s) => s.stageId === WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID);
    const reflectionIndex = stages.findIndex((s) => s.stageId === WEB_TRANCHE6_REFLECTION_STAGE_ID);
    expect(reflectionIndex).toBe(stages.length - 1);
    expect(reflectionIndex - guidedIndex).toBeGreaterThan(1);
  });

  it("validates against the canonical R3C.2 stage-orchestration-contract schema (schemaVersion 1.0.0)", () => {
    const result = parseSequenceDefinition(WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION);
    expect(result.valid).toBe(true);
  });

  it("full structural traversal: 14 advanceStage calls complete the sequence, matching a real durable resume/completion path", () => {
    const definition = WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION;
    let state = initializeSequence(definition, "test-runtime-state-tr6-full-sequence");
    expect(state.currentStageId).toBe(WEB_TRANCHE5_INTRO_HOOK_STAGE_ID);
    for (let i = 0; i < 14; i += 1) {
      expect(isSequenceComplete(state)).toBe(false);
      state = advanceStage(definition, state);
    }
    expect(isSequenceComplete(state)).toBe(true);
    expect(state.stageStates).toHaveLength(14);
    expect(state.stageStates.every((s) => s.status === "COMPLETED")).toBe(true);
  });

  describe("resolveWebTranche6StageGroup", () => {
    it("resolves each of the 7 group-head stages to itself", () => {
      const heads = [
        WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
        WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
        WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
        WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
        WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
        WEB_M4_ACTIVITY_STAGE_ID,
        WEB_TRANCHE6_REFLECTION_STAGE_ID,
      ];
      for (const head of heads) {
        expect(resolveWebTranche6StageGroup(head).groupStageId).toBe(head);
      }
    });

    it("resolves all 7 MICRO_LESSON sub-stages to the prerequisite-check group, not to their own group", () => {
      const microLessonStageIds = WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION.stages
        .filter((s) => s.stageType === "MICRO_LESSON")
        .map((s) => s.stageId);
      expect(microLessonStageIds).toHaveLength(7);
      for (const stageId of microLessonStageIds) {
        expect(resolveWebTranche6StageGroup(stageId).groupStageId).toBe(WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID);
      }
    });

    it("throws UnknownWebTranche6StageError for a stageId not in the sequence", () => {
      expect(() => resolveWebTranche6StageGroup("not-a-real-stage")).toThrow(UnknownWebTranche6StageError);
    });

    it("every group has a distinct assignmentPublicId/contentBundleId (no accidental reuse across groups)", () => {
      const heads = [
        WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
        WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
        WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
        WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
        WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
        WEB_M4_ACTIVITY_STAGE_ID,
        WEB_TRANCHE6_REFLECTION_STAGE_ID,
      ];
      const groups = heads.map((h) => resolveWebTranche6StageGroup(h));
      expect(new Set(groups.map((g) => g.assignmentPublicId)).size).toBe(groups.length);
      expect(new Set(groups.map((g) => g.contentBundleId)).size).toBe(groups.length);
    });
  });
});
