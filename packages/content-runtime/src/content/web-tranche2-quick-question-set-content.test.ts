import { describe, expect, it } from "vitest";
import { createDefaultEngineRuntimeRegistry, type QuickQuestionState } from "@quest-city-web/learning-engines";
import { loadBundleManifest } from "../bundle-loader";
import { initializeSequence, receiveEngineResult, resolveCurrentStage, advanceStage, isSequenceComplete } from "../stage-orchestrator";
import {
  WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG,
  WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION,
  WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
} from "./web-tranche2-quick-question-set-content";

describe("M06 Web Full Vertical Slice Tranche 2 real content (07_26 v1.0 §16)", () => {
  it("the bundle manifest is a real, schema-valid, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED)", () => {
    expect(WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST.status).toBe("PUBLISHED");
    const result = loadBundleManifest(WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("the engine config has at least 3 items (07_13 §6 floor) and is valid against QuickQuestionEngine's own validator", () => {
    expect(WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG.mode).toBe("ITEM_SET");
    if (WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG.mode !== "ITEM_SET") throw new Error("unreachable");
    expect(WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG.items.length).toBeGreaterThanOrEqual(3);
    expect(WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG.items).toHaveLength(6);
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const result = engine.validateConfig(WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG);
    expect(result.valid).toBe(true);
  });

  it("does not reuse I001/I002 (earmarked for the future PREREQUISITE_CHECK stage per 07_26 §16) or I005 (the exact equation Tranche 1 already uses)", () => {
    if (WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG.mode !== "ITEM_SET") throw new Error("unreachable");
    const itemIds = WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG.items.map((item) => item.itemId);
    expect(itemIds).not.toContain("MAT-M06-U01-I001");
    expect(itemIds).not.toContain("MAT-M06-U01-I002");
    expect(itemIds).not.toContain("MAT-M06-U01-I005");
    expect(itemIds).toEqual([
      "MAT-M06-U01-I003",
      "MAT-M06-U01-I004",
      "MAT-M06-U01-I006",
      "MAT-M06-U01-I007",
      "MAT-M06-U01-I009",
      "MAT-M06-U01-I010",
    ]);
  });

  it("answering all 6 items correctly evaluates aggregate CORRECT through the real engine", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const validation = engine.validateConfig(WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;
    let state = engine.initState(validation.config);
    const answers: Array<{ actionType: "SELECT_OPTION" | "ENTER_VALUE"; targetRole: string; payload: Record<string, unknown> }> = [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "B" } }, // I003
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "D" } }, // I004
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 13 } }, // I006
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 6 } }, // I007
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 4 } }, // I009
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 5 } }, // I010
    ];
    for (const answer of answers) {
      state = engine.applyAction(state, validation.config, answer).state;
      state = engine.applyAction(state, validation.config, { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} }).state;
    }
    const result = engine.evaluate(state, validation.config);
    expect(result).toMatchObject({ evaluated: true, correctness: "CORRECT", score: 1 });
  });

  it("a wrong first answer still lets the set complete (non-punitive, 07_13 §6) and surfaces the real misconception feedback", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const validation = engine.validateConfig(WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG);
    if (!validation.valid) throw new Error("unreachable");
    let state = engine.initState(validation.config);
    // I003 answered wrong with choice "A" (MAT.MIS.ALG.001).
    state = engine.applyAction(state, validation.config, { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "A" } }).state;
    state = engine.applyAction(state, validation.config, { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} }).state;
    const quickQuestionState = state as QuickQuestionState;
    expect(quickQuestionState.itemResults?.[0]).toMatchObject({
      itemId: "MAT-M06-U01-I003",
      correctness: "INCORRECT",
      misconceptionCode: "MAT.MIS.ALG.001",
      feedbackText: "Hai modificato un solo membro. Applica la stessa operazione anche all'altro membro.",
    });
    expect(quickQuestionState.currentItemIndex).toBe(1);
    const evaluatedTooEarly = engine.evaluate(state, validation.config);
    expect(evaluatedTooEarly.evaluated).toBe(false);
  });

  it("the one-stage sequence definition is QUICK_QUESTION_SET, matching 07_13 §4's canonical stageType and dispatching to ENG-QUICK", () => {
    expect(WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION.stages).toHaveLength(1);
    const stage = WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION.stages[0];
    expect(stage).toMatchObject({ stageId: WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID, stageType: "QUICK_QUESTION_SET", isInteractive: true });
    expect(stage?.engineDispatchRef).toMatchObject({ resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" });
    expect(stage?.progressionRule).toMatchObject({ triggerType: "ON_ENGINE_EVALUATION_ANY" });
  });

  it("full orchestrator traversal: an aggregate INCORRECT evaluation still ADVANCEs and completes the sequence (non-punitive)", () => {
    const definition = WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION;
    let state = initializeSequence(definition, "test-runtime-state-tr2-1");
    expect(state.currentStageId).toBe(WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID);
    expect(state.sequenceCompletionState).toBe("IN_PROGRESS");
    const currentStage = resolveCurrentStage(definition, state);
    expect(currentStage.isInteractive).toBe(true);

    const outcome = receiveEngineResult(definition, state, {
      evaluated: true,
      correctness: "INCORRECT",
      score: 0,
      evidence: { mode: "ITEM_SET", itemResults: [], correctCount: 2, totalItems: 6 },
    });
    expect(outcome.outcome).toBe("ADVANCED");
    state = advanceStage(definition, outcome.state);
    const stageState = state.stageStates.find((s) => s.stageId === WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID);
    expect(stageState).toMatchObject({ status: "COMPLETED", checkpointReached: true, attemptsForStage: 1 });
    expect(isSequenceComplete(state)).toBe(true);
  });

  it("full orchestrator traversal: an aggregate CORRECT evaluation also ADVANCEs and completes the sequence", () => {
    const definition = WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION;
    let state = initializeSequence(definition, "test-runtime-state-tr2-2");
    const outcome = receiveEngineResult(definition, state, {
      evaluated: true,
      correctness: "CORRECT",
      score: 1,
      evidence: { mode: "ITEM_SET", itemResults: [], correctCount: 6, totalItems: 6 },
    });
    expect(outcome.outcome).toBe("ADVANCED");
    state = advanceStage(definition, outcome.state);
    expect(isSequenceComplete(state)).toBe(true);
  });
});
