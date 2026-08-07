import type { Queryable } from "./types";

export type AttemptState = "CREATED" | "IN_PROGRESS" | "COMPLETION_SUBMITTED" | "COMPLETED" | "ABANDONED" | "EXPIRED";
export type CompletionStatus = "ACCEPTED_NOT_CONSOLIDATED" | "RECONCILIATION_REQUIRED" | "CONSOLIDATED";
export type RuntimeChannel = "WEB" | "ROBLOX" | "UNKNOWN_LEGACY";

export interface LearningAttempt {
  id: string;
  tenantId: string;
  eventId: string;
  assignmentId: string;
  studentProfileId: string;
  enrollmentId: string;
  contentBundleId: string;
  contentId: string;
  contentVersion: string;
  sessionId: string | null;
  attemptState: AttemptState;
  completionStatus: CompletionStatus | null;
  startedAt: Date;
  completedAt: Date | null;
  outcome: Record<string, unknown> | null;
  runtimeChannel: RuntimeChannel;
  runtimeVersion: string | null;
  presentationAdapterVersion: string | null;
  themeId: string | null;
  validatorVersion: string | null;
  creationIdempotencyKey: string;
}

interface LearningAttemptRow {
  id: string;
  tenant_id: string;
  event_id: string;
  assignment_id: string;
  student_profile_id: string;
  enrollment_id: string;
  content_bundle_id: string;
  content_id: string;
  content_version: string;
  session_id: string | null;
  attempt_state: AttemptState;
  completion_status: CompletionStatus | null;
  started_at: Date;
  completed_at: Date | null;
  outcome: Record<string, unknown> | null;
  runtime_channel: RuntimeChannel;
  runtime_version: string | null;
  presentation_adapter_version: string | null;
  theme_id: string | null;
  validator_version: string | null;
  creation_idempotency_key: string;
}

const SELECT_COLUMNS = `id, tenant_id, event_id, assignment_id, student_profile_id, enrollment_id,
       content_bundle_id, content_id, content_version, session_id, attempt_state, completion_status,
       started_at, completed_at, outcome, runtime_channel, runtime_version, presentation_adapter_version,
       theme_id, validator_version, creation_idempotency_key`;

function mapRow(row: LearningAttemptRow): LearningAttempt {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventId: row.event_id,
    assignmentId: row.assignment_id,
    studentProfileId: row.student_profile_id,
    enrollmentId: row.enrollment_id,
    contentBundleId: row.content_bundle_id,
    contentId: row.content_id,
    contentVersion: row.content_version,
    sessionId: row.session_id,
    attemptState: row.attempt_state,
    completionStatus: row.completion_status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    outcome: row.outcome,
    runtimeChannel: row.runtime_channel,
    runtimeVersion: row.runtime_version,
    presentationAdapterVersion: row.presentation_adapter_version,
    themeId: row.theme_id,
    validatorVersion: row.validator_version,
    creationIdempotencyKey: row.creation_idempotency_key,
  };
}

export interface ProgressSummaryFilters {
  runtimeChannel?: RuntimeChannel;
  reconciliationStatus?: CompletionStatus;
  technicalVersion?: string;
}

export interface ProgressSummary {
  totalAttempts: number;
  byAttemptState: Record<string, number>;
  byCompletionStatus: Record<string, number>;
}

export class LearningAttemptRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Single unified aggregate for a student (07_15_01 v1.1 §7.1) — never a
   * per-runtime ledger. Filters (runtime/reconciliation/technical
   * version) narrow the same aggregate, they never produce a second one.
   */
  async summarizeForStudent(
    tenantId: string,
    studentProfileId: string,
    filters: ProgressSummaryFilters,
  ): Promise<ProgressSummary> {
    const conditions: string[] = ["tenant_id = $1", "student_profile_id = $2"];
    const values: unknown[] = [tenantId, studentProfileId];
    if (filters.runtimeChannel) {
      values.push(filters.runtimeChannel);
      conditions.push(`runtime_channel = $${values.length}`);
    }
    if (filters.reconciliationStatus) {
      values.push(filters.reconciliationStatus);
      conditions.push(`completion_status = $${values.length}`);
    }
    if (filters.technicalVersion) {
      values.push(filters.technicalVersion);
      conditions.push(`runtime_version = $${values.length}`);
    }

    const result = await this.db.query<{ attempt_state: AttemptState; completion_status: CompletionStatus | null; count: string }>(
      `SELECT attempt_state, completion_status, count(*)::text AS count
       FROM learning_attempt
       WHERE ${conditions.join(" AND ")}
       GROUP BY attempt_state, completion_status`,
      values,
    );

    const byAttemptState: Record<string, number> = {};
    const byCompletionStatus: Record<string, number> = {};
    let totalAttempts = 0;
    for (const row of result.rows) {
      const n = Number(row.count);
      totalAttempts += n;
      byAttemptState[row.attempt_state] = (byAttemptState[row.attempt_state] ?? 0) + n;
      if (row.completion_status) {
        byCompletionStatus[row.completion_status] = (byCompletionStatus[row.completion_status] ?? 0) + n;
      }
    }
    return { totalAttempts, byAttemptState, byCompletionStatus };
  }

  async findByIdAndTenant(id: string, tenantId: string): Promise<LearningAttempt | null> {
    const result = await this.db.query<LearningAttemptRow>(
      `SELECT ${SELECT_COLUMNS} FROM learning_attempt WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Creation-idempotency lookup (07_15_01 v1.1 §10.1) — distinct from completion idempotency. */
  async findByCreationKey(
    tenantId: string,
    assignmentId: string,
    studentProfileId: string,
    creationIdempotencyKey: string,
  ): Promise<LearningAttempt | null> {
    const result = await this.db.query<LearningAttemptRow>(
      `SELECT ${SELECT_COLUMNS} FROM learning_attempt
       WHERE tenant_id = $1 AND assignment_id = $2 AND student_profile_id = $3 AND creation_idempotency_key = $4`,
      [tenantId, assignmentId, studentProfileId, creationIdempotencyKey],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findConcurrentByAssignmentAndStudent(
    tenantId: string,
    assignmentId: string,
    studentProfileId: string,
  ): Promise<LearningAttempt[]> {
    const result = await this.db.query<LearningAttemptRow>(
      `SELECT ${SELECT_COLUMNS} FROM learning_attempt
       WHERE tenant_id = $1 AND assignment_id = $2 AND student_profile_id = $3
       ORDER BY started_at ASC`,
      [tenantId, assignmentId, studentProfileId],
    );
    return result.rows.map(mapRow);
  }

  async create(input: {
    tenantId: string;
    eventId: string;
    assignmentId: string;
    studentProfileId: string;
    enrollmentId: string;
    contentBundleId: string;
    contentId: string;
    contentVersion: string;
    runtimeChannel: "WEB" | "ROBLOX";
    runtimeVersion?: string | null;
    presentationAdapterVersion?: string | null;
    themeId?: string | null;
    creationIdempotencyKey: string;
  }): Promise<LearningAttempt> {
    const result = await this.db.query<LearningAttemptRow>(
      `INSERT INTO learning_attempt
         (tenant_id, event_id, assignment_id, student_profile_id, enrollment_id, content_bundle_id,
          content_id, content_version, runtime_channel, runtime_version, presentation_adapter_version,
          theme_id, creation_idempotency_key, attempt_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'CREATED')
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenantId,
        input.eventId,
        input.assignmentId,
        input.studentProfileId,
        input.enrollmentId,
        input.contentBundleId,
        input.contentId,
        input.contentVersion,
        input.runtimeChannel,
        input.runtimeVersion ?? null,
        input.presentationAdapterVersion ?? null,
        input.themeId ?? null,
        input.creationIdempotencyKey,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** CREATED -> IN_PROGRESS (07_15_01 v1.1 §11-bis.2), first semantic action. No-op if already IN_PROGRESS. */
  async transitionToInProgress(id: string, tenantId: string): Promise<LearningAttempt | null> {
    const result = await this.db.query<LearningAttemptRow>(
      `UPDATE learning_attempt SET attempt_state = 'IN_PROGRESS'
       WHERE id = $1 AND tenant_id = $2 AND attempt_state = 'CREATED'
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId],
    );
    const [row] = result.rows;
    if (row) return mapRow(row);
    return this.findByIdAndTenant(id, tenantId);
  }

  /**
   * IN_PROGRESS -> COMPLETION_SUBMITTED (07_15_01 v1.1 §11-bis.2). Only
   * valid source state; returns null (no row updated) otherwise — the
   * caller maps that to ATTEMPT_NOT_COMPLETABLE / ATTEMPT_ALREADY_CONSOLIDATED.
   */
  async transitionToCompletionSubmitted(
    id: string,
    tenantId: string,
    completionStatus: "ACCEPTED_NOT_CONSOLIDATED" | "RECONCILIATION_REQUIRED",
  ): Promise<LearningAttempt | null> {
    const result = await this.db.query<LearningAttemptRow>(
      `UPDATE learning_attempt
       SET attempt_state = 'COMPLETION_SUBMITTED', completion_status = $3
       WHERE id = $1 AND tenant_id = $2 AND attempt_state = 'IN_PROGRESS'
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId, completionStatus],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** COMPLETION_SUBMITTED -> COMPLETION_SUBMITTED, completion_status update only (still pending). */
  async updatePendingCompletionStatus(
    id: string,
    tenantId: string,
    completionStatus: "ACCEPTED_NOT_CONSOLIDATED" | "RECONCILIATION_REQUIRED",
  ): Promise<LearningAttempt | null> {
    const result = await this.db.query<LearningAttemptRow>(
      `UPDATE learning_attempt
       SET completion_status = $3
       WHERE id = $1 AND tenant_id = $2 AND attempt_state = 'COMPLETION_SUBMITTED'
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId, completionStatus],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** COMPLETION_SUBMITTED -> COMPLETED/CONSOLIDATED (07_15_01 v1.1 §11-bis.5), terminal. */
  async consolidate(
    id: string,
    tenantId: string,
    outcome: Record<string, unknown>,
  ): Promise<LearningAttempt | null> {
    const result = await this.db.query<LearningAttemptRow>(
      `UPDATE learning_attempt
       SET attempt_state = 'COMPLETED', completion_status = 'CONSOLIDATED',
           completed_at = now(), outcome = $3
       WHERE id = $1 AND tenant_id = $2 AND attempt_state = 'COMPLETION_SUBMITTED'
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId, JSON.stringify(outcome)],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
