import type {
  ConfigValidationResult,
  EngineActionOutcome,
  EngineDefinition,
  EngineEvaluationResult,
  EngineSemanticAction,
} from "../engine-runtime";
import type { EngineRegistryEntry } from "../types";

/**
 * BalanceMachineEngine (`canonicalEngineId: ENG-BALANCE`, `07_10 §13`,
 * `runtimeAdapterId: QC-WEB-ENGINE-BALANCE-MACHINE` formalized in
 * `02_36 v1.1 §17` / `07_10 v1.3 §13`, ratified in R3C.0A). Pedagogical
 * model preserved from the fixture validator (`balance-machine-validator.ts`):
 * bilateral equivalence, two sides of a scale, weighted tokens, placement +
 * confirmation. Distinct from DragAndDropEngine — this is not a generic
 * classification/association engine, it models a scale with a
 * correctness condition defined by weight equality.
 *
 * Difference from the fixture-era validator: token weight is declared in
 * `BalanceMachineConfig` (server/content-owned), not read from the
 * client-submitted `PLACE_ITEM` payload. The old validator trusted a
 * client-supplied `weight` field, which let a client self-report the value
 * it was being scored on — closing that gap is a direct consequence of
 * generalizing the validator into a real, config-driven engine, not an
 * unrelated scope addition.
 */

export const BALANCE_MACHINE_CANONICAL_ENGINE_ID = "ENG-BALANCE";
export const BALANCE_MACHINE_RUNTIME_ADAPTER_ID = "QC-WEB-ENGINE-BALANCE-MACHINE";
export const BALANCE_MACHINE_ENGINE_VERSION = "1.0.0";

export interface BalanceMachineToken {
  tokenId: string;
  weight: number;
}

export interface BalanceMachineConfig {
  tokens: BalanceMachineToken[];
}

export interface BalanceMachineState {
  placements: Record<string, "left" | "right">;
  confirmed: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateBalanceMachineConfig(config: unknown): ConfigValidationResult<BalanceMachineConfig> {
  const errors: string[] = [];
  if (typeof config !== "object" || config === null) {
    return { valid: false, errors: ["config must be an object"] };
  }
  const tokens = (config as Record<string, unknown>)["tokens"];
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { valid: false, errors: ["config.tokens must be a non-empty array"] };
  }
  const parsedTokens: BalanceMachineToken[] = [];
  const seenIds = new Set<string>();
  for (const [index, raw] of tokens.entries()) {
    if (typeof raw !== "object" || raw === null) {
      errors.push(`tokens[${index}] must be an object`);
      continue;
    }
    const tokenId = (raw as Record<string, unknown>)["tokenId"];
    const weight = (raw as Record<string, unknown>)["weight"];
    if (typeof tokenId !== "string" || tokenId.length === 0) {
      errors.push(`tokens[${index}].tokenId must be a non-empty string`);
      continue;
    }
    if (seenIds.has(tokenId)) {
      errors.push(`tokens[${index}].tokenId is duplicated: ${tokenId}`);
      continue;
    }
    if (!isFiniteNumber(weight) || weight <= 0) {
      errors.push(`tokens[${index}].weight must be a positive finite number`);
      continue;
    }
    seenIds.add(tokenId);
    parsedTokens.push({ tokenId, weight });
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, config: { tokens: parsedTokens } };
}

function initState(): BalanceMachineState {
  return { placements: {}, confirmed: false };
}

function applyAction(
  state: BalanceMachineState,
  config: BalanceMachineConfig,
  action: EngineSemanticAction,
): EngineActionOutcome<BalanceMachineState> {
  if (action.actionType === "RESET_STAGE") {
    return { accepted: true, state: initState() };
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
  if (action.actionType === "PLACE_ITEM") {
    if (action.targetRole !== "weight-token") {
      return { accepted: false, state, reason: "PLACE_ITEM requires targetRole weight-token" };
    }
    const tokenId = action.payload["tokenId"];
    const side = action.payload["side"];
    if (typeof tokenId !== "string" || (side !== "left" && side !== "right")) {
      return { accepted: false, state, reason: "malformed PLACE_ITEM payload" };
    }
    if (!config.tokens.some((token) => token.tokenId === tokenId)) {
      return { accepted: false, state, reason: `unknown tokenId: ${tokenId}` };
    }
    return {
      accepted: true,
      state: { placements: { ...state.placements, [tokenId]: side }, confirmed: false },
    };
  }
  return { accepted: false, state, reason: `unsupported actionType for ENG-BALANCE: ${action.actionType}` };
}

function evaluate(state: BalanceMachineState, config: BalanceMachineConfig): EngineEvaluationResult {
  if (!state.confirmed) {
    return { evaluated: false, reason: "NOT_CONFIRMED" };
  }
  const placedTokenIds = Object.keys(state.placements);
  if (placedTokenIds.length === 0) {
    return { evaluated: false, reason: "NO_PLACEMENTS" };
  }
  let leftWeight = 0;
  let rightWeight = 0;
  for (const tokenId of placedTokenIds) {
    const token = config.tokens.find((candidate) => candidate.tokenId === tokenId);
    if (!token) {
      // A token present in state but absent from config is only reachable
      // if config changed between placement and evaluation — never invent
      // a score against a configuration that does not match the state.
      return { evaluated: false, reason: `placed token not present in config: ${tokenId}` };
    }
    if (state.placements[tokenId] === "left") {
      leftWeight += token.weight;
    } else {
      rightWeight += token.weight;
    }
  }
  const balanced = leftWeight === rightWeight;
  return {
    evaluated: true,
    correctness: balanced ? "CORRECT" : "INCORRECT",
    score: balanced ? 1 : 0,
    evidence: { leftWeight, rightWeight, placements: state.placements },
  };
}

export function createBalanceMachineEngine(): EngineDefinition<BalanceMachineConfig, BalanceMachineState> {
  return {
    canonicalEngineId: BALANCE_MACHINE_CANONICAL_ENGINE_ID,
    runtimeAdapterId: BALANCE_MACHINE_RUNTIME_ADAPTER_ID,
    engineVersion: BALANCE_MACHINE_ENGINE_VERSION,
    capabilities: { required: ["OBJECT_MANIPULATION_2D"], optional: [] },
    semanticActions: ["PLACE_ITEM", "RESET_STAGE", "CONFIRM_SOLUTION"],
    validateConfig: validateBalanceMachineConfig,
    initState,
    applyAction,
    evaluate,
  };
}

export function buildBalanceMachineRegistryEntry(): EngineRegistryEntry {
  return {
    canonicalEngineId: BALANCE_MACHINE_CANONICAL_ENGINE_ID,
    version: BALANCE_MACHINE_ENGINE_VERSION,
    // Registry Update Gate (R3C.1 §65) fully PASS: implementation, identity,
    // config schema, state model, validator, semantic actions,
    // capabilities, accessibility, scoring/evidence, unit tests (22),
    // integration tests (real Postgres attempt-dispatch), responsive,
    // registry entry schema validity — see r3c1_report for the full matrix.
    lifecycleStatus: "ACTIVE",
    capabilities: { required: ["OBJECT_MANIPULATION_2D"], optional: [] },
    semanticActions: ["PLACE_ITEM", "RESET_STAGE", "CONFIRM_SOLUTION"],
    configurationSchemaRef: "balance-machine-config.schema.json@1.0.0",
    validatorRequirements: [{ description: "deterministic-weight-equality" }],
    accessibilityRequirements: [
      { fallback: "select-token-then-select-side" },
      { requirement: "focus-order" },
      { requirement: "reducedMotion" },
    ],
    persistenceRequirements: {},
    scoringEvidenceRequirements: { binaryCorrectness: true, partialCredit: false },
    themeAdapterRef: "QC-THEME-CORE",
    runtimeAdapters: [{ runtimeChannel: "WEB", runtimeAdapterId: BALANCE_MACHINE_RUNTIME_ADAPTER_ID }],
    publicationRequirements: { minLifecycleStatus: "ACTIVE", requiresRealTestsPass: true },
    provenance: {
      sourceDocument: "07_10",
      sourceDocumentVersion: "1.3",
      registeredAtRegistryVersion: "R3C.1",
    },
  };
}
