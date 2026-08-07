import type { Pool, PoolClient } from "pg";

/**
 * TEST-ONLY. Simulates the outcome of a real riconciliazione controllata
 * without implementing one (07_15_01 v1.1 §13.3 explicitly defers real
 * controlled resolution to a future staff-authentication milestone —
 * AGENTS.md v4.30 D3). Lets integration tests set up an
 * "already-reconciled" scenario (a prevailing attempt consolidated, a
 * losing concurrent attempt left as-is) to exercise downstream code paths
 * that depend on a resolved RECONCILIATION_REQUIRED case, without a real
 * `CrossRuntimeReconciliationService.resolve()` existing.
 *
 * MUST NEVER be imported from production code (apps/api, packages/attempts,
 * packages/content-runtime). Enforced by tools/check-fixture-isolation.mjs.
 * This is why it lives in packages/test-fixtures and operates on a raw `pg`
 * connection directly, never on @quest-city-web/attempts's repositories —
 * it has no production-code dependency to leak.
 */
export type FixtureResolutionMethod = "AUTOMATIC_DEFERRED" | "CONTROLLED_MANUAL_SIMULATED";

export interface SimulateResolutionInput {
  tenantId: string;
  assignmentId: string;
  studentProfileId: string;
  prevailingAttemptId: string;
  fixtureResolution: FixtureResolutionMethod;
  outcome: Record<string, unknown>;
}

export interface SimulateResolutionResult {
  prevailingAttemptId: string;
  auditEventId: string;
}

export class CrossRuntimeReconciliationFixtureDriver {
  constructor(private readonly db: Pool | PoolClient) {}

  async simulateResolution(input: SimulateResolutionInput): Promise<SimulateResolutionResult> {
    const consolidateResult = await this.db.query(
      `UPDATE learning_attempt
       SET attempt_state = 'COMPLETED', completion_status = 'CONSOLIDATED', completed_at = now(), outcome = $3
       WHERE id = $1 AND tenant_id = $2 AND attempt_state = 'COMPLETION_SUBMITTED'
       RETURNING id`,
      [input.prevailingAttemptId, input.tenantId, JSON.stringify(input.outcome)],
    );
    if (consolidateResult.rows.length === 0) {
      throw new Error(
        `CrossRuntimeReconciliationFixtureDriver: attempt ${input.prevailingAttemptId} was not COMPLETION_SUBMITTED — fixture setup precondition failed`,
      );
    }

    const auditResult = await this.db.query(
      `INSERT INTO audit_event (tenant_id, actor_type, actor_id, action, target_type, target_id, result, metadata_redacted)
       VALUES ($1, 'SYSTEM', 'cross-runtime-reconciliation-fixture-driver', 'RECONCILIATION_SIMULATED', 'learning_attempt', $2, 'SUCCESS', $3)
       RETURNING id`,
      [
        input.tenantId,
        input.prevailingAttemptId,
        JSON.stringify({ fixtureResolution: input.fixtureResolution, assignmentId: input.assignmentId, studentProfileId: input.studentProfileId }),
      ],
    );
    const auditEventId = auditResult.rows[0]?.id;
    if (!auditEventId) {
      throw new Error("CrossRuntimeReconciliationFixtureDriver: audit_event insert produced no row");
    }

    return { prevailingAttemptId: input.prevailingAttemptId, auditEventId };
  }
}
