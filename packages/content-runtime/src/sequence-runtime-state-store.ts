/**
 * Persistence decision (R3C.2, phase instruction section 13): this repo
 * has no generic persistence abstraction to reuse — every existing table
 * (`packages/attempts/src/repository/*`) is a bespoke, hand-written-SQL
 * repository over a specific `learning_attempt`-family table, by design
 * (no shared base-repository class). The canonical contract itself
 * (`schemas/vendor/r3c2/stage-orchestration-contract.schema.json`,
 * `SequenceRuntimeState.runtimeStateId` description) deliberately leaves
 * persistence ownership out of scope — `runtimeStateId` is an opaque
 * identifier, not a foreign key into any particular store.
 *
 * A real production `learning_sequence_runtime_state` table (its own
 * migration, its own bespoke repository, mirroring
 * `LearningAttemptRepository`'s constructor-injected `Queryable` pattern)
 * is a genuine new-storage decision this phase does not have standing
 * authority to make unilaterally — no existing Web document assigns
 * sequence-runtime persistence to a specific table/service. Per the phase
 * instruction, this interface is the deliberately minimal,
 * persistence-agnostic seam: sufficient to initialize, drive and test the
 * full M06 8-stage runtime layer end to end (see
 * `stage-orchestrator.test.ts`) and to back the Engine Host sequence UI
 * for a demo/browser session, without fabricating a durability guarantee
 * this phase never built or tested against real Postgres.
 *
 * `InMemorySequenceRuntimeStateStore` is the only implementation this
 * phase ships. A real persistent implementation (Postgres-backed,
 * analogous to `LearningAttemptRepository`) is future work, to be
 * authorized and scoped as its own phase once a Web document assigns it a
 * concrete storage decision.
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
