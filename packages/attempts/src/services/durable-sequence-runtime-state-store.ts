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
 * by `sequence_runtime_state` (R3C.3 migration 0005; re-scoped to
 * per-attempt ownership by migration 0019 — UAT Failure Remediation,
 * `UAT-RC4-NEW-ASSIGNMENT-LAUNCH-STATE-01`: two independent attempts
 * against the same `sequenceId` — e.g. two separate assignments over the
 * same content bundle — must never share progress/completion state). One
 * instance is constructed per request, bound to the (tenantId,
 * studentProfileId, enrollmentId, learningAttemptId) already resolved
 * server-side from the session and the real attempt row — never from a
 * client-supplied value — so ownership is structurally enforced
 * regardless of what `runtimeStateId` a caller passes to `get`/carries in
 * `state`.
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
    private readonly learningAttemptId: string,
  ) {}

  async get(runtimeStateId: string): Promise<SequenceRuntimeState | undefined> {
    const persisted = await this.repository.findByAttempt(this.tenantId, this.learningAttemptId);
    if (!persisted) {
      return undefined;
    }
    if (persisted.state.runtimeStateId !== runtimeStateId) {
      throw new Error(
        `DurableSequenceRuntimeStateStore.get: stored runtimeStateId "${persisted.state.runtimeStateId}" does not match ` +
          `requested "${runtimeStateId}" for this attempt — ownership is resolved by (tenant, attempt), never by ` +
          "runtimeStateId alone.",
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
        learningAttemptId: this.learningAttemptId,
        state,
      });
      this.lastKnownVersion = created.version;
      return;
    }
    const saved = await this.repository.save(this.tenantId, this.learningAttemptId, this.lastKnownVersion, state);
    if (!saved) {
      throw new SequenceRuntimeStateVersionConflictError();
    }
    this.lastKnownVersion = saved.version;
  }
}
