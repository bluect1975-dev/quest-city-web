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
 * Three interaction modes: OPTION_SELECTION (baseline) and a simple
 * ENTER_VALUE numeric mode — `07_10 §7` documents QuickQuestionEngine
 * already supporting numeric answers as a configured input mode. This is
 * NOT NumericInputEngine/QC-WEB-ENGINE-NUMERIC-INPUT (that runtimeAdapterId
 * is `PROPOSED`, P1, not registered here) — it is this same engine, same
 * identity, exercising its documented ENTER_VALUE capability for the
 * simplest case (single expected numeric value, no fraction/expression/unit
 * parsing).
 *
 * ITEM_SET (Tranche 2, M06 Web Full Vertical Slice, `07_13` §6) wraps a
 * sequence of single-item OPTION_SELECTION/ENTER_VALUE configs so the
 * QUICK_QUESTION_SET stage stays one canonical stage with one engine
 * dispatch and one evaluation cycle from the orchestrator's point of view
 * (`02_36` §20-bis boundary: item-to-item progression is engine-owned
 * interaction/correctness/evidence, never orchestrator state). Items are
 * answered strictly in order — the engine tracks `currentItemIndex`
 * internally, so semantic actions never need to name which item they
 * target.
 */

export const QUICK_QUESTION_CANONICAL_ENGINE_ID = "ENG-QUICK";
export const QUICK_QUESTION_RUNTIME_ADAPTER_ID = "QC-WEB-ENGINE-QUICK-QUESTION";
export const QUICK_QUESTION_ENGINE_VERSION = "1.0.0";

export type QuickQuestionMode = "OPTION_SELECTION" | "ENTER_VALUE" | "ITEM_SET";

export interface QuickQuestionOption {
  optionId: string;
  text?: string;
}

export interface QuickQuestionMisconception {
  matchChoiceId?: string | undefined;
  code: string;
  feedbackText: string;
}

export interface QuickQuestionItemFeedback {
  correctFeedbackText?: string;
  incorrectFeedbackText?: string;
  solutionExplanation?: string;
  misconceptions?: QuickQuestionMisconception[];
}

export type QuickQuestionItemConfig =
  | {
      itemId: string;
      mode: "OPTION_SELECTION";
      prompt: string;
      options: Array<{ optionId: string; text: string }>;
      correctOptionId: string;
      feedback?: QuickQuestionItemFeedback | undefined;
    }
  | {
      itemId: string;
      mode: "ENTER_VALUE";
      prompt: string;
      expectedValue: number;
      tolerance: number;
      feedback?: QuickQuestionItemFeedback | undefined;
    };

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
    }
  | {
      mode: "ITEM_SET";
      items: QuickQuestionItemConfig[];
    };

export interface QuickQuestionItemResult {
  itemId: string;
  correctness: "CORRECT" | "INCORRECT";
  feedbackText: string;
  misconceptionCode?: string | undefined;
}

export interface QuickQuestionState {
  selectedOptionId?: string | undefined;
  enteredValue?: number | undefined;
  confirmed: boolean;
  currentItemIndex?: number;
  itemResults?: QuickQuestionItemResult[];
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
  if (mode === "ITEM_SET") {
    const rawItems = record["items"];
    if (!Array.isArray(rawItems) || rawItems.length < 1) {
      return { valid: false, errors: ["config.items must have at least 1 entry for ITEM_SET"] };
    }
    const errors: string[] = [];
    const parsedItems: QuickQuestionItemConfig[] = [];
    const seenItemIds = new Set<string>();
    for (const [index, raw] of rawItems.entries()) {
      const item = raw as Record<string, unknown> | null;
      const itemId = item?.["itemId"];
      if (typeof itemId !== "string" || itemId.length === 0) {
        errors.push(`items[${index}].itemId must be a non-empty string`);
        continue;
      }
      if (seenItemIds.has(itemId)) {
        errors.push(`items[${index}].itemId is duplicated: ${itemId}`);
        continue;
      }
      const itemMode = item?.["mode"];
      const prompt = item?.["prompt"];
      if (typeof prompt !== "string" || prompt.length === 0) {
        errors.push(`items[${index}].prompt must be a non-empty string`);
        continue;
      }
      if (itemMode === "OPTION_SELECTION") {
        const options = item?.["options"];
        if (!Array.isArray(options) || options.length < 2) {
          errors.push(`items[${index}].options must have at least 2 entries for OPTION_SELECTION`);
          continue;
        }
        const parsedOptions: Array<{ optionId: string; text: string }> = [];
        const seenOptionIds = new Set<string>();
        let optionsValid = true;
        for (const [optionIndex, rawOption] of options.entries()) {
          const optionRecord = rawOption as Record<string, unknown> | null;
          const optionId = optionRecord?.["optionId"];
          const text = optionRecord?.["text"];
          if (typeof optionId !== "string" || optionId.length === 0 || typeof text !== "string" || text.length === 0) {
            errors.push(`items[${index}].options[${optionIndex}] must have non-empty optionId and text`);
            optionsValid = false;
            continue;
          }
          if (seenOptionIds.has(optionId)) {
            errors.push(`items[${index}].options[${optionIndex}].optionId is duplicated: ${optionId}`);
            optionsValid = false;
            continue;
          }
          seenOptionIds.add(optionId);
          parsedOptions.push({ optionId, text });
        }
        const correctOptionId = item?.["correctOptionId"];
        if (typeof correctOptionId !== "string" || !seenOptionIds.has(correctOptionId)) {
          errors.push(`items[${index}].correctOptionId must reference one of items[${index}].options`);
          optionsValid = false;
        }
        if (!optionsValid) {
          continue;
        }
        seenItemIds.add(itemId);
        parsedItems.push({
          itemId,
          mode: "OPTION_SELECTION",
          prompt,
          options: parsedOptions,
          correctOptionId: correctOptionId as string,
          feedback: parseItemFeedback(item?.["feedback"]),
        });
        continue;
      }
      if (itemMode === "ENTER_VALUE") {
        const expectedValue = item?.["expectedValue"];
        const tolerance = item?.["tolerance"] ?? 0;
        if (!isFiniteNumber(expectedValue)) {
          errors.push(`items[${index}].expectedValue must be a finite number for ENTER_VALUE`);
          continue;
        }
        if (!isFiniteNumber(tolerance) || tolerance < 0) {
          errors.push(`items[${index}].tolerance must be a non-negative finite number`);
          continue;
        }
        seenItemIds.add(itemId);
        parsedItems.push({
          itemId,
          mode: "ENTER_VALUE",
          prompt,
          expectedValue,
          tolerance,
          feedback: parseItemFeedback(item?.["feedback"]),
        });
        continue;
      }
      errors.push(`items[${index}].mode must be OPTION_SELECTION or ENTER_VALUE, got: ${String(itemMode)}`);
    }
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true, config: { mode: "ITEM_SET", items: parsedItems } };
  }
  return { valid: false, errors: [`config.mode must be OPTION_SELECTION, ENTER_VALUE, or ITEM_SET, got: ${String(mode)}`] };
}

function parseItemFeedback(raw: unknown): QuickQuestionItemFeedback | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const feedback: QuickQuestionItemFeedback = {};
  if (typeof record["correctFeedbackText"] === "string") {
    feedback.correctFeedbackText = record["correctFeedbackText"];
  }
  if (typeof record["incorrectFeedbackText"] === "string") {
    feedback.incorrectFeedbackText = record["incorrectFeedbackText"];
  }
  if (typeof record["solutionExplanation"] === "string") {
    feedback.solutionExplanation = record["solutionExplanation"];
  }
  if (Array.isArray(record["misconceptions"])) {
    feedback.misconceptions = (record["misconceptions"] as unknown[])
      .map((raw) => raw as Record<string, unknown>)
      .filter((m) => typeof m["code"] === "string" && typeof m["feedbackText"] === "string")
      .map((m) => ({
        matchChoiceId: typeof m["matchChoiceId"] === "string" ? (m["matchChoiceId"] as string) : undefined,
        code: m["code"] as string,
        feedbackText: m["feedbackText"] as string,
      }));
  }
  return feedback;
}

function initState(): QuickQuestionState {
  return { confirmed: false };
}

function currentSetItem(config: QuickQuestionConfig, state: QuickQuestionState): QuickQuestionItemConfig | undefined {
  if (config.mode !== "ITEM_SET") {
    return undefined;
  }
  return config.items[state.currentItemIndex ?? 0];
}

function evaluateItem(
  item: QuickQuestionItemConfig,
  state: Pick<QuickQuestionState, "selectedOptionId" | "enteredValue">,
): { correctness: "CORRECT" | "INCORRECT"; feedbackText: string; misconceptionCode?: string | undefined } {
  if (item.mode === "OPTION_SELECTION") {
    const correct = state.selectedOptionId === item.correctOptionId;
    if (correct) {
      return { correctness: "CORRECT", feedbackText: item.feedback?.correctFeedbackText ?? "" };
    }
    const misconception = item.feedback?.misconceptions?.find((m) => m.matchChoiceId === state.selectedOptionId);
    return {
      correctness: "INCORRECT",
      feedbackText: misconception?.feedbackText ?? item.feedback?.incorrectFeedbackText ?? "",
      misconceptionCode: misconception?.code,
    };
  }
  const correct = state.enteredValue !== undefined && Math.abs(state.enteredValue - item.expectedValue) <= item.tolerance;
  if (correct) {
    return { correctness: "CORRECT", feedbackText: item.feedback?.correctFeedbackText ?? "" };
  }
  return {
    correctness: "INCORRECT",
    feedbackText: item.feedback?.solutionExplanation ?? item.feedback?.incorrectFeedbackText ?? "",
  };
}

function applyAction(
  state: QuickQuestionState,
  config: QuickQuestionConfig,
  action: EngineSemanticAction,
): EngineActionOutcome<QuickQuestionState> {
  if (action.actionType === "RESET_STAGE") {
    return { accepted: true, state: initState() };
  }
  const setItem = currentSetItem(config, state);
  if (action.actionType === "SELECT_OPTION") {
    const optionSelectionConfig = config.mode === "OPTION_SELECTION" ? config : setItem?.mode === "OPTION_SELECTION" ? setItem : undefined;
    if (!optionSelectionConfig) {
      return { accepted: false, state, reason: "SELECT_OPTION is not valid for the current mode/item" };
    }
    if (action.targetRole !== "option") {
      return { accepted: false, state, reason: "SELECT_OPTION requires targetRole option" };
    }
    const optionId = action.payload["optionId"];
    if (typeof optionId !== "string" || !optionSelectionConfig.options.some((option) => option.optionId === optionId)) {
      return { accepted: false, state, reason: "unknown optionId" };
    }
    return { accepted: true, state: { ...state, selectedOptionId: optionId, confirmed: false } };
  }
  if (action.actionType === "ENTER_VALUE") {
    const enterValueConfig = config.mode === "ENTER_VALUE" ? config : setItem?.mode === "ENTER_VALUE" ? setItem : undefined;
    if (!enterValueConfig) {
      return { accepted: false, state, reason: "ENTER_VALUE is not valid for the current mode/item" };
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
    if (config.mode === "ITEM_SET") {
      if (!setItem) {
        return { accepted: false, state, reason: "no current item" };
      }
      const hasAnswer = setItem.mode === "OPTION_SELECTION" ? state.selectedOptionId !== undefined : state.enteredValue !== undefined;
      if (!hasAnswer) {
        return { accepted: false, state, reason: "nothing to confirm" };
      }
      const result = evaluateItem(setItem, state);
      const itemResults = [...(state.itemResults ?? []), { itemId: setItem.itemId, ...result }];
      const nextIndex = (state.currentItemIndex ?? 0) + 1;
      const setComplete = nextIndex >= config.items.length;
      return {
        accepted: true,
        state: {
          selectedOptionId: undefined,
          enteredValue: undefined,
          confirmed: setComplete,
          currentItemIndex: nextIndex,
          itemResults,
        },
      };
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
  if (config.mode === "ITEM_SET") {
    const itemResults = state.itemResults ?? [];
    if (!state.confirmed || itemResults.length < config.items.length) {
      return { evaluated: false, reason: "SET_IN_PROGRESS" };
    }
    const correctCount = itemResults.filter((r) => r.correctness === "CORRECT").length;
    const allCorrect = correctCount === config.items.length;
    return {
      evaluated: true,
      correctness: allCorrect ? "CORRECT" : "INCORRECT",
      score: allCorrect ? 1 : 0,
      evidence: { mode: "ITEM_SET", itemResults, correctCount, totalItems: config.items.length },
    };
  }
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
