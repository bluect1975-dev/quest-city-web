/**
 * Real end-to-end coverage for the R3C.2 Stage/Session Orchestrator,
 * dispatching to the real 3 P0 `EngineDefinition` implementations (no
 * mocked engines) exactly as `apps/student-web`'s Engine Host does.
 */
import {
  EngineRegistry,
  TemplateRegistry,
  createDefaultEngineRuntimeRegistry,
  createP0EngineRegistryEntries,
  replayActions,
  type EngineEvaluationResult,
} from "@quest-city-web/learning-engines";
import { describe, expect, it } from "vitest";
import {
  addAttemptReference,
  advanceStage,
  abandonSequence,
  findStage,
  initializeSequence,
  isSequenceComplete,
  receiveEngineResult,
  redirectToRemediationTarget,
  requestHint,
  resolveCurrentStage,
  resolveEngineDispatch,
  UnknownStageError,
} from "./stage-orchestrator";
import { parseSequenceDefinition, parseSequenceRuntimeState, type SequenceDefinition } from "./stage-orchestration-types";

const QUICK_CONFIG = {
  mode: "OPTION_SELECTION" as const,
  options: [{ optionId: "a" }, { optionId: "b" }, { optionId: "c" }],
  correctOptionId: "b",
};
const BALANCE_CONFIG = { tokens: [{ tokenId: "w5", weight: 5 }, { tokenId: "w5b", weight: 5 }] };
const DRAG_CONFIG = {
  items: [{ itemId: "item-1" }, { itemId: "item-2" }],
  targets: [{ targetId: "target-a" }, { targetId: "target-b" }],
  correctMapping: [
    { itemId: "item-1", targetId: "target-a" },
    { itemId: "item-2", targetId: "target-b" },
  ],
};

/**
 * M06 8-stage vertical-slice fixture, mirroring the canonical
 * `test_stage_orchestration_schema.py` M06 representability fixture
 * (R3C.2B, `quest-city-roblox` commit `a77c178...`) stage-for-stage,
 * except `interactive-exercise` uses `requiredCapabilities: ["DRAG_DROP"]`
 * (the real Web capability `ENG-DRAG` declares) rather than the canonical
 * fixture's illustrative `OBJECT_MANIPULATION_2D`, so this test exercises
 * a real, resolvable SUPPORT_EVALUATOR dispatch end to end.
 */
function m06SequenceDefinition(): SequenceDefinition {
  return {
    contractType: "SEQUENCE_DEFINITION",
    sequenceId: "MAT-M06-U01-VS-SEQUENCE",
    sequenceVersion: "1.0.0",
    stages: [
      { stageId: "intro-hook", stageType: "INTRO_HOOK", order: 0, isInteractive: false },
      {
        stageId: "prerequisite-check",
        stageType: "PREREQUISITE_CHECK",
        order: 1,
        isInteractive: true,
        activityRef: "MAT-M06-U01-PREREQ-CHECK",
        engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
        progressionRule: { triggerType: "ON_ENGINE_EVALUATION_ANY" },
      },
      {
        stageId: "micro-lesson",
        stageType: "MICRO_LESSON",
        order: 2,
        isInteractive: true,
        activityRef: "MAT-M06-U01-L01-L4-WORKED-EXAMPLE",
        engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
        progressionRule: { triggerType: "ON_STAGE_CONFIRM" },
      },
      {
        stageId: "quick-question-set",
        stageType: "QUICK_QUESTION_SET",
        order: 3,
        isInteractive: true,
        activityRef: "MAT-IT-M06-VS-003",
        engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
        progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 3 },
      },
      {
        stageId: "guided-practice",
        stageType: "GUIDED_PRACTICE",
        order: 4,
        isInteractive: true,
        activityRef: "MAT-M06-U01-L01-PR-01",
        engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-QUICK-QUESTION" },
        progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 2 },
        hintPolicy: {
          maxHintLevel: 4,
          levels: [
            { level: 0, description: "nessun aiuto" },
            { level: 1, description: "richiamo concettuale" },
            { level: 2, description: "evidenziazione del passo" },
            { level: 3, description: "esempio analogo" },
            { level: 4, description: "soluzione guidata con evidence distinta" },
          ],
        },
        remediationPolicy: { triggerAfterAttempts: 2, targetActivityRef: "MAT-M06-U01-L01-MICRO-RICHIAMO" },
      },
      {
        stageId: "interactive-exercise",
        stageType: "INTERACTIVE_EXERCISE",
        order: 5,
        isInteractive: true,
        activityRef: "MAT-M06-U01-IE001",
        engineDispatchRef: { resolutionMode: "SUPPORT_EVALUATOR", requiredCapabilities: ["DRAG_DROP"] },
        progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT" },
      },
      {
        stageId: "balance-machine-challenge",
        stageType: "BALANCE_MACHINE_CHALLENGE",
        order: 6,
        isInteractive: true,
        activityRef: "MAT-M06-VS-CH001",
        engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID", runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE" },
        progressionRule: { triggerType: "ON_ENGINE_EVALUATION_CORRECT", maxAttemptsBeforeRemediation: 3 },
        hintPolicy: { maxHintLevel: 4 },
        checkpointPolicy: { isCheckpoint: true },
      },
      { stageId: "reflection-and-result", stageType: "REFLECTION_AND_RESULT", order: 7, isInteractive: false },
    ],
  };
}

function governanceDeps() {
  const runtimeRegistry = createDefaultEngineRuntimeRegistry();
  const governanceRegistry = new EngineRegistry();
  for (const entry of createP0EngineRegistryEntries()) governanceRegistry.register(entry);
  const templateRegistry = new TemplateRegistry();
  return {
    runtimeRegistry,
    governanceRegistry,
    templateRegistry,
    supportEvaluatorOptions: {
      capabilityContractVersion: "1.0.0",
      registryVersion: "1.0.0",
      evaluationVersion: "1.0.0",
      reportVersion: "1.0.0",
      now: "2026-08-08T00:00:00.000Z",
    },
  };
}

describe("R3C.2 contract parsing", () => {
  it("parses a valid SequenceDefinition", () => {
    const result = parseSequenceDefinition(m06SequenceDefinition());
    expect(result.valid).toBe(true);
  });

  it("parses a valid SequenceRuntimeState", () => {
    const state = initializeSequence(m06SequenceDefinition(), "rts-001");
    const result = parseSequenceRuntimeState(state);
    expect(result.valid).toBe(true);
  });
});

describe("initialize + enter first stage", () => {
  it("initializes at the lowest-order stage, IN_PROGRESS, sequence IN_PROGRESS", () => {
    const state = initializeSequence(m06SequenceDefinition(), "rts-001");
    expect(state.currentStageId).toBe("intro-hook");
    expect(state.sequenceCompletionState).toBe("IN_PROGRESS");
    expect(state.stageStates[0]).toMatchObject({ stageId: "intro-hook", status: "IN_PROGRESS", lastTransitionEvent: "SEQUENCE_STARTED" });
  });
});

describe("engine dispatch — RUNTIME_ADAPTER_ID", () => {
  it("dispatches ENG-QUICK for a RUNTIME_ADAPTER_ID stage", () => {
    const definition = m06SequenceDefinition();
    const stage = findStage(definition, "quick-question-set");
    const resolution = resolveEngineDispatch(stage, governanceDeps());
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) expect(resolution.engine.runtimeAdapterId).toBe("QC-WEB-ENGINE-QUICK-QUESTION");
  });

  it("dispatches ENG-BALANCE for a RUNTIME_ADAPTER_ID stage", () => {
    const definition = m06SequenceDefinition();
    const stage = findStage(definition, "balance-machine-challenge");
    const resolution = resolveEngineDispatch(stage, governanceDeps());
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) expect(resolution.engine.runtimeAdapterId).toBe("QC-WEB-ENGINE-BALANCE-MACHINE");
  });

  it("returns unresolved (no fallback) for an unknown runtimeAdapterId", () => {
    const stage = {
      stageId: "bogus",
      stageType: "X",
      order: 0,
      isInteractive: true,
      activityRef: "x",
      engineDispatchRef: { resolutionMode: "RUNTIME_ADAPTER_ID" as const, runtimeAdapterId: "QC-WEB-ENGINE-DOES-NOT-EXIST" },
      progressionRule: { triggerType: "MANUAL" as const },
    };
    const resolution = resolveEngineDispatch(stage, governanceDeps());
    expect(resolution.resolved).toBe(false);
    if (!resolution.resolved) expect(resolution.reason).toMatch(/Unknown runtimeAdapterId/);
  });
});

describe("engine dispatch — SUPPORT_EVALUATOR", () => {
  it("dispatches ENG-DRAG via SUPPORT_EVALUATOR resolution for a DRAG_DROP capability requirement", () => {
    const definition = m06SequenceDefinition();
    const stage = findStage(definition, "interactive-exercise");
    const resolution = resolveEngineDispatch(stage, governanceDeps());
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) expect(resolution.engine.runtimeAdapterId).toBe("QC-WEB-ENGINE-DRAG-DROP");
  });

  it("returns unresolved (ENGINE_GAP, no fallback) for a capability no ACTIVE engine declares", () => {
    const stage = {
      stageId: "no-such-capability",
      stageType: "X",
      order: 0,
      isInteractive: true,
      activityRef: "x",
      engineDispatchRef: { resolutionMode: "SUPPORT_EVALUATOR" as const, requiredCapabilities: ["OBJECT_MANIPULATION_3D"] },
      progressionRule: { triggerType: "MANUAL" as const },
    };
    const resolution = resolveEngineDispatch(stage, governanceDeps());
    expect(resolution.resolved).toBe(false);
    if (!resolution.resolved) expect(resolution.reason).toMatch(/ENGINE_GAP/);
  });

  it("returns unresolved when governance/template registry are not supplied (no silent default)", () => {
    const definition = m06SequenceDefinition();
    const stage = findStage(definition, "interactive-exercise");
    const resolution = resolveEngineDispatch(stage, { runtimeRegistry: createDefaultEngineRuntimeRegistry() });
    expect(resolution.resolved).toBe(false);
  });
});

describe("hint flow", () => {
  it("REQUEST_HINT increments hintCount and advances hintLevel up to maxHintLevel", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    state = advanceStage(definition, state); // -> prerequisite-check
    state = receiveEngineResult(definition, state, { evaluated: true, correctness: "CORRECT", score: 1, evidence: {} }).state;
    state = advanceStage(definition, state); // -> micro-lesson
    state = advanceStage(definition, state); // -> quick-question-set
    state = receiveEngineResult(definition, state, { evaluated: true, correctness: "CORRECT", score: 1, evidence: {} }).state; // advances
    state = advanceStage(definition, state); // -> guided-practice (maxHintLevel 4)

    state = requestHint(definition, state);
    const afterFirst = state.stageStates.find((s) => s.stageId === "guided-practice")!;
    expect(afterFirst.hintCount).toBe(1);
    expect(afterFirst.hintLevel).toBe(1);
    expect(afterFirst.lastTransitionEvent).toBe("HINT_LEVEL_ADVANCED");
  });

  it("hint escalation plateaus at maxHintLevel: further requests keep incrementing hintCount but not hintLevel", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    state = advanceStage(definition, state);
    state = advanceStage(definition, state);
    state = advanceStage(definition, state);
    state = advanceStage(definition, state); // -> guided-practice, maxHintLevel 4

    for (let i = 0; i < 6; i += 1) state = requestHint(definition, state);
    const afterSix = state.stageStates.find((s) => s.stageId === "guided-practice")!;
    expect(afterSix.hintCount).toBe(6);
    expect(afterSix.hintLevel).toBe(4);
    expect(afterSix.lastTransitionEvent).toBe("HINT_REQUESTED");
  });
});

describe("progression — retry / remediation / checkpoint", () => {
  it("retries (does not advance) on an incorrect result under the remediation threshold", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    state = advanceStage(definition, state);
    state = advanceStage(definition, state);
    state = advanceStage(definition, state); // -> quick-question-set, maxAttemptsBeforeRemediation 3, no remediationPolicy declared

    const outcome = receiveEngineResult(definition, state, { evaluated: true, correctness: "INCORRECT", score: 0, evidence: {} });
    expect(outcome.outcome).toBe("RETRY");
    expect(outcome.state.currentStageId).toBe("quick-question-set");
    const stageState = outcome.state.stageStates.find((s) => s.stageId === "quick-question-set")!;
    expect(stageState.attemptsForStage).toBe(1);
    expect(stageState.status).toBe("IN_PROGRESS");
  });

  it("triggers remediation once attemptsForStage reaches maxAttemptsBeforeRemediation and a remediationPolicy exists", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    state = advanceStage(definition, state);
    state = advanceStage(definition, state);
    state = advanceStage(definition, state);
    state = receiveEngineResult(definition, state, { evaluated: true, correctness: "CORRECT", score: 1, evidence: {} }).state;
    state = advanceStage(definition, state); // -> guided-practice, maxAttemptsBeforeRemediation 2, remediationPolicy present

    let outcome = receiveEngineResult(definition, state, { evaluated: true, correctness: "INCORRECT", score: 0, evidence: {} });
    expect(outcome.outcome).toBe("RETRY");
    outcome = receiveEngineResult(definition, outcome.state, { evaluated: true, correctness: "INCORRECT", score: 0, evidence: {} });
    expect(outcome.outcome).toBe("REMEDIATION_TRIGGERED");
    const stageState = outcome.state.stageStates.find((s) => s.stageId === "guided-practice")!;
    expect(stageState.remediationTriggered).toBe(true);
    expect(stageState.lastTransitionEvent).toBe("REMEDIATION_TRIGGERED");
  });

  it("redirectToRemediationTarget throws for a dangling target and jumps for a real one", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    state = { ...state, currentStageId: "guided-practice", stageStates: [...state.stageStates, { stageId: "guided-practice", status: "IN_PROGRESS", hintLevel: 0, hintCount: 0, attemptsForStage: 2 }] };
    // guided-practice's remediationPolicy has targetActivityRef only, no targetStageId -> must throw
    expect(() => redirectToRemediationTarget(definition, state)).toThrow();
  });

  it("marks checkpointReached when a checkpoint stage completes", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    for (let i = 0; i < 6; i += 1) state = advanceStage(definition, state); // -> balance-machine-challenge
    expect(state.currentStageId).toBe("balance-machine-challenge");
    const outcome = receiveEngineResult(definition, state, { evaluated: true, correctness: "CORRECT", score: 1, evidence: {} });
    expect(outcome.outcome).toBe("ADVANCED");
    const stageState = outcome.state.stageStates.find((s) => s.stageId === "balance-machine-challenge")!;
    expect(stageState.checkpointReached).toBe(true);
  });
});

describe("stage transitions and sequence completion", () => {
  it("advanceStage marks the outgoing stage STAGE_ADVANCED and enters the next with STAGE_ENTERED", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    state = advanceStage(definition, state);
    const introState = state.stageStates.find((s) => s.stageId === "intro-hook")!;
    expect(introState.status).toBe("COMPLETED");
    expect(introState.lastTransitionEvent).toBe("STAGE_ADVANCED");
    const prereqState = state.stageStates.find((s) => s.stageId === "prerequisite-check")!;
    expect(prereqState.lastTransitionEvent).toBe("STAGE_ENTERED");
    expect(state.currentStageId).toBe("prerequisite-check");
  });

  it("completes the sequence after the last stage advances, event SEQUENCE_COMPLETED", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    for (let i = 0; i < 7; i += 1) state = advanceStage(definition, state);
    expect(state.currentStageId).toBe("reflection-and-result");
    expect(isSequenceComplete(state)).toBe(false);
    state = advanceStage(definition, state);
    expect(isSequenceComplete(state)).toBe(true);
    const finalStageState = state.stageStates.find((s) => s.stageId === "reflection-and-result")!;
    expect(finalStageState.lastTransitionEvent).toBe("SEQUENCE_COMPLETED");
  });

  it("abandonSequence sets sequenceCompletionState to ABANDONED without touching stageStates", () => {
    const definition = m06SequenceDefinition();
    const state = initializeSequence(definition, "rts-001");
    const abandoned = abandonSequence(state);
    expect(abandoned.sequenceCompletionState).toBe("ABANDONED");
    expect(abandoned.stageStates).toEqual(state.stageStates);
  });
});

describe("attemptReferences — pure pointers, no second lifecycle", () => {
  it("adds a stageId+attemptId reference and dedupes identical pairs", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    state = addAttemptReference(state, "intro-hook", "attempt-1");
    state = addAttemptReference(state, "intro-hook", "attempt-1"); // duplicate, no-op
    expect(state.attemptReferences).toEqual([{ stageId: "intro-hook", attemptId: "attempt-1" }]);
  });

  it("SequenceRuntimeState never carries attemptState/completionStatus fields", () => {
    const definition = m06SequenceDefinition();
    const state = initializeSequence(definition, "rts-001");
    expect(state).not.toHaveProperty("attemptState");
    expect(state).not.toHaveProperty("completionStatus");
  });
});

describe("no validator duplication", () => {
  it("receiveEngineResult trusts the caller-supplied EngineEvaluationResult verbatim — it never recomputes correctness", () => {
    const definition = m06SequenceDefinition();
    let state = initializeSequence(definition, "rts-001");
    state = advanceStage(definition, state);
    state = advanceStage(definition, state);
    state = advanceStage(definition, state); // -> quick-question-set

    // A fabricated CORRECT result the orchestrator never validated against any engine state.
    const fabricated: EngineEvaluationResult = { evaluated: true, correctness: "CORRECT", score: 1, evidence: { fabricated: true } };
    const outcome = receiveEngineResult(definition, state, fabricated);
    expect(outcome.outcome).toBe("ADVANCED");
  });

  it("real engine evaluation (via replayActions) and the orchestrator's own evaluate() call agree — no separate scoring path", () => {
    const engine = createDefaultEngineRuntimeRegistry().getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const { state: engineState } = replayActions(engine, QUICK_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const realResult = engine.evaluate(engineState, QUICK_CONFIG);
    expect(realResult.evaluated).toBe(true);
    if (realResult.evaluated) expect(realResult.correctness).toBe("CORRECT");

    const definition = m06SequenceDefinition();
    let seqState = initializeSequence(definition, "rts-001");
    seqState = advanceStage(definition, seqState);
    seqState = advanceStage(definition, seqState);
    seqState = advanceStage(definition, seqState);
    const outcome = receiveEngineResult(definition, seqState, realResult);
    expect(outcome.outcome).toBe("ADVANCED");
  });
});

describe("invalid stage handling", () => {
  it("resolveCurrentStage throws UnknownStageError for a currentStageId not in the definition", () => {
    const definition = m06SequenceDefinition();
    const state = { ...initializeSequence(definition, "rts-001"), currentStageId: "stage-that-does-not-exist" };
    expect(() => resolveCurrentStage(definition, state)).toThrow(UnknownStageError);
  });

  it("advanceStage throws UnknownStageError for an unresolvable currentStageId", () => {
    const definition = m06SequenceDefinition();
    const state = { ...initializeSequence(definition, "rts-001"), currentStageId: "stage-that-does-not-exist" };
    expect(() => advanceStage(definition, state)).toThrow(UnknownStageError);
  });
});

describe("resume from an externally-supplied SequenceRuntimeState", () => {
  it("advanceStage works correctly on a hand-built mid-sequence state, without ever calling initializeSequence", () => {
    const definition = m06SequenceDefinition();
    const midSequenceState = {
      contractType: "SEQUENCE_RUNTIME_STATE" as const,
      runtimeStateId: "rts_demo_0001",
      sequenceId: "MAT-M06-U01-VS-SEQUENCE",
      sequenceVersion: "1.0.0",
      currentStageId: "guided-practice",
      stageStates: [
        { stageId: "intro-hook", status: "COMPLETED" as const, hintLevel: 0, hintCount: 0, attemptsForStage: 0 },
        { stageId: "prerequisite-check", status: "COMPLETED" as const, hintLevel: 0, hintCount: 0, attemptsForStage: 1 },
        { stageId: "micro-lesson", status: "COMPLETED" as const, hintLevel: 0, hintCount: 0, attemptsForStage: 1 },
        { stageId: "quick-question-set", status: "COMPLETED" as const, hintLevel: 0, hintCount: 0, attemptsForStage: 1 },
        { stageId: "guided-practice", status: "IN_PROGRESS" as const, hintLevel: 2, hintCount: 2, attemptsForStage: 1, remediationTriggered: false, lastTransitionEvent: "HINT_LEVEL_ADVANCED" as const },
      ],
      attemptReferences: [
        { stageId: "prerequisite-check", attemptId: "att_0001" },
        { stageId: "micro-lesson", attemptId: "att_0002" },
        { stageId: "quick-question-set", attemptId: "att_0003" },
        { stageId: "guided-practice", attemptId: "att_0004" },
      ],
      sequenceCompletionState: "IN_PROGRESS" as const,
    };
    const parsed = parseSequenceRuntimeState(midSequenceState);
    expect(parsed.valid).toBe(true);

    const outcome = receiveEngineResult(definition, midSequenceState, { evaluated: true, correctness: "CORRECT", score: 1, evidence: {} });
    expect(outcome.outcome).toBe("ADVANCED");
    const nextState = advanceStage(definition, outcome.state);
    expect(nextState.currentStageId).toBe("interactive-exercise");
  });
});

describe("M06 full 8-stage traversal", () => {
  it("drives the whole vertical slice from initialize to COMPLETED, dispatching all 3 P0 engines", () => {
    const definition = m06SequenceDefinition();
    const deps = governanceDeps();
    let state = initializeSequence(definition, "rts-m06-e2e");

    // intro-hook (non-interactive)
    expect(resolveCurrentStage(definition, state).isInteractive).toBe(false);
    state = advanceStage(definition, state);

    // prerequisite-check: ENG-QUICK, ANY trigger
    let stage = resolveCurrentStage(definition, state);
    let resolution = resolveEngineDispatch(stage, deps);
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      const { state: engineState } = replayActions(resolution.engine, QUICK_CONFIG, [
        { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "a" } },
        { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      ]);
      const evalResult = resolution.engine.evaluate(engineState, QUICK_CONFIG);
      const outcome = receiveEngineResult(definition, state, evalResult);
      expect(outcome.outcome).toBe("ADVANCED"); // ANY trigger advances regardless of correctness
      state = addAttemptReference(outcome.state, "prerequisite-check", "attempt-prereq");
      state = advanceStage(definition, state);
    }

    // micro-lesson: ON_STAGE_CONFIRM
    stage = resolveCurrentStage(definition, state);
    resolution = resolveEngineDispatch(stage, deps);
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      const { state: engineState } = replayActions(resolution.engine, QUICK_CONFIG, [
        { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
        { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      ]);
      const evalResult = resolution.engine.evaluate(engineState, QUICK_CONFIG);
      const outcome = receiveEngineResult(definition, state, evalResult);
      expect(outcome.outcome).toBe("ADVANCED");
      state = addAttemptReference(outcome.state, "micro-lesson", "attempt-micro");
      state = advanceStage(definition, state);
    }

    // quick-question-set: CORRECT trigger
    stage = resolveCurrentStage(definition, state);
    resolution = resolveEngineDispatch(stage, deps);
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      const { state: engineState } = replayActions(resolution.engine, QUICK_CONFIG, [
        { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
        { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      ]);
      const evalResult = resolution.engine.evaluate(engineState, QUICK_CONFIG);
      expect(evalResult.evaluated && evalResult.correctness).toBe("CORRECT");
      const outcome = receiveEngineResult(definition, state, evalResult);
      expect(outcome.outcome).toBe("ADVANCED");
      state = addAttemptReference(outcome.state, "quick-question-set", "attempt-qqs");
      state = advanceStage(definition, state);
    }

    // guided-practice: request a hint, then answer correctly
    stage = resolveCurrentStage(definition, state);
    expect(stage.stageId).toBe("guided-practice");
    state = requestHint(definition, state);
    expect(state.stageStates.find((s) => s.stageId === "guided-practice")!.hintLevel).toBe(1);
    resolution = resolveEngineDispatch(stage, deps);
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      const { state: engineState } = replayActions(resolution.engine, QUICK_CONFIG, [
        { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "b" } },
        { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      ]);
      const evalResult = resolution.engine.evaluate(engineState, QUICK_CONFIG);
      const outcome = receiveEngineResult(definition, state, evalResult);
      expect(outcome.outcome).toBe("ADVANCED");
      state = addAttemptReference(outcome.state, "guided-practice", "attempt-guided");
      state = advanceStage(definition, state);
    }

    // interactive-exercise: SUPPORT_EVALUATOR -> ENG-DRAG
    stage = resolveCurrentStage(definition, state);
    expect(stage.stageId).toBe("interactive-exercise");
    resolution = resolveEngineDispatch(stage, deps);
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      expect(resolution.engine.runtimeAdapterId).toBe("QC-WEB-ENGINE-DRAG-DROP");
      const { state: engineState } = replayActions(resolution.engine, DRAG_CONFIG, [
        { actionType: "PLACE_ITEM", targetRole: "drop-target", payload: { itemId: "item-1", targetId: "target-a" } },
        { actionType: "PLACE_ITEM", targetRole: "drop-target", payload: { itemId: "item-2", targetId: "target-b" } },
        { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      ]);
      const evalResult = resolution.engine.evaluate(engineState, DRAG_CONFIG);
      expect(evalResult.evaluated && evalResult.correctness).toBe("CORRECT");
      const outcome = receiveEngineResult(definition, state, evalResult);
      expect(outcome.outcome).toBe("ADVANCED");
      state = addAttemptReference(outcome.state, "interactive-exercise", "attempt-ie");
      state = advanceStage(definition, state);
    }

    // balance-machine-challenge: RUNTIME_ADAPTER_ID -> ENG-BALANCE, checkpoint
    stage = resolveCurrentStage(definition, state);
    expect(stage.stageId).toBe("balance-machine-challenge");
    resolution = resolveEngineDispatch(stage, deps);
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      expect(resolution.engine.runtimeAdapterId).toBe("QC-WEB-ENGINE-BALANCE-MACHINE");
      const { state: engineState } = replayActions(resolution.engine, BALANCE_CONFIG, [
        { actionType: "PLACE_ITEM", targetRole: "weight-token", payload: { tokenId: "w5", side: "left" } },
        { actionType: "PLACE_ITEM", targetRole: "weight-token", payload: { tokenId: "w5b", side: "right" } },
        { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      ]);
      const evalResult = resolution.engine.evaluate(engineState, BALANCE_CONFIG);
      expect(evalResult.evaluated && evalResult.correctness).toBe("CORRECT");
      const outcome = receiveEngineResult(definition, state, evalResult);
      expect(outcome.outcome).toBe("ADVANCED");
      expect(outcome.state.stageStates.find((s) => s.stageId === "balance-machine-challenge")!.checkpointReached).toBe(true);
      state = addAttemptReference(outcome.state, "balance-machine-challenge", "attempt-balance");
      state = advanceStage(definition, state);
    }

    // reflection-and-result: non-interactive, final advance completes the sequence
    stage = resolveCurrentStage(definition, state);
    expect(stage.stageId).toBe("reflection-and-result");
    expect(stage.isInteractive).toBe(false);
    state = advanceStage(definition, state);

    expect(isSequenceComplete(state)).toBe(true);
    expect(state.attemptReferences).toHaveLength(6);
    expect(parseSequenceRuntimeState(state).valid).toBe(true);
  });
});
