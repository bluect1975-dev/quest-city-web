export { EngineAlreadyRegisteredError, EngineRegistry } from "./registry";
export { TemplateAlreadyRegisteredError, TemplateRegistry } from "./template-registry";
export {
  AXIS_A_VALUES,
  SEMANTIC_ACTIONS,
  type ActivitySpecification,
  type AxisAValue,
  type AxisBProfile,
  type EngineGapReport,
  type EngineRegistryEntry,
  type FidelityAssessment,
  type LifecycleStatus,
  type PublicationEligibility,
  type RecommendedResolution,
  type RuntimeAdapterRef,
  type SemanticAction,
  type SupportEvaluationResult,
  type SupportOutcome,
  type TemplateContractEntry,
} from "./types";
export {
  coversRequiredCapabilities,
  isAxisAValue,
  satisfiesAxisBRequirement,
  type AxisBRequirement,
} from "./capability-contract";
export { buildEngineGapReport, type BuildEngineGapReportInput } from "./engine-gap-report";
export {
  evaluateSupport,
  type EvaluateSupportOptions,
  type EvaluateSupportResult,
} from "./support-evaluator";
export {
  replayActions,
  type ConfigValidationResult,
  type EngineActionOutcome,
  type EngineDefinition,
  type EngineEvaluationResult,
  type EngineSemanticAction,
  type ReplayResult,
} from "./engine-runtime";
export { EngineAlreadyRegisteredError as EngineRuntimeAlreadyRegisteredError, EngineRuntimeRegistry } from "./engine-runtime-registry";
export { createDefaultEngineRuntimeRegistry, createP0EngineRegistryEntries } from "./default-engines";
export {
  BALANCE_MACHINE_CANONICAL_ENGINE_ID,
  BALANCE_MACHINE_RUNTIME_ADAPTER_ID,
  BALANCE_MACHINE_ENGINE_VERSION,
  buildBalanceMachineRegistryEntry,
  createBalanceMachineEngine,
  validateBalanceMachineConfig,
  type BalanceMachineConfig,
  type BalanceMachineState,
  type BalanceMachineToken,
} from "./engines/balance-machine-engine";
export {
  QUICK_QUESTION_CANONICAL_ENGINE_ID,
  QUICK_QUESTION_RUNTIME_ADAPTER_ID,
  QUICK_QUESTION_ENGINE_VERSION,
  buildQuickQuestionRegistryEntry,
  createQuickQuestionEngine,
  validateQuickQuestionConfig,
  type QuickQuestionConfig,
  type QuickQuestionMode,
  type QuickQuestionOption,
  type QuickQuestionState,
} from "./engines/quick-question-engine";
export {
  DRAG_AND_DROP_CANONICAL_ENGINE_ID,
  DRAG_AND_DROP_RUNTIME_ADAPTER_ID,
  DRAG_AND_DROP_ENGINE_VERSION,
  buildDragAndDropRegistryEntry,
  createDragAndDropEngine,
  validateDragDropConfig,
  type DragDropConfig,
  type DragDropItem,
  type DragDropMapping,
  type DragDropState,
  type DragDropTarget,
} from "./engines/drag-and-drop-engine";
