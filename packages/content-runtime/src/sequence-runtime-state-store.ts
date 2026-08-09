/**
 * Persistence decision (R3C.2, phase instruction section 13): this
 * interface is the deliberately minimal, persistence-agnostic seam —
 * sufficient to initialize, drive and test the full M06 8-stage runtime
 * layer end to end (see `stage-orchestrator.test.ts`) without coupling
 * `content-runtime` itself to any storage technology. The canonical
 * contract (`schemas/vendor/r3c2/stage-orchestration-contract.schema.json`,
 * `SequenceRuntimeState.runtimeStateId` description) deliberately leaves
 * persistence ownership out of scope — `runtimeStateId` is an opaque
 * identifier, not a foreign key into any particular store.
 *
 * `InMemorySequenceRuntimeStateStore` remains the reference/test
 * implementation. R3C.3 added the real, durable implementation —
 * `DurableSequenceRuntimeStateStore` (`@quest-city-web/attempts`),
 * backed by the `sequence_runtime_state` table (migration 0005) via
 * `SequenceRuntimeStateRepository`, mirroring
 * `LearningAttemptRepository`'s constructor-injected `Queryable`
 * pattern — deliberately NOT placed in this package, which stays
 * persistence-agnostic by design (no `pg` dependency here); `attempts`
 * already depends on both `content-runtime` and `pg` and already hosts
 * every other bespoke repository in this codebase.
 */
import type { SequenceRuntimeState } from "./stage-orchestration-types";

export interface SequenceRuntimeStateStore {
  get(runtimeStateId: string): Promise<SequenceRuntimeState | undefined>;
  save(state: SequenceRuntimeState): Promise<void>;
}

export class InMemorySequenceRuntimeStateStore implements SequenceRuntimeStateStore {
  private readonly states = new Map<string, SequenceRuntimeState>();

  async get(runtimeStateId: string): Promise<SequenceRuntimeState | undefined> {
    return this.states.get(runtimeStateId);
  }

  async save(state: SequenceRuntimeState): Promise<void> {
    this.states.set(state.runtimeStateId, state);
  }
}
