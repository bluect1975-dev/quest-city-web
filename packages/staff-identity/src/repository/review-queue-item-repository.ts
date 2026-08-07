import type { Queryable } from "./types";

export type ReviewQueueItemReason =
  | "INCORRECT_ATTEMPT"
  | "OPEN_ANSWER"
  | "PRIORITY_MISCONCEPTION"
  | "HELP_REQUESTED"
  | "MANUALLY_SELECTED";

export type ReviewQueueItemPriority = "LOW" | "MEDIUM" | "HIGH";
export type ReviewQueueItemStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";

export interface ReviewQueueItem {
  id: string;
  tenantId: string;
  classId: string;
  studentProfileId: string;
  learningAttemptId: string;
  reason: ReviewQueueItemReason;
  priority: ReviewQueueItemPriority;
  status: ReviewQueueItemStatus;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  reviewerStaffAccountId: string | null;
  version: number;
}

interface ReviewQueueItemRow {
  id: string;
  tenant_id: string;
  class_id: string;
  student_profile_id: string;
  learning_attempt_id: string;
  reason: ReviewQueueItemReason;
  priority: ReviewQueueItemPriority;
  status: ReviewQueueItemStatus;
  created_at: Date;
  updated_at: Date;
  reviewed_at: Date | null;
  reviewer_staff_account_id: string | null;
  version: number;
}

const SELECT_COLUMNS = `id, tenant_id, class_id, student_profile_id, learning_attempt_id, reason, priority, status,
       created_at, updated_at, reviewed_at, reviewer_staff_account_id, version`;

function mapRow(row: ReviewQueueItemRow): ReviewQueueItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    classId: row.class_id,
    studentProfileId: row.student_profile_id,
    learningAttemptId: row.learning_attempt_id,
    reason: row.reason,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    reviewerStaffAccountId: row.reviewer_staff_account_id,
    version: row.version,
  };
}

/**
 * References `learning_attempt` by id only — never copies its data
 * (02_35 §1 principle 6, §7). The partial unique index
 * `review_queue_item_attempt_active_uq` (migration 0004) guarantees at
 * most one OPEN/IN_REVIEW row per attempt; historical RESOLVED/DISMISSED
 * rows are never deleted, so `reopen` always creates no new row — it
 * transitions the same row back to OPEN.
 */
export class ReviewQueueItemRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string, tenantId: string): Promise<ReviewQueueItem | null> {
    const result = await this.db.query<ReviewQueueItemRow>(
      `SELECT ${SELECT_COLUMNS} FROM review_queue_item WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /**
   * `classIds: null` means no class restriction (SCHOOL_ADMIN, whole
   * tenant); a populated array restricts to exactly those classes
   * (TEACHER's explicit class scope, 02_35 §3.2). `classId` further
   * narrows to a single class (the `?classId=` query param, 02_35 §7) —
   * the caller is responsible for verifying it is itself within
   * `classIds` before calling (CLASS_ACCESS_DENIED), this repository
   * performs no authorization.
   */
  async findByScope(
    tenantId: string,
    scope: {
      classIds: string[] | null;
      classId?: string | undefined;
      status?: ReviewQueueItemStatus[] | undefined;
      priority?: ReviewQueueItemPriority[] | undefined;
    },
  ): Promise<ReviewQueueItem[]> {
    const result = await this.db.query<ReviewQueueItemRow>(
      `SELECT ${SELECT_COLUMNS} FROM review_queue_item
       WHERE tenant_id = $1
         AND ($2::uuid[] IS NULL OR class_id = ANY($2::uuid[]))
         AND ($3::uuid IS NULL OR class_id = $3::uuid)
         AND ($4::text[] IS NULL OR status = ANY($4))
         AND ($5::text[] IS NULL OR priority = ANY($5))
       ORDER BY
         CASE priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
         created_at ASC`,
      [tenantId, scope.classIds, scope.classId ?? null, scope.status ?? null, scope.priority ?? null],
    );
    return result.rows.map(mapRow);
  }

  /** System-triggered creation (attempt qualifies per reason criteria) — not a direct staff-facing write. */
  async create(input: {
    tenantId: string;
    classId: string;
    studentProfileId: string;
    learningAttemptId: string;
    reason: ReviewQueueItemReason;
    priority: ReviewQueueItemPriority;
  }): Promise<ReviewQueueItem> {
    const result = await this.db.query<ReviewQueueItemRow>(
      `INSERT INTO review_queue_item (tenant_id, class_id, student_profile_id, learning_attempt_id, reason, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SELECT_COLUMNS}`,
      [input.tenantId, input.classId, input.studentProfileId, input.learningAttemptId, input.reason, input.priority],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /**
   * Optimistic-concurrency transition (If-Match/version, 02_35 §14).
   * `expectedVersion` must match the current row or zero rows are
   * updated — the caller (ReviewService) treats that as ETAG_MISMATCH.
   * `reviewerStaffAccountId`/`reviewedAt` are only set on transitions
   * into IN_REVIEW/RESOLVED/DISMISSED; `reopen` (target OPEN) clears
   * both, matching the CHECK ((reviewed_at IS NULL) = (reviewer_staff_account_id IS NULL)).
   */
  async transitionStatus(
    id: string,
    tenantId: string,
    expectedVersion: number,
    targetStatus: ReviewQueueItemStatus,
    reviewerStaffAccountId: string | null,
  ): Promise<ReviewQueueItem | null> {
    const setsReviewer = targetStatus !== "OPEN";
    const result = await this.db.query<ReviewQueueItemRow>(
      `UPDATE review_queue_item
       SET status = $4,
           version = version + 1,
           updated_at = now(),
           reviewer_staff_account_id = CASE WHEN $5 THEN $6::uuid ELSE NULL END,
           reviewed_at = CASE WHEN $5 THEN now() ELSE NULL END
       WHERE id = $1 AND tenant_id = $2 AND version = $3
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId, expectedVersion, targetStatus, setsReviewer, reviewerStaffAccountId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
