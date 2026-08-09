/**
 * R3C.2 attempt integration (phase instruction section 12): every
 * interactive stage a `SequenceRuntimeState` tracks continues to use the
 * existing WEB-M2 `LearningAttempt` lifecycle
 * (`LearningAttemptRepository`) completely unchanged — this module adds
 * exactly one thing: recording the `{stageId, attemptId}` pointer on the
 * orchestration-layer state via `@quest-city-web/content-runtime`'s
 * `addAttemptReference`. It never reads or writes `attemptState`/
 * `completionStatus`, never creates a second attempt table, and never
 * introduces a parallel lifecycle — the full `LearningAttempt` stays the
 * sole authority on its own status.
 */
import { addAttemptReference, type SequenceRuntimeState } from "@quest-city-web/content-runtime";
import type { LearningAttempt } from "../repository/learning-attempt-repository";

/**
 * Records that `attempt` (already created/managed through the ordinary
 * WEB-M2 attempt flow) belongs to `stageId` in this sequence run. Reads
 * only `attempt.id` — deliberately narrow, so it is structurally
 * impossible for this function to leak `attemptState`/`completionStatus`
 * into `SequenceRuntimeState`.
 */
export function recordStageAttempt(
  state: SequenceRuntimeState,
  stageId: string,
  attempt: Pick<LearningAttempt, "id">,
): SequenceRuntimeState {
  return addAttemptReference(state, stageId, attempt.id);
}
