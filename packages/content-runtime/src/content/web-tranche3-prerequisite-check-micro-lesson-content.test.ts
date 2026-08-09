import { describe, expect, it } from "vitest";
import { createDefaultEngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import { loadBundleManifest } from "../bundle-loader";
import { initializeSequence, receiveEngineResult, resolveCurrentStage, advanceStage, isSequenceComplete } from "../stage-orchestrator";
import {
  WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS,
  WEB_TRANCHE3_MICRO_LESSON_STEPS,
  WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST,
  WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG,
  WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION,
  WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
} from "./web-tranche3-prerequisite-check-micro-lesson-content";

describe("M06 Web Full Vertical Slice Tranche 3 real content (07_26 v1.0 §5/§13)", () => {
  it("the bundle manifest is a real, schema-valid, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED)", () => {
    expect(WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST.status).toBe("PUBLISHED");
    const result = loadBundleManifest(WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("the PREREQUISITE_CHECK engine config uses exactly I001/I002 (03_33 §4 lesson binding L2), earmarked by Tranche 2's own content file", () => {
    expect(WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG.mode).toBe("ITEM_SET");
    if (WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG.mode !== "ITEM_SET") throw new Error("unreachable");
    const itemIds = WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG.items.map((item) => item.itemId);
    expect(itemIds).toEqual(["MAT-M06-U01-I001", "MAT-M06-U01-I002"]);
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const result = engine.validateConfig(WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG);
    expect(result.valid).toBe(true);
  });

  it("answering both items correctly (I001=A, I002=C) evaluates aggregate CORRECT through the real engine", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const validation = engine.validateConfig(WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;
    let state = engine.initState(validation.config);
    const answers = [
      { optionId: "A" }, // I001: x + 4 = 9 is an equation
      { optionId: "C" }, // I002: 4x + 1 is NOT an equation
    ];
    for (const answer of answers) {
      state = engine.applyAction(state, validation.config, { actionType: "SELECT_OPTION", targetRole: "option", payload: answer }).state;
      state = engine.applyAction(state, validation.config, { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} }).state;
    }
    const result = engine.evaluate(state, validation.config);
    expect(result).toMatchObject({ evaluated: true, correctness: "CORRECT", score: 1 });
  });

  it("a wrong first answer does not complete the set early (non-punitive) — evaluated stays false until both items are confirmed", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const validation = engine.validateConfig(WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG);
    if (!validation.valid) throw new Error("unreachable");
    let state = engine.initState(validation.config);
    state = engine.applyAction(state, validation.config, { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "B" } }).state;
    state = engine.applyAction(state, validation.config, { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} }).state;
    const evaluatedTooEarly = engine.evaluate(state, validation.config);
    expect(evaluatedTooEarly.evaluated).toBe(false);
  });

  it("the sequence is PREREQUISITE_CHECK (order 0, ENG-QUICK dispatch) followed by 7 MICRO_LESSON sub-stages (orders 1-7, non-interactive), matching 07_13 §4's canonical order", () => {
    const stages = WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION.stages;
    expect(stages).toHaveLength(8);
    const prereqStage = stages[0];
    expect(prereqStage).toMatchObject({ stageId: WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID, stageType: "PREREQUISITE_CHECK", order: 0, isInteractive: true });
    expect(prereqStage?.engineDispatchRef).toMatchObject({ resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" });
    expect(prereqStage?.progressionRule).toMatchObject({ triggerType: "ON_ENGINE_EVALUATION_ANY" });

    const microLessonStages = stages.slice(1);
    expect(microLessonStages).toHaveLength(7);
    for (const [index, stage] of microLessonStages.entries()) {
      expect(stage).toMatchObject({ stageType: "MICRO_LESSON", order: index + 1, isInteractive: false });
      expect(stage.stageId).toBe(WEB_TRANCHE3_MICRO_LESSON_STEPS[index]?.stageId);
    }
  });

  it("every MICRO_LESSON sub-stage has a stagePrompts entry with matching i18n keys", () => {
    for (const step of WEB_TRANCHE3_MICRO_LESSON_STEPS) {
      expect(WEB_TRANCHE3_MICRO_LESSON_STAGE_PROMPTS[step.stageId]).toBeDefined();
    }
  });

  it("full orchestrator traversal: PREREQUISITE_CHECK evaluation ADVANCEs into the first MICRO_LESSON sub-stage, which is non-interactive", () => {
    const definition = WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION;
    let state = initializeSequence(definition, "test-runtime-state-tr3-1");
    expect(state.currentStageId).toBe(WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID);

    const outcome = receiveEngineResult(definition, state, {
      evaluated: true,
      correctness: "CORRECT",
      score: 1,
      evidence: { mode: "ITEM_SET", itemResults: [], correctCount: 2, totalItems: 2 },
    });
    expect(outcome.outcome).toBe("ADVANCED");
    state = advanceStage(definition, outcome.state);
    expect(state.currentStageId).toBe("micro-lesson-equilibrium");
    const currentStage = resolveCurrentStage(definition, state);
    expect(currentStage.isInteractive).toBe(false);
    expect(isSequenceComplete(state)).toBe(false);
  });

  it("full orchestrator traversal: advancing through all 7 MICRO_LESSON sub-stages (MANUAL-style advanceStage, matching REFLECTION_AND_RESULT's precedent) completes the sequence with no step skipped", () => {
    const definition = WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION;
    let state = initializeSequence(definition, "test-runtime-state-tr3-2");
    const outcome = receiveEngineResult(definition, state, {
      evaluated: true,
      correctness: "CORRECT",
      score: 1,
      evidence: { mode: "ITEM_SET", itemResults: [], correctCount: 2, totalItems: 2 },
    });
    state = advanceStage(definition, outcome.state);

    const visitedStageIds: string[] = [];
    for (let i = 0; i < WEB_TRANCHE3_MICRO_LESSON_STEPS.length; i += 1) {
      expect(isSequenceComplete(state)).toBe(false);
      visitedStageIds.push(state.currentStageId);
      state = advanceStage(definition, state);
    }
    expect(visitedStageIds).toEqual(WEB_TRANCHE3_MICRO_LESSON_STEPS.map((step) => step.stageId));
    expect(isSequenceComplete(state)).toBe(true);
    for (const step of WEB_TRANCHE3_MICRO_LESSON_STEPS) {
      const stageState = state.stageStates.find((s) => s.stageId === step.stageId);
      expect(stageState?.status).toBe("COMPLETED");
    }
  });
});
