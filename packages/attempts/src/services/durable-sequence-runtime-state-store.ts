import type { SequenceRuntimeState, SequenceRuntimeStateStore } from "@quest-city-web/content-runtime";
import { SequenceRuntimeStateRepository } from "../repository/sequence-runtime-state-repository";

/** Thrown by `save()` when the in-instance `expectedVersion` no longer matches the stored row (another request updated it first). The caller re-fetches (`get`) and reconciles rather than retrying blindly. */
export class SequenceRuntimeStateVersionConflictError extends Error {
  constructor() {
    super("sequence_runtime_state: version conflict on save — reload the current state and reconcile before retrying");
    this.name = "SequenceRuntimeStateVersionConflictError";
  }
}

/**
 * `SequenceRuntimeStateStore` (`@quest-city-web/content-runtime`) backed
 * by `sequence_runtime_state` (R3C.3 migration 0005). One instance is
 * constructed per request, bound to the (tenantId, studentProfileId,
 * enrollmentId, sequenceId) already resolved server-side from the
 * session — never from a client-supplied value — so ownership is
 * structurally enforced regardless of what `runtimeStateId` a caller
 * passes to `get`/carries in `state`.
 *
 * The generic interface's `get(runtimeStateId)`/`save(state)` signatures
 * carry no version parameter; this adapter tracks the version returned by
 * its own last `get`/`save` internally (safe exactly because one instance
 * lives for the span of one request's read-then-write, never shared
 * across requests) and uses it as `expectedVersion` on the next `save` —
 * `save` before any successful `get` is treated as "no row yet" and goes
 * through `create` instead of `save`.
 */
export class DurableSequenceRuntimeStateStore implements SequenceRuntimeStateStore {
  private lastKnownVersion: number | undefined;

  constructor(
    private readonly repository: SequenceRuntimeStateRepository,
    private readonly tenantId: string,
    private readonly studentProfileId: string,
    private readonly enrollmentId: string,
    private readonly sequenceId: string,
  ) {}

  async get(runtimeStateId: string): Promise<SequenceRuntimeState | undefined> {
    const persisted = await this.repository.findByStudentAndSequence(this.tenantId, this.studentProfileId, this.sequenceId);
    if (!persisted) {
      return undefined;
    }
    if (persisted.state.runtimeStateId !== runtimeStateId) {
      throw new Error(
        `DurableSequenceRuntimeStateStore.get: stored runtimeStateId "${persisted.state.runtimeStateId}" does not match ` +
          `requested "${runtimeStateId}" for this student/sequence — ownership is resolved by (tenant, student, sequence), ` +
          "never by runtimeStateId alone.",
      );
    }
    this.lastKnownVersion = persisted.version;
    return persisted.state;
  }

  async save(state: SequenceRuntimeState): Promise<void> {
    if (this.lastKnownVersion === undefined) {
      const created = await this.repository.create({
        tenantId: this.tenantId,
        studentProfileId: this.studentProfileId,
        enrollmentId: this.enrollmentId,
        state,
      });
      this.lastKnownVersion = created.version;
      return;
    }
    const saved = await this.repository.save(this.tenantId, this.studentProfileId, this.sequenceId, this.lastKnownVersion, state);
    if (!saved) {
      throw new SequenceRuntimeStateVersionConflictError();
    }
    this.lastKnownVersion = saved.version;
  }
}
