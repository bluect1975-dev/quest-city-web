/**
 * Stage / Session Orchestrator (R3C.2, `02_36` section 20-bis /
 * section 11-bis, `GUIDED_PRACTICE_IS_ORCHESTRATION_LAYER`).
 *
 * NOT an `EngineDefinition` (`@quest-city-web/learning-engines`) — it owns
 * no validator, never computes correctness, and never registers into
 * `EngineRegistry`/`EngineRuntimeRegistry`. It coordinates a sequence of
 * stages defined by a `SequenceDefinition`, dispatching each interactive
 * stage to an existing Learning Engine resolved via the Engine Registry /
 * Support Evaluator, and owns exactly the runtime fields the canonical
 * contract assigns it: `currentStageId`, `hintLevel`, `hintCount`,
 * `attemptsForStage`, `checkpointReached`, `remediationTriggered`,
 * `sequenceCompletionState`. `attemptState`/`completionStatus` remain the
 * sole property of the dispatched engine's own attempt
 * (`@quest-city-web/attempts`) — `attemptReferences` here are pure
 * `{stageId, attemptId}` pointers, never a second lifecycle.
 */
import type {
  AxisAValue,
  EngineDefinition,
  EngineEvaluationResult,
  EngineRegistry,
  EvaluateSupportOptions,
  TemplateRegistry,
} from "@quest-city-web/learning-engines";
import { evaluateSupport, isAxisAValue } from "@quest-city-web/learning-engines";
import type { EngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import type {
  SequenceDefinition,
  SequenceRuntimeState,
  StageDefinition,
  StageRuntimeState,
  StageTransitionEvent,
} from "./stage-orchestration-types";

export class UnknownStageError extends Error {
  constructor(stageId: string) {
    super(`No stage with stageId "${stageId}" exists in this SequenceDefinition`);
    this.name = "UnknownStageError";
  }
}

function sortedStages(definition: SequenceDefinition): StageDefinition[] {
  return [...definition.stages].sort((a, b) => a.order - b.order);
}

export function findStage(definition: SequenceDefinition, stageId: string): StageDefinition {
  const stage = definition.stages.find((s) => s.stageId === stageId);
  if (!stage) throw new UnknownStageError(stageId);
  return stage;
}

function findStageState(state: SequenceRuntimeState, stageId: string): StageRuntimeState | undefined {
  return state.stageStates.find((s) => s.stageId === stageId);
}

function withStageState(
  state: SequenceRuntimeState,
  stageId: string,
  update: (existing: StageRuntimeState) => StageRuntimeState,
  createIfMissing: () => StageRuntimeState,
): SequenceRuntimeState {
  const existing = findStageState(state, stageId);
  const nextEntry = existing ? update(existing) : update(createIfMissing());
  const stageStates = existing
    ? state.stageStates.map((s) => (s.stageId === stageId ? nextEntry : s))
    : [...state.stageStates, nextEntry];
  return { ...state, stageStates };
}

/**
 * Resolves the ordered stage list's first stage and produces the initial
 * `SequenceRuntimeState`. Does not itself persist anything — persistence
 * ownership is out of this contract's scope (schema field description,
 * `runtimeStateId`).
 */
export function initializeSequence(
  definition: SequenceDefinition,
  runtimeStateId: string,
): SequenceRuntimeState {
  const [first] = sortedStages(definition);
  if (!first) {
    throw new Error(`SequenceDefinition "${definition.sequenceId}" has no stages`);
  }
  return {
    contractType: "SEQUENCE_RUNTIME_STATE",
    runtimeStateId,
    sequenceId: definition.sequenceId,
    sequenceVersion: definition.sequenceVersion,
    currentStageId: first.stageId,
    stageStates: [
      {
        stageId: first.stageId,
        status: "IN_PROGRESS",
        hintLevel: 0,
        hintCount: 0,
        attemptsForStage: 0,
        lastTransitionEvent: "SEQUENCE_STARTED",
      },
    ],
    attemptReferences: [],
    sequenceCompletionState: "IN_PROGRESS",
  };
}

export function resolveCurrentStage(
  definition: SequenceDefinition,
  state: SequenceRuntimeState,
): StageDefinition {
  return findStage(definition, state.currentStageId);
}

export type EngineDispatchResolution =
  | { resolved: true; engine: EngineDefinition<unknown, unknown> }
  | { resolved: false; reason: string };

export interface EngineDispatchDeps {
  runtimeRegistry: EngineRuntimeRegistry;
  governanceRegistry?: EngineRegistry;
  templateRegistry?: TemplateRegistry;
  /** Required only when resolutionMode is SUPPORT_EVALUATOR. */
  supportEvaluatorOptions?: EvaluateSupportOptions;
  /** Required only when resolutionMode is SUPPORT_EVALUATOR — the caller's ActivitySpecification for this stage. */
  activityId?: string;
  pedagogicalObjective?: string;
  reasoningType?: string;
  interactionModel?: string;
  evidenceModel?: string;
  evaluationModel?: string;
}

/**
 * Never resolves an engine by any means other than the two modes the
 * contract declares. An unresolved dispatch is returned, not thrown or
 * silently substituted with a similar engine (R3C.1 attempt-dispatch
 * precedent, `07_13` / `02_36` section 11-bis).
 */
export function resolveEngineDispatch(
  stage: StageDefinition,
  deps: EngineDispatchDeps,
): EngineDispatchResolution {
  const ref = stage.engineDispatchRef;
  if (!ref) {
    return { resolved: false, reason: `Stage "${stage.stageId}" has no engineDispatchRef` };
  }

  if (ref.resolutionMode === "RUNTIME_ADAPTER_ID") {
    if (!ref.runtimeAdapterId) {
      return { resolved: false, reason: "RUNTIME_ADAPTER_ID mode requires runtimeAdapterId" };
    }
    const engine = deps.runtimeRegistry.getByRuntimeAdapterId(ref.runtimeAdapterId);
    if (!engine) {
      return {
        resolved: false,
        reason: `Unknown runtimeAdapterId "${ref.runtimeAdapterId}" — no fallback substitution performed`,
      };
    }
    return { resolved: true, engine };
  }

  // SUPPORT_EVALUATOR
  if (!ref.requiredCapabilities || ref.requiredCapabilities.length === 0) {
    return { resolved: false, reason: "SUPPORT_EVALUATOR mode requires requiredCapabilities" };
  }
  if (!deps.governanceRegistry || !deps.templateRegistry || !deps.supportEvaluatorOptions) {
    return {
      resolved: false,
      reason:
        "SUPPORT_EVALUATOR mode requires governanceRegistry, templateRegistry and supportEvaluatorOptions to be supplied",
    };
  }
  const requiredCapabilities = ref.requiredCapabilities.filter(isAxisAValue) as AxisAValue[];
  if (requiredCapabilities.length !== ref.requiredCapabilities.length) {
    return {
      resolved: false,
      reason: `requiredCapabilities contains a value outside the AxisAValue vocabulary: ${JSON.stringify(ref.requiredCapabilities)}`,
    };
  }
  const evaluation = evaluateSupport(
    {
      activityId: deps.activityId ?? stage.activityRef ?? stage.stageId,
      pedagogicalObjective: deps.pedagogicalObjective ?? "",
      reasoningType: deps.reasoningType ?? "",
      interactionModel: deps.interactionModel ?? "",
      evidenceModel: deps.evidenceModel ?? "",
      evaluationModel: deps.evaluationModel ?? "",
      requiredCapabilities,
    },
    deps.governanceRegistry,
    deps.templateRegistry,
    deps.supportEvaluatorOptions,
  );
  if (
    (evaluation.result.outcome !== "SUPPORTED" && evaluation.result.outcome !== "SUPPORTED_WITH_TEMPLATE") ||
    !evaluation.result.selectedEngine
  ) {
    return {
      resolved: false,
      reason: `Support Evaluator outcome ${evaluation.result.outcome} — no engine selected (ENGINE_GAP or unsupported)`,
    };
  }
  const registryEntry = deps.governanceRegistry.get(evaluation.result.selectedEngine);
  const runtimeAdapterId = registryEntry?.runtimeAdapters.find((a) => a.runtimeChannel === "WEB")
    ?.runtimeAdapterId;
  if (!runtimeAdapterId) {
    return {
      resolved: false,
      reason: `selectedEngine "${evaluation.result.selectedEngine}" has no WEB runtimeAdapter registered`,
    };
  }
  const engine = deps.runtimeRegistry.getByRuntimeAdapterId(runtimeAdapterId);
  if (!engine) {
    return {
      resolved: false,
      reason: `selectedEngine resolved to runtimeAdapterId "${runtimeAdapterId}" but no runtime engine is registered for it`,
    };
  }
  return { resolved: true, engine };
}

export type ProgressionOutcome = "ADVANCED" | "RETRY" | "REMEDIATION_TRIGGERED" | "AWAITING_MANUAL_ADVANCE";

export interface ReceiveEngineResultOutcome {
  state: SequenceRuntimeState;
  outcome: ProgressionOutcome;
}

/**
 * Applies a stage's already-computed `EngineEvaluationResult` (the engine
 * itself decided correctness — this function never evaluates anything) to
 * the current stage's `ProgressionRule`. Increments `attemptsForStage`
 * unconditionally on every received result; advances, retries, or flags
 * remediation depending on `triggerType`/`maxAttemptsBeforeRemediation`.
 */
export function receiveEngineResult(
  definition: SequenceDefinition,
  state: SequenceRuntimeState,
  evaluation: EngineEvaluationResult,
): ReceiveEngineResultOutcome {
  const stage = resolveCurrentStage(definition, state);
  const rule = stage.progressionRule;
  if (!rule) {
    throw new Error(`Stage "${stage.stageId}" has no progressionRule but received an engine result`);
  }

  let nextState = withStageState(
    state,
    stage.stageId,
    (existing) => ({
      ...existing,
      attemptsForStage: existing.attemptsForStage + 1,
      lastTransitionEvent: "ENGINE_RESULT_RECEIVED" as StageTransitionEvent,
    }),
    () => ({
      stageId: stage.stageId,
      status: "IN_PROGRESS",
      hintLevel: 0,
      hintCount: 0,
      attemptsForStage: 1,
      lastTransitionEvent: "ENGINE_RESULT_RECEIVED",
    }),
  );

  const attemptsForStage = findStageState(nextState, stage.stageId)!.attemptsForStage;
  const correct = evaluation.evaluated && evaluation.correctness === "CORRECT";

  const shouldAdvance =
    rule.triggerType === "ON_ENGINE_EVALUATION_ANY" ||
    rule.triggerType === "ON_STAGE_CONFIRM" ||
    (rule.triggerType === "ON_ENGINE_EVALUATION_CORRECT" && correct);

  if (shouldAdvance) {
    return { state: markStageComplete(definition, nextState, stage.stageId), outcome: "ADVANCED" };
  }

  if (rule.triggerType === "MANUAL") {
    return { state: nextState, outcome: "AWAITING_MANUAL_ADVANCE" };
  }

  // ON_ENGINE_EVALUATION_CORRECT, not correct: retry or remediate.
  const maxAttempts = rule.maxAttemptsBeforeRemediation;
  if (maxAttempts !== undefined && attemptsForStage >= maxAttempts && stage.remediationPolicy) {
    nextState = withStageState(
      nextState,
      stage.stageId,
      (existing) => ({
        ...existing,
        remediationTriggered: true,
        lastTransitionEvent: "REMEDIATION_TRIGGERED" as StageTransitionEvent,
      }),
      () => {
        throw new Error("unreachable: stage state must exist after ENGINE_RESULT_RECEIVED update");
      },
    );
    return { state: nextState, outcome: "REMEDIATION_TRIGGERED" };
  }

  return { state: nextState, outcome: "RETRY" };
}

function markStageComplete(
  definition: SequenceDefinition,
  state: SequenceRuntimeState,
  stageId: string,
): SequenceRuntimeState {
  const stage = findStage(definition, stageId);
  return withStageState(
    state,
    stageId,
    (existing) => ({
      ...existing,
      status: "COMPLETED",
      ...(stage.checkpointPolicy?.isCheckpoint ? { checkpointReached: true as const } : {}),
    }),
    () => {
      throw new Error(`unreachable: stage "${stageId}" has no runtime state to mark complete`);
    },
  );
}

/**
 * Governs `hintLevel`/`hintCount` gating only — hint content itself is
 * never held here (schema `HintPolicy` description); it is presented by
 * the active engine in response to the existing `REQUEST_HINT` semantic
 * action, which this module never dispatches or re-implements.
 */
export function requestHint(definition: SequenceDefinition, state: SequenceRuntimeState): SequenceRuntimeState {
  const stage = resolveCurrentStage(definition, state);
  const maxHintLevel = stage.hintPolicy?.maxHintLevel ?? 0;
  return withStageState(
    state,
    stage.stageId,
    (existing) => {
      const advanced = existing.hintLevel < maxHintLevel;
      return {
        ...existing,
        hintCount: existing.hintCount + 1,
        hintLevel: advanced ? existing.hintLevel + 1 : existing.hintLevel,
        lastTransitionEvent: (advanced ? "HINT_LEVEL_ADVANCED" : "HINT_REQUESTED") as StageTransitionEvent,
      };
    },
    () => {
      throw new Error(`unreachable: current stage "${stage.stageId}" must already have a runtime state entry`);
    },
  );
}

/**
 * Moves `currentStageId` to the next stage by `order`, or completes the
 * sequence if the current stage was last. Marks the outgoing stage
 * COMPLETED if it was not already (covers non-interactive/manual stages
 * that never went through `receiveEngineResult`).
 */
export function advanceStage(definition: SequenceDefinition, state: SequenceRuntimeState): SequenceRuntimeState {
  const stages = sortedStages(definition);
  const currentIndex = stages.findIndex((s) => s.stageId === state.currentStageId);
  if (currentIndex === -1) throw new UnknownStageError(state.currentStageId);

  let nextState = markStageComplete(definition, state, state.currentStageId);
  nextState = withStageState(
    nextState,
    state.currentStageId,
    (existing) => ({ ...existing, lastTransitionEvent: "STAGE_ADVANCED" as StageTransitionEvent }),
    () => {
      throw new Error("unreachable");
    },
  );

  const next = stages[currentIndex + 1];
  if (!next) {
    nextState = withStageState(
      nextState,
      state.currentStageId,
      (existing) => ({ ...existing, lastTransitionEvent: "SEQUENCE_COMPLETED" as StageTransitionEvent }),
      () => {
        throw new Error("unreachable");
      },
    );
    return { ...nextState, sequenceCompletionState: "COMPLETED" };
  }

  nextState = withStageState(
    nextState,
    next.stageId,
    (existing) => ({ ...existing, status: "IN_PROGRESS", lastTransitionEvent: "STAGE_ENTERED" as StageTransitionEvent }),
    () => ({
      stageId: next.stageId,
      status: "IN_PROGRESS",
      hintLevel: 0,
      hintCount: 0,
      attemptsForStage: 0,
      lastTransitionEvent: "STAGE_ENTERED",
    }),
  );
  return { ...nextState, currentStageId: next.stageId };
}

/** Jumps directly to a remediation target stage, when the current stage's RemediationPolicy declares one. */
export function redirectToRemediationTarget(
  definition: SequenceDefinition,
  state: SequenceRuntimeState,
): SequenceRuntimeState {
  const stage = resolveCurrentStage(definition, state);
  const targetStageId = stage.remediationPolicy?.targetStageId;
  if (!targetStageId) {
    throw new Error(`Stage "${stage.stageId}" has no remediationPolicy.targetStageId to redirect to`);
  }
  findStage(definition, targetStageId); // throws UnknownStageError if dangling
  return withStageState(
    state,
    targetStageId,
    (existing) => ({ ...existing, status: "IN_PROGRESS", lastTransitionEvent: "STAGE_ENTERED" as StageTransitionEvent }),
    () => ({
      stageId: targetStageId,
      status: "IN_PROGRESS",
      hintLevel: 0,
      hintCount: 0,
      attemptsForStage: 0,
      lastTransitionEvent: "STAGE_ENTERED",
    }),
  );
}

export function addAttemptReference(
  state: SequenceRuntimeState,
  stageId: string,
  attemptId: string,
): SequenceRuntimeState {
  if (state.attemptReferences.some((r) => r.stageId === stageId && r.attemptId === attemptId)) {
    return state;
  }
  return { ...state, attemptReferences: [...state.attemptReferences, { stageId, attemptId }] };
}

export function abandonSequence(state: SequenceRuntimeState): SequenceRuntimeState {
  return { ...state, sequenceCompletionState: "ABANDONED" };
}

export function isSequenceComplete(state: SequenceRuntimeState): boolean {
  return state.sequenceCompletionState === "COMPLETED";
}
