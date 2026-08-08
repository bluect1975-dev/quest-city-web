/**
 * Canonical types mirroring the R3A contracts vendored at
 * packages/content-schema/schemas/vendor/r3a/ (provenance: same directory).
 * Field names and enums are kept identical to the vendored schemas —
 * do not rename or extend without updating the schemas first upstream.
 */

/** Axis A — Interaction/Activity Capabilities. Owned by 07_08 §9, formalized by 02_36 §4.1. */
export const AXIS_A_VALUES = [
  "TEXT_INPUT",
  "NUMERIC_INPUT",
  "OPTION_SELECTION",
  "DRAG_DROP",
  "ORDERING",
  "MATCHING",
  "GRAPH_PLOT",
  "OBJECT_MANIPULATION_2D",
  "OBJECT_MANIPULATION_3D",
  "AUDIO_PLAYBACK",
  "VOICE_INPUT",
  "REALTIME_MULTIUSER",
  "ANIMATED_SCENE",
  "OFFLINE_BUFFERED_ACTIONS",
] as const;
export type AxisAValue = (typeof AXIS_A_VALUES)[number];

/** Axis B — Device/Runtime Presentation Capabilities, mirrors capability-profile.schema.json. */
export interface AxisBProfile {
  profileId: string;
  input: Array<"pointer" | "touch" | "keyboard" | "assistive">;
  rendering: Array<"html" | "svg" | "canvas2d">;
  reducedMotion?: boolean;
  viewportClass?: "compact" | "medium" | "large" | "xlarge";
}

/** Semantic action vocabulary, reused verbatim from 07_08 §6 / semantic-action.schema.json — never redefined locally. */
export const SEMANTIC_ACTIONS = [
  "SELECT_OPTION",
  "ENTER_VALUE",
  "PLACE_ITEM",
  "MOVE_ITEM",
  "CONNECT_NODES",
  "ORDER_ITEMS",
  "REQUEST_HINT",
  "CONFIRM_SOLUTION",
  "RESET_STAGE",
  "PAUSE_ACTIVITY",
  "RESUME_ACTIVITY",
] as const;
export type SemanticAction = (typeof SEMANTIC_ACTIONS)[number];

export type LifecycleStatus = "DRAFT" | "ACTIVE" | "DEPRECATED" | "RETIRED";

export type SupportOutcome =
  | "SUPPORTED"
  | "SUPPORTED_WITH_TEMPLATE"
  | "SUPPORTED_WITH_LIMITATIONS"
  | "ENGINE_GAP";

export type PublicationEligibility = "NOT_PUBLISHABLE" | "ELIGIBLE";

export interface RuntimeAdapterRef {
  runtimeChannel: "WEB" | "ROBLOX";
  runtimeAdapterId: string;
  minRuntimeVersion?: string;
  maxTestedRuntimeVersion?: string;
}

/** Conforms to schemas/vendor/r3a/engine-registry.schema.json. */
export interface EngineRegistryEntry {
  canonicalEngineId: string;
  version: string;
  lifecycleStatus: LifecycleStatus;
  capabilities: {
    required: AxisAValue[];
    optional: AxisAValue[];
  };
  semanticActions: SemanticAction[];
  templates?: string[];
  configurationSchemaRef: string;
  stateSchemaRef?: string;
  validatorRequirements: unknown[];
  accessibilityRequirements: unknown[];
  persistenceRequirements: Record<string, unknown>;
  scoringEvidenceRequirements: Record<string, unknown>;
  themeAdapterRef?: string;
  runtimeAdapters: RuntimeAdapterRef[];
  publicationRequirements: {
    minLifecycleStatus?: "ACTIVE";
    requiresRealTestsPass?: true;
  };
  provenance?: {
    sourceDocument?: string;
    sourceDocumentVersion?: string;
    registeredAtRegistryVersion?: string;
  };
}

/** Conforms to schemas/vendor/r3a/template-contract.schema.json. */
export interface TemplateContractEntry {
  templateId: string;
  templateVersion: string;
  canonicalEngineId: string;
  requiredCapabilities: AxisAValue[];
  configurationSchemaRef: string;
  configurationSchemaVersion?: string;
  defaultConfiguration: Record<string, unknown>;
  semanticActions: SemanticAction[];
  validatorRequirements: unknown[];
  accessibilityRequirements: unknown[];
  presentationConstraints?: Record<string, unknown>;
  evidenceScoringExpectations?: Record<string, unknown>;
}

/**
 * Minimal but sufficient evaluation input (R3B §26). The five pedagogical
 * fields are free-form domain identifiers, not enums — the runtime never
 * infers their equivalence across candidates; see FidelityAssessment.
 */
export interface ActivitySpecification {
  activityId: string;
  subject?: string;
  curriculumRef?: string;
  moduleRef?: string;
  unitRef?: string;
  pedagogicalObjective: string;
  reasoningType: string;
  interactionModel: string;
  evidenceModel: string;
  evaluationModel: string;
  requiredCapabilities: AxisAValue[];
  deviceProfile?: AxisBProfile;
  preferredCanonicalEngineIds?: string[];
}

/**
 * Declares, for one candidate engine/template, whether adopting it
 * preserves each of the five pedagogical fidelity dimensions (02_36 §8.1).
 * This is supplied by the caller (the AI/content pipeline that designed
 * the activity), not inferred by the runtime — determining semantic
 * pedagogical equivalence between free-text objectives is a judgment call
 * outside what a capability-set diff can decide. The rule itself
 * (violate any dimension => ENGINE_GAP) is applied deterministically.
 */
export interface FidelityAssessment {
  canonicalEngineId: string;
  templateId?: string;
  preservesPedagogicalObjective: boolean;
  preservesReasoningType: boolean;
  preservesInteractionModel: boolean;
  preservesEvidenceModel: boolean;
  preservesEvaluationModel: boolean;
  limitations?: Array<{ description: string; pedagogicallySubstantial: false }>;
}

export interface SupportEvaluationResult {
  activityId: string;
  outcome: SupportOutcome;
  evaluatedEngines: string[];
  evaluatedTemplates: string[];
  selectedEngine?: string;
  selectedTemplate?: string;
  limitations?: Array<{ description: string; pedagogicallySubstantial: false }>;
  engineGapReportRef?: string;
  publicationEligibility: PublicationEligibility;
  capabilityContractVersion: string;
  registryVersion: string;
  evaluationTimestamp: string;
  evaluationVersion: string;
}

export type RecommendedResolution =
  | "NEW_TEMPLATE"
  | "NEW_ENGINE"
  | "EXTEND_EXISTING_ENGINE"
  | "NO_RESOLUTION_AVAILABLE";

/** Conforms to schemas/vendor/r3a/engine-gap-report.schema.json. */
export interface EngineGapReport {
  activityId: string;
  subject?: string;
  curriculumRef?: string;
  moduleRef?: string;
  unitRef?: string;
  pedagogicalObjective: string;
  requiredCapabilities: AxisAValue[];
  evaluatedEngines: string[];
  evaluatedTemplates: string[];
  incompatibilityReasons: string[];
  pedagogicalImpact: string;
  recommendedResolution: RecommendedResolution;
  proposedEngineId?: string;
  proposedCapabilities?: AxisAValue[];
  requiredSemanticActions?: SemanticAction[];
  reportVersion: string;
  generatedAt: string;
}
