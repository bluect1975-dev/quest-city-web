/**
 * TypeScript mirror of the vendored R3C.2 canonical contract
 * (`@quest-city-web/content-schema`'s `r3c2StageOrchestrationContract`,
 * `schemas/vendor/r3c2/stage-orchestration-contract.schema.json`). Hand
 * written to match the schema field-for-field, following this repo's
 * existing convention (e.g. `attempt-context-builder.ts`'s
 * `LearningAttemptRow`) of hand-maintained TS types alongside Ajv-validated
 * JSON Schema rather than a codegen step. `parseSequenceDefinition`/
 * `parseSequenceRuntimeState` are the only supported way to turn untrusted
 * `unknown` data into these types — always validated through the real Ajv
 * pipeline (`validateAgainst`), never trusted by a bare cast.
 */
import { validateAgainst } from "@quest-city-web/content-schema";

export type SequenceCompletionState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
export type StageStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
export type EngineDispatchResolutionMode = "RUNTIME_ADAPTER_ID" | "SUPPORT_EVALUATOR";
export type ProgressionTriggerType =
  | "ON_ENGINE_EVALUATION_CORRECT"
  | "ON_ENGINE_EVALUATION_ANY"
  | "ON_STAGE_CONFIRM"
  | "MANUAL";

/**
 * Internal orchestration-layer event vocabulary (schema's `lastTransitionEvent`
 * enum). Never dispatched to a Learning Engine, never merged with
 * `SemanticAction` (`@quest-city-web/learning-engines`). `STAGE_ADVANCED`
 * replaces the never-canonical `ADVANCE_STAGE` removed from `07_13` in
 * R3C.2A.
 */
export type StageTransitionEvent =
  | "SEQUENCE_STARTED"
  | "STAGE_ENTERED"
  | "ENGINE_RESULT_RECEIVED"
  | "HINT_REQUESTED"
  | "HINT_LEVEL_ADVANCED"
  | "REMEDIATION_TRIGGERED"
  | "STAGE_ADVANCED"
  | "SEQUENCE_COMPLETED";

export interface EngineDispatchRef {
  resolutionMode: EngineDispatchResolutionMode;
  runtimeAdapterId?: string;
  requiredCapabilities?: string[];
}

export interface ProgressionRule {
  triggerType: ProgressionTriggerType;
  maxAttemptsBeforeRemediation?: number;
}

export interface HintLevelDescriptor {
  level: number;
  description: string;
}

export interface HintPolicy {
  maxHintLevel: number;
  levels?: HintLevelDescriptor[];
}

export interface RemediationPolicy {
  triggerAfterAttempts?: number;
  targetStageId?: string;
  targetActivityRef?: string;
}

export interface CheckpointPolicy {
  isCheckpoint: boolean;
}

export interface StageDefinition {
  stageId: string;
  stageType: string;
  order: number;
  isInteractive: boolean;
  activityRef?: string;
  engineDispatchRef?: EngineDispatchRef;
  progressionRule?: ProgressionRule;
  hintPolicy?: HintPolicy;
  remediationPolicy?: RemediationPolicy;
  checkpointPolicy?: CheckpointPolicy;
}

export interface SequenceDefinition {
  contractType: "SEQUENCE_DEFINITION";
  sequenceId: string;
  sequenceVersion: string;
  stages: StageDefinition[];
}

export interface StageRuntimeState {
  stageId: string;
  status: StageStatus;
  hintLevel: number;
  hintCount: number;
  attemptsForStage: number;
  checkpointReached?: boolean;
  remediationTriggered?: boolean;
  lastTransitionEvent?: StageTransitionEvent;
}

export interface AttemptReference {
  stageId: string;
  attemptId: string;
}

export interface SequenceRuntimeState {
  contractType: "SEQUENCE_RUNTIME_STATE";
  runtimeStateId: string;
  sequenceId: string;
  sequenceVersion: string;
  currentStageId: string;
  stageStates: StageRuntimeState[];
  attemptReferences: AttemptReference[];
  sequenceCompletionState: SequenceCompletionState;
}

export type ParseResult<T> = { valid: true; data: T } | { valid: false; errors: string[] };

export function parseSequenceDefinition(data: unknown): ParseResult<SequenceDefinition> {
  const result = validateAgainst("r3c2StageOrchestrationContract", data);
  if (!result.valid) {
    return { valid: false, errors: result.errors };
  }
  const candidate = data as { contractType?: string };
  if (candidate.contractType !== "SEQUENCE_DEFINITION") {
    return { valid: false, errors: ["/contractType must be SEQUENCE_DEFINITION"] };
  }
  return { valid: true, data: data as SequenceDefinition };
}

export function parseSequenceRuntimeState(data: unknown): ParseResult<SequenceRuntimeState> {
  const result = validateAgainst("r3c2StageOrchestrationContract", data);
  if (!result.valid) {
    return { valid: false, errors: result.errors };
  }
  const candidate = data as { contractType?: string };
  if (candidate.contractType !== "SEQUENCE_RUNTIME_STATE") {
    return { valid: false, errors: ["/contractType must be SEQUENCE_RUNTIME_STATE"] };
  }
  return { valid: true, data: data as SequenceRuntimeState };
}
