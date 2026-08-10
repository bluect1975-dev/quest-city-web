import { describe, expect, it } from "vitest";
import { createDefaultEngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import { loadBundleManifest } from "../bundle-loader";
import { initializeSequence, receiveEngineResult, advanceStage, isSequenceComplete } from "../stage-orchestrator";
import {
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
} from "./web-tranche4-interactive-exercise-content";

describe("M06 Web Full Vertical Slice Tranche 4 real content (07_26 v1.0 §5/§6/§13)", () => {
  it("the bundle manifest is a real, schema-valid, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED)", () => {
    expect(WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST.status).toBe("PUBLISHED");
    const result = loadBundleManifest(WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("the INTERACTIVE_EXERCISE engine config declares exactly two placement slots (apply -3 to both members, 03_35 §17.1) and validates through the real ENG-DRAG engine", () => {
    expect(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.correctMapping).toHaveLength(2);
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-DRAG-DROP")!;
    const result = engine.validateConfig(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG);
    expect(result.valid).toBe(true);
  });

  it("applying -3 to both members (left and right) evaluates CORRECT through the real engine, matching 03_35 §17.1 points 2-4 (x = 4)", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-DRAG-DROP")!;
    const validation = engine.validateConfig(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;
    let state = engine.initState(validation.config);
    for (const mapping of WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.correctMapping) {
      state = engine.applyAction(state, validation.config, {
        actionType: "PLACE_ITEM",
        targetRole: "drop-target",
        payload: { itemId: mapping.itemId, targetId: mapping.targetId },
      }).state;
    }
    state = engine.applyAction(state, validation.config, { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} }).state;
    const result = engine.evaluate(state, validation.config);
    expect(result).toMatchObject({ evaluated: true, correctness: "CORRECT", score: 1 });
    if (result.evaluated) expect(result.evidence["feedbackText"]).toBe(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.feedback?.correctFeedbackText);
  });

  it("applying -3 to only one member evaluates INCORRECT with the unilateral (partial) feedback text, matching 03_35 §17.1 point 6", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-DRAG-DROP")!;
    const validation = engine.validateConfig(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG);
    if (!validation.valid) throw new Error("unreachable");
    const onlyLeft = WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.correctMapping[0]!;
    let state = engine.initState(validation.config);
    state = engine.applyAction(state, validation.config, {
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: onlyLeft.itemId, targetId: onlyLeft.targetId },
    }).state;
    state = engine.applyAction(state, validation.config, { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} }).state;
    const result = engine.evaluate(state, validation.config);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) {
      expect(result.correctness).toBe("INCORRECT");
      expect(result.evidence["matchedCount"]).toBe(1);
      expect(result.evidence["feedbackText"]).toBe(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.feedback?.partialFeedbackText);
    }
  });

  it("the sequence is a single INTERACTIVE_EXERCISE stage (order 0, ENG-DRAG dispatch), matching 07_13 §4's canonical stageType", () => {
    const stages = WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION.stages;
    expect(stages).toHaveLength(1);
    const stage = stages[0];
    expect(stage).toMatchObject({
      stageId: WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
      stageType: "INTERACTIVE_EXERCISE",
      order: 0,
      isInteractive: true,
      activityRef: WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
    });
    expect(stage?.engineDispatchRef).toMatchObject({ resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-DRAG-DROP" });
    expect(stage?.progressionRule).toMatchObject({ triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 5 });
  });

  it("full orchestrator traversal: a CORRECT evaluation ADVANCEs and completes the single-stage sequence", () => {
    const definition = WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION;
    const state = initializeSequence(definition, "test-runtime-state-tr4-1");
    expect(state.currentStageId).toBe(WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID);
    const outcome = receiveEngineResult(definition, state, {
      evaluated: true,
      correctness: "CORRECT",
      score: 1,
      evidence: { placements: {}, matchedCount: 2, totalRequired: 2 },
    });
    expect(outcome.outcome).toBe("ADVANCED");
    const advancedState = advanceStage(definition, outcome.state);
    expect(isSequenceComplete(advancedState)).toBe(true);
  });

  it("full orchestrator traversal: an INCORRECT (unilateral) evaluation does NOT complete the sequence — the student must retry, mastery is required (03_35 §17.1 point 5)", () => {
    const definition = WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION;
    const state = initializeSequence(definition, "test-runtime-state-tr4-2");
    const outcome = receiveEngineResult(definition, state, {
      evaluated: true,
      correctness: "INCORRECT",
      score: 0,
      evidence: { placements: {}, matchedCount: 1, totalRequired: 2 },
    });
    expect(outcome.outcome).not.toBe("ADVANCED");
    expect(isSequenceComplete(outcome.state)).toBe(false);
  });

  it("maxAttemptsBeforeRemediation: 5 is a technical, non-pedagogical default with no observable effect — this stage declares no remediationPolicy, so receiveEngineResult() never returns REMEDIATION_TRIGGERED no matter how many incorrect attempts are made (stage-orchestrator.ts §281-296 requires stage.remediationPolicy to be truthy, which this stage never sets)", () => {
    const definition = WEB_TRANCHE4_INTERACTIVE_EXERCISE_SEQUENCE_DEFINITION;
    const stage = definition.stages[0]!;
    expect(stage.progressionRule?.maxAttemptsBeforeRemediation).toBe(5);
    expect(stage.remediationPolicy).toBeUndefined();

    let state = initializeSequence(definition, "test-runtime-state-tr4-max-attempts");
    const incorrectResult = {
      evaluated: true as const,
      correctness: "INCORRECT" as const,
      score: 0,
      evidence: { placements: {}, matchedCount: 0, totalRequired: 2 },
    };

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const outcome = receiveEngineResult(definition, state, incorrectResult);
      expect(outcome.outcome).toBe("RETRY");
      state = outcome.state;
      const stageState = state.stageStates.find((s) => s.stageId === stage.stageId)!;
      expect(stageState.attemptsForStage).toBe(attempt);
      expect(stageState.remediationTriggered).toBeUndefined();
    }
    expect(isSequenceComplete(state)).toBe(false);
  });
});
