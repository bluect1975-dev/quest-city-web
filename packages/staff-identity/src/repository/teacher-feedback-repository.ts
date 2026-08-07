import type { Queryable } from "./types";

export type TeacherFeedbackPublicationStatus = "DRAFT" | "PUBLISHED" | "REVOKED";
export type TeacherFeedbackDeliveryStatus = "NOT_APPLICABLE" | "PENDING" | "DELIVERED" | "READ" | "FAILED";

export interface TeacherFeedback {
  id: string;
  tenantId: string;
  classId: string;
  studentProfileId: string;
  learningAttemptId: string;
  authorStaffAccountId: string;
  structuredFeedback: Record<string, unknown>;
  freeText: string | null;
  publicationStatus: TeacherFeedbackPublicationStatus;
  deliveryStatus: TeacherFeedbackDeliveryStatus;
  originReviewQueueItemId: string | null;
  recoveryAssignmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  revokedAt: Date | null;
  version: number;
}

interface TeacherFeedbackRow {
  id: string;
  tenant_id: string;
  class_id: string;
  student_profile_id: string;
  learning_attempt_id: string;
  author_staff_account_id: string;
  structured_feedback: Record<string, unknown>;
  free_text: string | null;
  publication_status: TeacherFeedbackPublicationStatus;
  delivery_status: TeacherFeedbackDeliveryStatus;
  origin_review_queue_item_id: string | null;
  recovery_assignment_id: string | null;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  revoked_at: Date | null;
  version: number;
}

const SELECT_COLUMNS = `id, tenant_id, class_id, student_profile_id, learning_attempt_id, author_staff_account_id,
       structured_feedback, free_text, publication_status, delivery_status, origin_review_queue_item_id,
       recovery_assignment_id, created_at, updated_at, published_at, revoked_at, version`;

function mapRow(row: TeacherFeedbackRow): TeacherFeedback {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    classId: row.class_id,
    studentProfileId: row.student_profile_id,
    learningAttemptId: row.learning_attempt_id,
    authorStaffAccountId: row.author_staff_account_id,
    structuredFeedback: row.structured_feedback,
    freeText: row.free_text,
    publicationStatus: row.publication_status,
    deliveryStatus: row.delivery_status,
    originReviewQueueItemId: row.origin_review_queue_item_id,
    recoveryAssignmentId: row.recovery_assignment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    revokedAt: row.revoked_at,
    version: row.version,
  };
}

/**
 * Two orthogonal status axes (02_35 §9.2) — publicationStatus is
 * docente-controlled (DRAFT/PUBLISHED/REVOKED), deliveryStatus is
 * system/runtime-controlled and is NEVER reset by `revoke` (a note
 * already READ before revocation stays READ). `freeText` is never sent
 * to Roblox — this package has no delivery mechanism at all (WEB-M3B
 * does not implement Roblox feedback delivery).
 */
export class TeacherFeedbackRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string, tenantId: string): Promise<TeacherFeedback | null> {
    const result = await this.db.query<TeacherFeedbackRow>(
      `SELECT ${SELECT_COLUMNS} FROM teacher_feedback WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findByAttempt(learningAttemptId: string, tenantId: string): Promise<TeacherFeedback[]> {
    const result = await this.db.query<TeacherFeedbackRow>(
      `SELECT ${SELECT_COLUMNS} FROM teacher_feedback WHERE learning_attempt_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
      [learningAttemptId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  async findByStudent(studentProfileId: string, tenantId: string): Promise<TeacherFeedback[]> {
    const result = await this.db.query<TeacherFeedbackRow>(
      `SELECT ${SELECT_COLUMNS} FROM teacher_feedback WHERE student_profile_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
      [studentProfileId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  /** Always created as DRAFT (publication_status default, delivery_status default NOT_APPLICABLE). */
  async create(input: {
    tenantId: string;
    classId: string;
    studentProfileId: string;
    learningAttemptId: string;
    authorStaffAccountId: string;
    structuredFeedback: Record<string, unknown>;
    freeText: string | null;
    originReviewQueueItemId: string | null;
  }): Promise<TeacherFeedback> {
    const result = await this.db.query<TeacherFeedbackRow>(
      `INSERT INTO teacher_feedback
         (tenant_id, class_id, student_profile_id, learning_attempt_id, author_staff_account_id,
          structured_feedback, free_text, origin_review_queue_item_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenantId,
        input.classId,
        input.studentProfileId,
        input.learningAttemptId,
        input.authorStaffAccountId,
        JSON.stringify(input.structuredFeedback),
        input.freeText,
        input.originReviewQueueItemId,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** DRAFT -> PUBLISHED (02_35 §9.2): sets published_at, moves delivery_status NOT_APPLICABLE -> PENDING. Optimistic concurrency via `expectedVersion`; returns null on version mismatch. */
  async publish(id: string, tenantId: string, expectedVersion: number): Promise<TeacherFeedback | null> {
    const result = await this.db.query<TeacherFeedbackRow>(
      `UPDATE teacher_feedback
       SET publication_status = 'PUBLISHED', delivery_status = 'PENDING', published_at = now(),
           version = version + 1, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND version = $3 AND publication_status = 'DRAFT'
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId, expectedVersion],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** PUBLISHED -> REVOKED (02_35 §9.2): sets revoked_at, deliberately leaves delivery_status untouched. Optimistic concurrency via `expectedVersion`; returns null on version mismatch. */
  async revoke(id: string, tenantId: string, expectedVersion: number): Promise<TeacherFeedback | null> {
    const result = await this.db.query<TeacherFeedbackRow>(
      `UPDATE teacher_feedback
       SET publication_status = 'REVOKED', revoked_at = now(), version = version + 1, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND version = $3 AND publication_status = 'PUBLISHED'
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId, expectedVersion],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Links a PUBLISHED feedback to the recovery assignment it generated (02_35 §11.3) — set once, never cleared. */
  async setRecoveryAssignment(id: string, tenantId: string, recoveryAssignmentId: string): Promise<void> {
    await this.db.query(
      `UPDATE teacher_feedback SET recovery_assignment_id = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, recoveryAssignmentId],
    );
  }
}
