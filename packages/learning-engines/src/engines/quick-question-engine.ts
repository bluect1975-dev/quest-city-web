import type {
  ConfigValidationResult,
  EngineActionOutcome,
  EngineDefinition,
  EngineEvaluationResult,
  EngineSemanticAction,
} from "../engine-runtime";
import type { EngineRegistryEntry } from "../types";

/**
 * QuickQuestionEngine (`canonicalEngineId: ENG-QUICK`, `07_10 §7`,
 * `runtimeAdapterId: QC-WEB-ENGINE-QUICK-QUESTION`, ratified R3C.0A).
 * Two interaction modes only, per instruction §22: OPTION_SELECTION
 * (baseline) and a simple ENTER_VALUE numeric mode — `07_10 §7` documents
 * QuickQuestionEngine already supporting numeric answers as a configured
 * input mode. This is NOT NumericInputEngine/QC-WEB-ENGINE-NUMERIC-INPUT
 * (that runtimeAdapterId is `PROPOSED`, P1, not registered here) — it is
 * this same engine, same identity, exercising its documented ENTER_VALUE
 * capability for the simplest case (single expected numeric value, no
 * fraction/expression/unit parsing).
 */

export const QUICK_QUESTION_CANONICAL_ENGINE_ID = "ENG-QUICK";
export const QUICK_QUESTION_RUNTIME_ADAPTER_ID = "QC-WEB-ENGINE-QUICK-QUESTION";
export const QUICK_QUESTION_ENGINE_VERSION = "1.0.0";

export type QuickQuestionMode = "OPTION_SELECTION" | "ENTER_VALUE";

export interface QuickQuestionOption {
  optionId: string;
}

export type QuickQuestionConfig =
  | {
      mode: "OPTION_SELECTION";
      options: QuickQuestionOption[];
      correctOptionId: string;
    }
  | {
      mode: "ENTER_VALUE";
      expectedValue: number;
      tolerance: number;
    };

export interface QuickQuestionState {
  selectedOptionId?: string;
  enteredValue?: number;
  confirmed: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateQuickQuestionConfig(config: unknown): ConfigValidationResult<QuickQuestionConfig> {
  if (typeof config !== "object" || config === null) {
    return { valid: false, errors: ["config must be an object"] };
  }
  const record = config as Record<string, unknown>;
  const mode = record["mode"];
  if (mode === "OPTION_SELECTION") {
    const errors: string[] = [];
    const options = record["options"];
    if (!Array.isArray(options) || options.length < 2) {
      errors.push("config.options must have at least 2 entries for OPTION_SELECTION");
      return { valid: false, errors };
    }
    const parsedOptions: QuickQuestionOption[] = [];
    const seen = new Set<string>();
    for (const [index, raw] of options.entries()) {
      const optionId = (raw as Record<string, unknown> | null)?.["optionId"];
      if (typeof optionId !== "string" || optionId.length === 0) {
        errors.push(`options[${index}].optionId must be a non-empty string`);
        continue;
      }
      if (seen.has(optionId)) {
        errors.push(`options[${index}].optionId is duplicated: ${optionId}`);
        continue;
      }
      seen.add(optionId);
      parsedOptions.push({ optionId });
    }
    const correctOptionId = record["correctOptionId"];
    if (typeof correctOptionId !== "string" || !seen.has(correctOptionId)) {
      errors.push("config.correctOptionId must reference one of config.options");
    }
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true, config: { mode: "OPTION_SELECTION", options: parsedOptions, correctOptionId: correctOptionId as string } };
  }
  if (mode === "ENTER_VALUE") {
    const expectedValue = record["expectedValue"];
    const tolerance = record["tolerance"] ?? 0;
    const errors: string[] = [];
    if (!isFiniteNumber(expectedValue)) {
      errors.push("config.expectedValue must be a finite number for ENTER_VALUE");
    }
    if (!isFiniteNumber(tolerance) || tolerance < 0) {
      errors.push("config.tolerance must be a non-negative finite number");
    }
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true, config: { mode: "ENTER_VALUE", expectedValue: expectedValue as number, tolerance: tolerance as number } };
  }
  return { valid: false, errors: [`config.mode must be OPTION_SELECTION or ENTER_VALUE, got: ${String(mode)}`] };
}

function initState(): QuickQuestionState {
  return { confirmed: false };
}

function applyAction(
  state: QuickQuestionState,
  config: QuickQuestionConfig,
  action: EngineSemanticAction,
): EngineActionOutcome<QuickQuestionState> {
  if (action.actionType === "RESET_STAGE") {
    return { accepted: true, state: initState() };
  }
  if (action.actionType === "SELECT_OPTION") {
    if (config.mode !== "OPTION_SELECTION") {
      return { accepted: false, state, reason: "SELECT_OPTION is not valid for mode ENTER_VALUE" };
    }
    if (action.targetRole !== "option") {
      return { accepted: false, state, reason: "SELECT_OPTION requires targetRole option" };
    }
    const optionId = action.payload["optionId"];
    if (typeof optionId !== "string" || !config.options.some((option) => option.optionId === optionId)) {
      return { accepted: false, state, reason: "unknown optionId" };
    }
    return { accepted: true, state: { ...state, selectedOptionId: optionId, confirmed: false } };
  }
  if (action.actionType === "ENTER_VALUE") {
    if (config.mode !== "ENTER_VALUE") {
      return { accepted: false, state, reason: "ENTER_VALUE is not valid for mode OPTION_SELECTION" };
    }
    if (action.targetRole !== "value-input") {
      return { accepted: false, state, reason: "ENTER_VALUE requires targetRole value-input" };
    }
    const value = action.payload["value"];
    if (!isFiniteNumber(value)) {
      return { accepted: false, state, reason: "malformed ENTER_VALUE payload" };
    }
    return { accepted: true, state: { ...state, enteredValue: value, confirmed: false } };
  }
  if (action.actionType === "CONFIRM_SOLUTION") {
    if (action.targetRole !== "confirm-button") {
      return { accepted: false, state, reason: "CONFIRM_SOLUTION requires targetRole confirm-button" };
    }
    const hasAnswer = config.mode === "OPTION_SELECTION" ? state.selectedOptionId !== undefined : state.enteredValue !== undefined;
    if (!hasAnswer) {
      return { accepted: false, state, reason: "nothing to confirm" };
    }
    return { accepted: true, state: { ...state, confirmed: true } };
  }
  return { accepted: false, state, reason: `unsupported actionType for ENG-QUICK: ${action.actionType}` };
}

function evaluate(state: QuickQuestionState, config: QuickQuestionConfig): EngineEvaluationResult {
  if (!state.confirmed) {
    return { evaluated: false, reason: "NOT_CONFIRMED" };
  }
  if (config.mode === "OPTION_SELECTION") {
    if (state.selectedOptionId === undefined) {
      return { evaluated: false, reason: "NO_SELECTION" };
    }
    const correct = state.selectedOptionId === config.correctOptionId;
    return {
      evaluated: true,
      correctness: correct ? "CORRECT" : "INCORRECT",
      score: correct ? 1 : 0,
      evidence: { mode: "OPTION_SELECTION", selectedOptionId: state.selectedOptionId },
    };
  }
  if (state.enteredValue === undefined) {
    return { evaluated: false, reason: "NO_VALUE" };
  }
  const correct = Math.abs(state.enteredValue - config.expectedValue) <= config.tolerance;
  return {
    evaluated: true,
    correctness: correct ? "CORRECT" : "INCORRECT",
    score: correct ? 1 : 0,
    evidence: { mode: "ENTER_VALUE", enteredValue: state.enteredValue },
  };
}

export function createQuickQuestionEngine(): EngineDefinition<QuickQuestionConfig, QuickQuestionState> {
  return {
    canonicalEngineId: QUICK_QUESTION_CANONICAL_ENGINE_ID,
    runtimeAdapterId: QUICK_QUESTION_RUNTIME_ADAPTER_ID,
    engineVersion: QUICK_QUESTION_ENGINE_VERSION,
    capabilities: { required: ["OPTION_SELECTION"], optional: ["NUMERIC_INPUT"] },
    semanticActions: ["SELECT_OPTION", "ENTER_VALUE", "CONFIRM_SOLUTION", "RESET_STAGE"],
    validateConfig: validateQuickQuestionConfig,
    initState,
    applyAction,
    evaluate,
  };
}

export function buildQuickQuestionRegistryEntry(): EngineRegistryEntry {
  return {
    canonicalEngineId: QUICK_QUESTION_CANONICAL_ENGINE_ID,
    version: QUICK_QUESTION_ENGINE_VERSION,
    // Registry Update Gate (R3C.1 §65) fully PASS: implementation, identity,
    // config schema, state model, validator, semantic actions,
    // capabilities, accessibility, scoring/evidence, unit tests (19),
    // integration tests (Support Evaluator + schema, real dispatch path
    // shared with Balance and proven via real Postgres), responsive,
    // registry entry schema validity — see r3c1_report for the full matrix.
    lifecycleStatus: "ACTIVE",
    capabilities: { required: ["OPTION_SELECTION"], optional: ["NUMERIC_INPUT"] },
    semanticActions: ["SELECT_OPTION", "ENTER_VALUE", "CONFIRM_SOLUTION", "RESET_STAGE"],
    configurationSchemaRef: "quick-question-config.schema.json@1.0.0",
    validatorRequirements: [{ description: "deterministic-option-match" }, { description: "deterministic-numeric-tolerance" }],
    accessibilityRequirements: [{ requirement: "keyboard-operable" }, { requirement: "screen-reader-labels" }],
    persistenceRequirements: {},
    scoringEvidenceRequirements: { binaryCorrectness: true, partialCredit: false },
    themeAdapterRef: "QC-THEME-CORE",
    runtimeAdapters: [{ runtimeChannel: "WEB", runtimeAdapterId: QUICK_QUESTION_RUNTIME_ADAPTER_ID }],
    publicationRequirements: { minLifecycleStatus: "ACTIVE", requiresRealTestsPass: true },
    provenance: {
      sourceDocument: "07_10",
      sourceDocumentVersion: "1.3",
      registeredAtRegistryVersion: "R3C.1",
    },
  };
}
