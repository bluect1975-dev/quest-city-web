/**
 * R3C.1 — runtime engine contract. Distinct from `EngineRegistryEntry`
 * (types.ts), which is governance/publication metadata only. Nothing in
 * R3A/R3B prescribed a render/evaluate/mount contract for an actual
 * executable engine — this interface is new, designed to be the minimum
 * shape all three P0 engines (and future engines) can share: config
 * validation, state initialization, a semantic-action reducer, and a
 * deterministic evaluator. The same reducer is meant to be reusable by a
 * client UI (to build local state) and by the server (to replay the
 * persisted action log) — so evaluation is always a pure function of state
 * that both sides can derive identically.
 */
import type { AxisAValue, SemanticAction } from "./types";

/** Structural subset of `SemanticActionLogEntry` (packages/attempts) — this
 * package never imports from `attempts` (dependency points the other way),
 * so engines depend only on the fields they actually read. */
export interface EngineSemanticAction {
  actionType: SemanticAction;
  targetRole: string | null;
  payload: Record<string, unknown>;
}

export type ConfigValidationResult<TConfig> =
  | { valid: true; config: TConfig }
  | { valid: false; errors: string[] };

export interface EngineActionOutcome<TState> {
  accepted: boolean;
  state: TState;
  reason?: string;
}

export type EngineEvaluationResult =
  | {
      evaluated: true;
      correctness: "CORRECT" | "INCORRECT";
      score: 0 | 1;
      evidence: Record<string, unknown>;
    }
  | { evaluated: false; reason: string };

/**
 * A production engine implementation. `TConfig`/`TState` are engine-owned —
 * the runtime never inspects their shape directly, only through the
 * methods below.
 */
export interface EngineDefinition<TConfig = unknown, TState = unknown> {
  readonly canonicalEngineId: string;
  readonly runtimeAdapterId: string;
  readonly engineVersion: string;
  readonly capabilities: { required: AxisAValue[]; optional: AxisAValue[] };
  readonly semanticActions: SemanticAction[];

  validateConfig(config: unknown): ConfigValidationResult<TConfig>;
  initState(config: TConfig): TState;
  applyAction(state: TState, config: TConfig, action: EngineSemanticAction): EngineActionOutcome<TState>;
  evaluate(state: TState, config: TConfig): EngineEvaluationResult;
}

export interface ReplayResult<TState> {
  state: TState;
  acceptedCount: number;
  rejectedCount: number;
  rejections: Array<{ index: number; reason: string }>;
}

/**
 * Folds a full action log through `engine.applyAction`, starting from
 * `initState`. Shared by all engines (and by the server-side dispatcher) so
 * "replay the log deterministically" is implemented exactly once. A
 * rejected action never mutates state — it is skipped, not fatal — so one
 * malformed entry in an otherwise-valid log cannot corrupt the final
 * evaluation of the entries that _were_ well-formed.
 */
export function replayActions<TConfig, TState>(
  engine: EngineDefinition<TConfig, TState>,
  config: TConfig,
  actions: EngineSemanticAction[],
): ReplayResult<TState> {
  let state = engine.initState(config);
  let acceptedCount = 0;
  const rejections: Array<{ index: number; reason: string }> = [];
  actions.forEach((action, index) => {
    const outcome = engine.applyAction(state, config, action);
    if (outcome.accepted) {
      state = outcome.state;
      acceptedCount += 1;
    } else {
      rejections.push({ index, reason: outcome.reason ?? "REJECTED" });
    }
  });
  return { state, acceptedCount, rejectedCount: rejections.length, rejections };
}
