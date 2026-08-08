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
