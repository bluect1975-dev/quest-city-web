/**
 * `contentId -> SequenceDefinition` resolution for the orchestration-layer
 * `CREATED -> IN_PROGRESS` trigger (`07_15_01 v1.3` §11-bis.2-bis, `02_36
 * v1.4` §20-bis.12). Mirrors `engine-dispatch-resolution.ts`'s established
 * pattern (a small static registry keyed by the same `content_bundle_id`
 * `learning_attempt.content_id` already carries) rather than introducing a
 * new lookup mechanism.
 *
 * A `learning_attempt` is eligible for this trigger if and only if EVERY
 * stage of its content bundle's `SequenceDefinition` is `isInteractive:
 * false` with no `engineDispatchRef` (07_15_01 §11-bis.2-bis's mutual-
 * exclusion clause) — this sidesteps trusting a client-declared `stageId`
 * entirely: a non-interactive sub-stage of a mixed sequence never gets its
 * own `learning_attempt` (see `engine-dispatch-resolution.ts`'s comments on
 * `REFLECTION_AND_RESULT`/`MICRO_LESSON`), so an attempt's content bundle
 * either backs a wholly-presentational sequence (safe for this trigger) or
 * backs the sequence containing the interactive stage the attempt was
 * actually created for (never safe for this trigger).
 */
import {
  WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION,
  WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE6_REFLECTION_SEQUENCE_DEFINITION,
  type SequenceDefinition,
} from "@quest-city-web/content-runtime";

const KNOWN_NON_INTERACTIVE_SEQUENCES: Record<string, SequenceDefinition> = {
  // M06 Web Full Vertical Slice Tranche 5 (07_26 v1.1 §17.2): INTRO_HOOK is
  // a single-stage, non-interactive, engine-less sequence that is the
  // entire assignment.
  [WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID]: WEB_TRANCHE5_INTRO_HOOK_SEQUENCE_DEFINITION,
  // M06 Web Full Vertical Slice Tranche 6 (07_26 v1.1 §17.4): the Full M06
  // Sequence's standalone REFLECTION_AND_RESULT group — same rationale as
  // INTRO_HOOK above (a wholly non-interactive, engine-less, single-stage
  // content bundle needs this trigger to leave CREATED at all).
  [WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID]: WEB_TRANCHE6_REFLECTION_SEQUENCE_DEFINITION,
};

/**
 * `true` only if `contentId` is a known content bundle AND every one of its
 * stages is `isInteractive: false` with no `engineDispatchRef`. `false` for
 * an unknown content bundle or any bundle containing even one interactive/
 * engine-dispatched stage — never a partial match on "the current stage
 * happens to be non-interactive" (07_15_01 §11-bis.2-bis's mutual exclusion
 * with the semantic-action trigger applies per attempt, and a multi-stage
 * sequence's non-interactive sub-stages never receive their own attempt).
 */
export function isWhollyNonInteractiveContentBundle(contentId: string): boolean {
  const definition = KNOWN_NON_INTERACTIVE_SEQUENCES[contentId];
  if (!definition) return false;
  return definition.stages.every((stage) => !stage.isInteractive && !stage.engineDispatchRef);
}
