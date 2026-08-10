import FullSequenceHost from "../../../components/engine-host/FullSequenceHost";

/**
 * `/w/full-sequence` (M06 Web Full Vertical Slice Tranche 6, `07_26 v1.1`
 * §17.4): the single unified 8-canonical-stage M06 experience — no
 * `:activityId`/assignment param, unlike `/w/activity/:activityId`, since
 * the outer orchestration state is keyed by a fixed `sequenceId`
 * (`WEB_TRANCHE6_FULL_SEQUENCE_ID`) and each underlying interactive stage's
 * attempt is resolved internally by `FullSequenceHost` as the sequence
 * progresses, not from a single route-level assignment.
 */
export default function FullSequencePage() {
  return <FullSequenceHost />;
}
