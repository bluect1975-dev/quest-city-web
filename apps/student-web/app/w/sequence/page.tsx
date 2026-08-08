import { SequenceHost } from "../../../components/engine-host/SequenceHost";
import { DEMO_SEQUENCE_DEFINITION } from "../../../lib/sequence-demo";

/**
 * `/w/sequence` (R3C.2 §16). Demonstration multi-stage sequence, driven by
 * the Stage/Session Orchestrator (`@quest-city-web/content-runtime`), not
 * the real M06 vertical slice — same posture as `/w/engine` for the single
 * P0 engines (R3C.1 §43).
 */
export default function SequenceHostPage() {
  return <SequenceHost definition={DEMO_SEQUENCE_DEFINITION} runtimeStateId="demo-sequence-runtime-state" />;
}
