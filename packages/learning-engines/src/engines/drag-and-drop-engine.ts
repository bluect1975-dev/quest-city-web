import type {
  ConfigValidationResult,
  EngineActionOutcome,
  EngineDefinition,
  EngineEvaluationResult,
  EngineSemanticAction,
} from "../engine-runtime";
import type { EngineRegistryEntry } from "../types";

/**
 * DragAndDropEngine (`canonicalEngineId: ENG-DRAG`, `07_10 §4`,
 * `runtimeAdapterId: QC-WEB-ENGINE-DRAG-DROP`, published originally in
 * `07_10` v1.0). Generic classification/association/positioning engine —
 * config declares items, targets, and the correct item→target mapping.
 * Deliberately holds no Balance Machine-specific semantics (weight, sides,
 * equivalence): that model lives entirely in BalanceMachineEngine, a
 * distinct engine under a distinct canonicalEngineId.
 *
 * The engine model is input-modality-agnostic: PLACE_ITEM/MOVE_ITEM
 * represent "item X now maps to target Y" regardless of whether the UI
 * layer produced that action via pointer drag or via the mandatory
 * keyboard fallback (select source -> select destination -> confirm/place,
 * instruction §31) — both paths dispatch the same semantic action.
 */

export const DRAG_AND_DROP_CANONICAL_ENGINE_ID = "ENG-DRAG";
export const DRAG_AND_DROP_RUNTIME_ADAPTER_ID = "QC-WEB-ENGINE-DRAG-DROP";
export const DRAG_AND_DROP_ENGINE_VERSION = "1.0.0";

export interface DragDropItem {
  itemId: string;
}

export interface DragDropTarget {
  targetId: string;
}

export interface DragDropMapping {
  itemId: string;
  targetId: string;
}

export interface DragDropConfig {
  items: DragDropItem[];
  targets: DragDropTarget[];
  correctMapping: DragDropMapping[];
}

export interface DragDropState {
  placements: Record<string, string>;
  confirmed: boolean;
}

export function validateDragDropConfig(config: unknown): ConfigValidationResult<DragDropConfig> {
  if (typeof config !== "object" || config === null) {
    return { valid: false, errors: ["config must be an object"] };
  }
  const record = config as Record<string, unknown>;
  const errors: string[] = [];

  const items = record["items"];
  const itemIds = new Set<string>();
  if (!Array.isArray(items) || items.length === 0) {
    errors.push("config.items must be a non-empty array");
  } else {
    for (const [index, raw] of items.entries()) {
      const itemId = (raw as Record<string, unknown> | null)?.["itemId"];
      if (typeof itemId !== "string" || itemId.length === 0) {
        errors.push(`items[${index}].itemId must be a non-empty string`);
        continue;
      }
      if (itemIds.has(itemId)) {
        errors.push(`items[${index}].itemId is duplicated: ${itemId}`);
        continue;
      }
      itemIds.add(itemId);
    }
  }

  const targets = record["targets"];
  const targetIds = new Set<string>();
  if (!Array.isArray(targets) || targets.length === 0) {
    errors.push("config.targets must be a non-empty array");
  } else {
    for (const [index, raw] of targets.entries()) {
      const targetId = (raw as Record<string, unknown> | null)?.["targetId"];
      if (typeof targetId !== "string" || targetId.length === 0) {
        errors.push(`targets[${index}].targetId must be a non-empty string`);
        continue;
      }
      if (targetIds.has(targetId)) {
        errors.push(`targets[${index}].targetId is duplicated: ${targetId}`);
        continue;
      }
      targetIds.add(targetId);
    }
  }

  const correctMapping = record["correctMapping"];
  const parsedMapping: DragDropMapping[] = [];
  if (!Array.isArray(correctMapping) || correctMapping.length === 0) {
    errors.push("config.correctMapping must be a non-empty array");
  } else if (errors.length === 0) {
    for (const [index, raw] of correctMapping.entries()) {
      const itemId = (raw as Record<string, unknown> | null)?.["itemId"];
      const targetId = (raw as Record<string, unknown> | null)?.["targetId"];
      if (typeof itemId !== "string" || !itemIds.has(itemId)) {
        errors.push(`correctMapping[${index}].itemId must reference a declared item`);
        continue;
      }
      if (typeof targetId !== "string" || !targetIds.has(targetId)) {
        errors.push(`correctMapping[${index}].targetId must reference a declared target`);
        continue;
      }
      parsedMapping.push({ itemId, targetId });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    config: {
      items: items as DragDropItem[],
      targets: targets as DragDropTarget[],
      correctMapping: parsedMapping,
    },
  };
}

function initState(): DragDropState {
  return { placements: {}, confirmed: false };
}

function applyAction(
  state: DragDropState,
  config: DragDropConfig,
  action: EngineSemanticAction,
): EngineActionOutcome<DragDropState> {
  if (action.actionType === "RESET_STAGE") {
    return { accepted: true, state: initState() };
  }
  if (action.actionType === "PLACE_ITEM" || action.actionType === "MOVE_ITEM") {
    if (action.targetRole !== "drop-target") {
      return { accepted: false, state, reason: `${action.actionType} requires targetRole drop-target` };
    }
    const itemId = action.payload["itemId"];
    const targetId = action.payload["targetId"];
    if (typeof itemId !== "string" || typeof targetId !== "string") {
      return { accepted: false, state, reason: "malformed payload — itemId/targetId must be strings" };
    }
    if (!config.items.some((item) => item.itemId === itemId)) {
      return { accepted: false, state, reason: `unknown itemId: ${itemId}` };
    }
    if (!config.targets.some((target) => target.targetId === targetId)) {
      return { accepted: false, state, reason: `unknown targetId: ${targetId}` };
    }
    return {
      accepted: true,
      state: { placements: { ...state.placements, [itemId]: targetId }, confirmed: false },
    };
  }
  if (action.actionType === "CONFIRM_SOLUTION") {
    if (action.targetRole !== "confirm-button") {
      return { accepted: false, state, reason: "CONFIRM_SOLUTION requires targetRole confirm-button" };
    }
    if (Object.keys(state.placements).length === 0) {
      return { accepted: false, state, reason: "cannot confirm with no placements" };
    }
    return { accepted: true, state: { ...state, confirmed: true } };
  }
  return { accepted: false, state, reason: `unsupported actionType for ENG-DRAG: ${action.actionType}` };
}

function evaluate(state: DragDropState, config: DragDropConfig): EngineEvaluationResult {
  if (!state.confirmed) {
    return { evaluated: false, reason: "NOT_CONFIRMED" };
  }
  if (Object.keys(state.placements).length === 0) {
    return { evaluated: false, reason: "NO_PLACEMENTS" };
  }
  const correct = config.correctMapping.every((mapping) => state.placements[mapping.itemId] === mapping.targetId);
  return {
    evaluated: true,
    correctness: correct ? "CORRECT" : "INCORRECT",
    score: correct ? 1 : 0,
    evidence: { placements: state.placements },
  };
}

export function createDragAndDropEngine(): EngineDefinition<DragDropConfig, DragDropState> {
  return {
    canonicalEngineId: DRAG_AND_DROP_CANONICAL_ENGINE_ID,
    runtimeAdapterId: DRAG_AND_DROP_RUNTIME_ADAPTER_ID,
    engineVersion: DRAG_AND_DROP_ENGINE_VERSION,
    capabilities: { required: ["DRAG_DROP"], optional: [] },
    semanticActions: ["PLACE_ITEM", "MOVE_ITEM", "CONFIRM_SOLUTION", "RESET_STAGE"],
    validateConfig: validateDragDropConfig,
    initState,
    applyAction,
    evaluate,
  };
}

export function buildDragAndDropRegistryEntry(): EngineRegistryEntry {
  return {
    canonicalEngineId: DRAG_AND_DROP_CANONICAL_ENGINE_ID,
    version: DRAG_AND_DROP_ENGINE_VERSION,
    // Registry Update Gate (R3C.1 §65) fully PASS: implementation, identity,
    // config schema, state model, validator, semantic actions,
    // capabilities, accessibility, scoring/evidence, unit tests (18),
    // integration tests (Support Evaluator + schema, real dispatch path
    // shared with Balance and proven via real Postgres), responsive,
    // registry entry schema validity — see r3c1_report for the full matrix.
    lifecycleStatus: "ACTIVE",
    capabilities: { required: ["DRAG_DROP"], optional: [] },
    semanticActions: ["PLACE_ITEM", "MOVE_ITEM", "CONFIRM_SOLUTION", "RESET_STAGE"],
    configurationSchemaRef: "drag-drop-config.schema.json@1.0.0",
    validatorRequirements: [{ description: "deterministic-exact-mapping-match" }],
    accessibilityRequirements: [
      { fallback: "keyboard-select-source-destination" },
      { requirement: "focus-order" },
      { requirement: "touch-compatible" },
    ],
    persistenceRequirements: {},
    scoringEvidenceRequirements: { binaryCorrectness: true, partialCredit: false },
    themeAdapterRef: "QC-THEME-CORE",
    runtimeAdapters: [{ runtimeChannel: "WEB", runtimeAdapterId: DRAG_AND_DROP_RUNTIME_ADAPTER_ID }],
    publicationRequirements: { minLifecycleStatus: "ACTIVE", requiresRealTestsPass: true },
    provenance: {
      sourceDocument: "07_10",
      sourceDocumentVersion: "1.3",
      registeredAtRegistryVersion: "R3C.1",
    },
  };
}
