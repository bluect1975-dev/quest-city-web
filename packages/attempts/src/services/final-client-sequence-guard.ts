import type { SemanticActionLogEntry } from "../repository/semantic-action-log-repository";

export type FinalClientSequenceCheckResult = { ok: true } | { ok: false; reason: "MISSING_ACTION" };

/**
 * `CompleteAttemptRequest.finalClientSequence` (02_26 v1.6 §18.5, OpenAPI
 * v1.4): "used server-side to verify no in-flight action is missing before
 * consolidating." A client claiming a higher `clientSequence` than what the
 * server has actually persisted means an action is still in flight — the
 * attempt must not be consolidated on an incomplete action log. The one
 * function the `complete` route and its tests both call — never duplicated.
 */
export function checkFinalClientSequence(
  finalClientSequence: number | null | undefined,
  actions: SemanticActionLogEntry[],
): FinalClientSequenceCheckResult {
  if (typeof finalClientSequence !== "number") {
    return { ok: true }; // optional field — no claim made, nothing to verify
  }
  const maxPersistedSequence = actions.reduce((max, action) => Math.max(max, action.clientSequence), -1);
  if (finalClientSequence > maxPersistedSequence) {
    return { ok: false, reason: "MISSING_ACTION" };
  }
  return { ok: true };
}
