import type { LearningAttemptRepository, LearningAttempt } from "../repository/learning-attempt-repository";

export interface AttemptSummary {
  attemptId: string;
  runtimeChannel: "WEB" | "ROBLOX" | "UNKNOWN_LEGACY";
  attemptState: string;
  completionStatus: string | null;
}

export type ReconciliationResolution = "NONE_PENDING" | "AUTO_RESOLVABLE" | "RECONCILIATION_REQUIRED";

export interface EvaluateResult {
  concurrentAttempts: AttemptSummary[];
  resolution: ReconciliationResolution;
  prevailingAttemptId?: string;
}

function toSummary(a: LearningAttempt): AttemptSummary {
  return {
    attemptId: a.id,
    runtimeChannel: a.runtimeChannel,
    attemptState: a.attemptState,
    completionStatus: a.completionStatus,
  };
}

/**
 * CrossRuntimeReconciliationService (02_25 §28.3, 07_15_01 v1.1 §13):
 * production surface is `evaluate()` only. Real controlled-manual
 * resolution requires a staff authentication and audit actor model that
 * does not exist yet (AGENTS.md v4.30 D3) — `resolve()` is intentionally
 * NOT implemented here. Test/fixture-only simulation of a resolution
 * outcome lives in `CrossRuntimeReconciliationFixtureDriver`
 * (packages/test-fixtures), never exported from this production package
 * (see docs/adr/0003 and tools/check-fixture-isolation.mjs).
 */
export class CrossRuntimeReconciliationService {
  constructor(private readonly attempts: LearningAttemptRepository) {}

  async evaluate(input: { tenantId: string; assignmentId: string; studentProfileId: string }): Promise<EvaluateResult> {
    const all = await this.attempts.findConcurrentByAssignmentAndStudent(
      input.tenantId,
      input.assignmentId,
      input.studentProfileId,
    );
    const concurrentAttempts = all.map(toSummary);

    const consolidated = all.filter((a) => a.completionStatus === "CONSOLIDATED");
    if (consolidated.length >= 1) {
      // completion_policy = FIRST_VALID_COMPLETION (only value currently
      // supported, 02_26 v1.6 §18.1): the earliest CONSOLIDATED attempt
      // (findConcurrentByAssignmentAndStudent orders by started_at ASC)
      // prevails; later CONSOLIDATED rows would represent a real conflict
      // this service does not expect under FIRST_VALID_COMPLETION and are
      // reported for RECONCILIATION_REQUIRED rather than silently ignored.
      if (consolidated.length === 1) {
        return { concurrentAttempts, resolution: "AUTO_RESOLVABLE", prevailingAttemptId: consolidated[0]!.id };
      }
      return { concurrentAttempts, resolution: "RECONCILIATION_REQUIRED" };
    }

    const pending = all.filter(
      (a) => a.attemptState === "COMPLETION_SUBMITTED" || a.attemptState === "IN_PROGRESS",
    );
    if (pending.length <= 1) {
      return { concurrentAttempts, resolution: "NONE_PENDING" };
    }
    // More than one attempt (potentially across runtimes) is concurrently
    // active/pending completion for the same assignment+student — cannot
    // determine automatically which should prevail without an outcome yet.
    return { concurrentAttempts, resolution: "RECONCILIATION_REQUIRED" };
  }
}
