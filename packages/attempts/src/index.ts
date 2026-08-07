export type { Queryable } from "./repository/types";
export {
  ContentBundleRepository,
  type ContentBundle,
  type ContentBundleStatus,
  type ContentBundleType,
} from "./repository/content-bundle-repository";
export {
  AssignmentRepository,
  type Assignment,
  type AssignmentStatus,
  type CompletionPolicy,
  type CreatedByActorType,
} from "./repository/assignment-repository";
export {
  LearningAttemptRepository,
  type LearningAttempt,
  type AttemptState,
  type CompletionStatus,
  type RuntimeChannel,
  type ProgressSummary,
  type ProgressSummaryFilters,
} from "./repository/learning-attempt-repository";
export {
  SemanticActionLogRepository,
  type SemanticActionLogEntry,
  type SemanticActionType,
} from "./repository/semantic-action-log-repository";
export {
  AttemptResponseRepository,
  type AttemptResponse,
  type AttemptResponseCorrectness,
} from "./repository/attempt-response-repository";
export {
  IdempotencyRecordRepository,
  type IdempotencyBeginOutcome,
  type IdempotencyFinishOutcome,
} from "./repository/idempotency-record-repository";

export { IdempotencyService } from "./services/idempotency-service";
export {
  evaluateBalanceMachine,
  BALANCE_MACHINE_VALIDATOR_REF,
  BALANCE_MACHINE_VALIDATOR_VERSION,
  BALANCE_MACHINE_ITEM_ID,
  type BalanceMachineEvaluation,
} from "./services/balance-machine-validator";
export {
  checkFinalClientSequence,
  type FinalClientSequenceCheckResult,
} from "./services/final-client-sequence-guard";
export {
  RuntimeCapabilityResolver,
  type PresentationAdapterRef,
  type RuntimeCapabilityResolveInput,
  type RuntimeCapabilityResolveResult,
} from "./services/runtime-capability-resolver";
export {
  AttemptConsolidationService,
  type ConsolidateInput,
  type ConsolidateResult,
  type CompleteAttemptResponseStatus,
} from "./services/attempt-consolidation-service";
export {
  CrossRuntimeReconciliationService,
  type AttemptSummary,
  type ReconciliationResolution,
  type EvaluateResult,
} from "./services/cross-runtime-reconciliation-service";

export {
  CrossRuntimeError,
  CROSS_RUNTIME_ERROR_CODES,
  type CrossRuntimeErrorCode,
  type ErrorDomain,
  type ErrorEnvelope,
} from "./errors";
