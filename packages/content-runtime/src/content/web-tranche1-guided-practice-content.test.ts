import { describe, expect, it } from "vitest";
import { createDefaultEngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import { loadBundleManifest } from "../bundle-loader";
import { initializeSequence, receiveEngineResult, requestHint, resolveCurrentStage, advanceStage, isSequenceComplete } from "../stage-orchestrator";
import {
  WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST,
  WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG,
  WEB_TRANCHE1_GUIDED_PRACTICE_HINT_LEVELS,
  WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION,
  WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
  WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID,
} from "./web-tranche1-guided-practice-content";

describe("M06 Web Full Vertical Slice Tranche 1 real content (07_26 v1.0 §14)", () => {
  it("the bundle manifest is a real, schema-valid, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED)", () => {
    expect(WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST.status).toBe("PUBLISHED");
    const result = loadBundleManifest(WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("the engine config is valid against QuickQuestionEngine's own validator (ENTER_VALUE, x = 7)", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const result = engine.validateConfig(WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG);
    expect(result.valid).toBe(true);
  });

  it("entering the real solution (x = 7) evaluates as CORRECT through the real engine (03_13 §9 PR-M06-L01-01)", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const validation = engine.validateConfig(WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;
    let state = engine.initState(validation.config);
    state = engine.applyAction(state, validation.config, { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 7 } }).state;
    state = engine.applyAction(state, validation.config, { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} }).state;
    const result = engine.evaluate(state, validation.config);
    expect(result).toMatchObject({ evaluated: true, correctness: "CORRECT", score: 1 });
  });

  it("an incorrect value (x = 5, the answer to the different, out-of-scope PR-M06-L01-02) evaluates as INCORRECT", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const validation = engine.validateConfig(WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG);
    if (!validation.valid) throw new Error("unreachable");
    let state = engine.initState(validation.config);
    state = engine.applyAction(state, validation.config, { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 5 } }).state;
    state = engine.applyAction(state, validation.config, { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} }).state;
    const result = engine.evaluate(state, validation.config);
    expect(result).toMatchObject({ evaluated: true, correctness: "INCORRECT", score: 0 });
  });

  it("the two-stage sequence definition is GUIDED_PRACTICE -> REFLECTION_AND_RESULT, in that order, matching 07_13 §4's canonical stageType values", () => {
    expect(WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION.stages).toHaveLength(2);
    const [first, second] = [...WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION.stages].sort((a, b) => a.order - b.order);
    expect(first).toMatchObject({ stageId: WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID, stageType: "GUIDED_PRACTICE", isInteractive: true });
    expect(first?.engineDispatchRef).toMatchObject({ resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" });
    expect(second).toMatchObject({ stageId: WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID, stageType: "REFLECTION_AND_RESULT", isInteractive: false });
    expect(second?.engineDispatchRef).toBeUndefined();
  });

  it("the hint ladder has 4 levels, verbatim from 03_13 §11, and is wired onto the GUIDED_PRACTICE stage's hintPolicy", () => {
    expect(WEB_TRANCHE1_GUIDED_PRACTICE_HINT_LEVELS).toHaveLength(4);
    expect(WEB_TRANCHE1_GUIDED_PRACTICE_HINT_LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4]);
    expect(WEB_TRANCHE1_GUIDED_PRACTICE_HINT_LEVELS[3]?.description).toBe("x = 7, perché 7 + 5 = 12.");
    const guidedPracticeStage = WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION.stages.find((s) => s.stageId === WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID);
    expect(guidedPracticeStage?.hintPolicy).toMatchObject({ maxHintLevel: 4 });
    expect(guidedPracticeStage?.hintPolicy?.levels).toEqual(WEB_TRANCHE1_GUIDED_PRACTICE_HINT_LEVELS);
  });

  it("full orchestrator traversal: hint escalation, retry, correct evaluation, checkpoint, advance to REFLECTION_AND_RESULT, then sequence completion", () => {
    const definition = WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION;
    let state = initializeSequence(definition, "test-runtime-state-1");
    expect(state.currentStageId).toBe(WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID);
    expect(state.sequenceCompletionState).toBe("IN_PROGRESS");

    // Two REQUEST_HINT cycles escalate hintLevel 0 -> 1 -> 2, matching H1/H2.
    state = requestHint(definition, state);
    expect(state.stageStates[0]?.hintLevel).toBe(1);
    state = requestHint(definition, state);
    expect(state.stageStates[0]?.hintLevel).toBe(2);

    // A wrong answer (INCORRECT) retries — does not advance, records the attempt.
    const wrongOutcome = receiveEngineResult(definition, state, { evaluated: true, correctness: "INCORRECT", score: 0, evidence: { mode: "ENTER_VALUE", enteredValue: 5 } });
    expect(wrongOutcome.outcome).toBe("RETRY");
    state = wrongOutcome.state;
    expect(state.stageStates[0]?.attemptsForStage).toBe(1);
    expect(state.currentStageId).toBe(WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID);

    // The correct answer marks GUIDED_PRACTICE complete/checkpointed (receiveEngineResult never itself moves currentStageId — mirrors SequenceHost.handleEvaluated, which calls advanceStage() only after an "ADVANCED" outcome).
    const correctOutcome = receiveEngineResult(definition, state, { evaluated: true, correctness: "CORRECT", score: 1, evidence: { mode: "ENTER_VALUE", enteredValue: 7 } });
    expect(correctOutcome.outcome).toBe("ADVANCED");
    state = advanceStage(definition, correctOutcome.state);
    expect(state.currentStageId).toBe(WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID);
    const guidedPracticeState = state.stageStates.find((s) => s.stageId === WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID);
    expect(guidedPracticeState).toMatchObject({ status: "COMPLETED", checkpointReached: true, hintLevel: 2, hintCount: 2, attemptsForStage: 2 });
    expect(isSequenceComplete(state)).toBe(false);

    // REFLECTION_AND_RESULT is non-interactive: the student's "continue" drives advanceStage directly (no engine result).
    const currentStage = resolveCurrentStage(definition, state);
    expect(currentStage.isInteractive).toBe(false);
    state = advanceStage(definition, state);
    expect(isSequenceComplete(state)).toBe(true);
    expect(state.stageStates.find((s) => s.stageId === WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID)?.status).toBe("COMPLETED");
  });
});
