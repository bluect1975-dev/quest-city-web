import type { Queryable } from "./types";

export interface DifficultyOverride {
  id: string;
  tenantId: string;
  classId: string | null;
  studentProfileId: string | null;
  targetRef: string;
  reason: string;
  createdByStaffAccountId: string;
  createdByRole: "TEACHER" | "SUPPORT_TEACHER";
  status: "ACTIVE" | "REVOKED";
  createdAt: Date;
  revokedAt: Date | null;
}

interface Row {
  id: string;
  tenant_id: string;
  class_id: string | null;
  student_profile_id: string | null;
  target_ref: string;
  reason: string;
  created_by_staff_account_id: string;
  created_by_role: "TEACHER" | "SUPPORT_TEACHER";
  status: "ACTIVE" | "REVOKED";
  created_at: Date;
  revoked_at: Date | null;
}

const SELECT_COLUMNS = `id, tenant_id, class_id, student_profile_id, target_ref, reason,
  created_by_staff_account_id, created_by_role, status, created_at, revoked_at`;

function mapRow(row: Row): DifficultyOverride {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    classId: row.class_id,
    studentProfileId: row.student_profile_id,
    targetRef: row.target_ref,
    reason: row.reason,
    createdByStaffAccountId: row.created_by_staff_account_id,
    createdByRole: row.created_by_role,
    status: row.status,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * `difficulty_override` -- minimal DIFFICULTY persistence slice (migration
 * 0012 header note D), NOT the full deferred 02_16/03_28 D0-D4 engine.
 * Backs `POST /support-teacher/difficulty-overrides` (02_26 v1.16 §37.6) --
 * per-student, motivated/audited override (02_39 §7.2).
 */
export class DifficultyOverrideRepository {
  constructor(private readonly db: Queryable) {}

  async findActiveByStudent(studentProfileId: string, tenantId: string): Promise<DifficultyOverride[]> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM difficulty_override
       WHERE student_profile_id = $1 AND tenant_id = $2 AND status = 'ACTIVE' ORDER BY created_at DESC`,
      [studentProfileId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  /**
   * `createdByRole` is caller-supplied, never defaulted -- the two call
   * sites (`FacilitationService.supportTeacherCreateDifficultyOverride`,
   * always `'SUPPORT_TEACHER'`; `FacilitationProposalService.review()`,
   * the reviewer's own role after `REVIEW_DERIVED_STUDENT_DIFFICULTY_AUTHORITY`
   * checks, `02_39 v1.3` §11bis) are each responsible for their own
   * authorization before calling this method. This repository enforces
   * only structural validity (the DB `CHECK` in migration 0012) -- never
   * "was this call legitimately review-derived", which is a service-layer
   * concern by design (mirrors the layering discipline already used
   * throughout this package).
   */
  async createForStudent(input: {
    tenantId: string;
    studentProfileId: string;
    targetRef: string;
    reason: string;
    createdByStaffAccountId: string;
    createdByRole: "TEACHER" | "SUPPORT_TEACHER";
  }): Promise<DifficultyOverride> {
    const result = await this.db.query<Row>(
      `INSERT INTO difficulty_override (tenant_id, student_profile_id, target_ref, reason, created_by_staff_account_id, created_by_role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SELECT_COLUMNS}`,
      [input.tenantId, input.studentProfileId, input.targetRef, input.reason, input.createdByStaffAccountId, input.createdByRole],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }
}
