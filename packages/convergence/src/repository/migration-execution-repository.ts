import type { Queryable } from "./types";

export type MigrationExecutionStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "ROLLBACK_REVIEW_REQUIRED";
export type RollbackReviewStatus = "PENDING" | "ACCEPTED_PARTIAL" | "RETRY_SCHEDULED";

export interface UnitCheckpointEntry {
  unitType: "MEMBERSHIP" | "CLASS";
  unitId: string;
  outcome: "MIGRATED" | "RETAINED" | "FAILED";
  reason?: string;
}

export interface MigrationExecution {
  id: string;
  migrationPlanId: string;
  convergenceRequestId: string;
  convergenceRunId: string;
  status: MigrationExecutionStatus;
  unitsTotal: number;
  unitsMigrated: number;
  unitsFailed: number;
  checkpoint: UnitCheckpointEntry[];
  result: Record<string, unknown>;
  failureReason: string | null;
  rollbackReviewStatus: RollbackReviewStatus | null;
  rollbackReviewedByStaffAccountId: string | null;
  rollbackReviewedAt: Date | null;
  startedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
}

interface MigrationExecutionRow {
  id: string;
  migration_plan_id: string;
  convergence_request_id: string;
  convergence_run_id: string;
  status: MigrationExecutionStatus;
  units_total: number;
  units_migrated: number;
  units_failed: number;
  checkpoint_json: UnitCheckpointEntry[];
  result_json: Record<string, unknown>;
  failure_reason: string | null;
  rollback_review_status: RollbackReviewStatus | null;
  rollback_reviewed_by_staff_account_id: string | null;
  rollback_reviewed_at: Date | null;
  started_at: Date;
  completed_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
}

const SELECT_COLUMNS = `id, migration_plan_id, convergence_request_id, convergence_run_id, status,
  units_total, units_migrated, units_failed, checkpoint_json, result_json, failure_reason,
  rollback_review_status, rollback_reviewed_by_staff_account_id, rollback_reviewed_at,
  started_at, completed_at, failed_at, created_at`;

function mapRow(row: MigrationExecutionRow): MigrationExecution {
  return {
    id: row.id,
    migrationPlanId: row.migration_plan_id,
    convergenceRequestId: row.convergence_request_id,
    convergenceRunId: row.convergence_run_id,
    status: row.status,
    unitsTotal: row.units_total,
    unitsMigrated: row.units_migrated,
    unitsFailed: row.units_failed,
    checkpoint: row.checkpoint_json,
    result: row.result_json,
    failureReason: row.failure_reason,
    rollbackReviewStatus: row.rollback_review_status,
    rollbackReviewedByStaffAccountId: row.rollback_reviewed_by_staff_account_id,
    rollbackReviewedAt: row.rollback_reviewed_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    createdAt: row.created_at,
  };
}

export class MigrationExecutionRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string): Promise<MigrationExecution | null> {
    const result = await this.db.query<MigrationExecutionRow>(
      `SELECT ${SELECT_COLUMNS} FROM migration_execution WHERE id = $1`,
      [id],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findByConvergenceRunId(convergenceRunId: string): Promise<MigrationExecution | null> {
    const result = await this.db.query<MigrationExecutionRow>(
      `SELECT ${SELECT_COLUMNS} FROM migration_execution WHERE convergence_run_id = $1`,
      [convergenceRunId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async create(input: {
    migrationPlanId: string;
    convergenceRequestId: string;
    convergenceRunId: string;
    unitsTotal: number;
  }): Promise<MigrationExecution> {
    const result = await this.db.query<MigrationExecutionRow>(
      `INSERT INTO migration_execution (migration_plan_id, convergence_request_id, convergence_run_id, status, units_total)
       VALUES ($1, $2, $3, 'IN_PROGRESS', $4)
       RETURNING ${SELECT_COLUMNS}`,
      [input.migrationPlanId, input.convergenceRequestId, input.convergenceRunId, input.unitsTotal],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /**
   * RETRY_REMAINING resume (02_38 v1.4 §10.5): moves a PENDING row (set by
   * `resolveRollbackReview`) back to IN_PROGRESS on the SAME row --
   * `convergence_run_id` is UNIQUE, so a retry can never be a second
   * INSERT with the same run id, only a continuation of this one.
   */
  async markResumed(id: string): Promise<MigrationExecution> {
    const result = await this.db.query<MigrationExecutionRow>(
      `UPDATE migration_execution SET status = 'IN_PROGRESS' WHERE id = $1 AND status = 'PENDING' RETURNING ${SELECT_COLUMNS}`,
      [id],
    );
    const [row] = result.rows;
    if (!row) throw new Error("markResumed: row not found or not in PENDING status");
    return mapRow(row);
  }

  async recordUnitOutcome(id: string, checkpoint: UnitCheckpointEntry[], unitsMigrated: number, unitsFailed: number): Promise<void> {
    await this.db.query(
      `UPDATE migration_execution SET checkpoint_json = $2, units_migrated = $3, units_failed = $4 WHERE id = $1`,
      [id, JSON.stringify(checkpoint), unitsMigrated, unitsFailed],
    );
  }

  async finish(
    id: string,
    status: "COMPLETED" | "FAILED" | "ROLLBACK_REVIEW_REQUIRED",
    result: Record<string, unknown>,
    failureReason: string | null,
  ): Promise<MigrationExecution | null> {
    const dbResult = await this.db.query<MigrationExecutionRow>(
      `UPDATE migration_execution SET
         status = $2, result_json = $3, failure_reason = $4,
         completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END,
         failed_at = CASE WHEN $2 IN ('FAILED', 'ROLLBACK_REVIEW_REQUIRED') THEN now() ELSE failed_at END,
         rollback_review_status = CASE WHEN $2 = 'ROLLBACK_REVIEW_REQUIRED' THEN 'PENDING' ELSE rollback_review_status END
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [id, status, JSON.stringify(result), failureReason],
    );
    const [row] = dbResult.rows;
    return row ? mapRow(row) : null;
  }

  async resolveRollbackReview(
    id: string,
    decision: "ACCEPT_PARTIAL" | "RETRY_REMAINING",
    reviewedByStaffAccountId: string,
  ): Promise<MigrationExecution | null> {
    const status: MigrationExecutionStatus = decision === "ACCEPT_PARTIAL" ? "COMPLETED" : "PENDING";
    const rollbackReviewStatus: RollbackReviewStatus = decision === "ACCEPT_PARTIAL" ? "ACCEPTED_PARTIAL" : "RETRY_SCHEDULED";
    const result = await this.db.query<MigrationExecutionRow>(
      `UPDATE migration_execution SET
         status = $2, rollback_review_status = $3, rollback_reviewed_by_staff_account_id = $4, rollback_reviewed_at = now(),
         completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END
       WHERE id = $1 AND status = 'ROLLBACK_REVIEW_REQUIRED'
       RETURNING ${SELECT_COLUMNS}`,
      [id, status, rollbackReviewStatus, reviewedByStaffAccountId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
