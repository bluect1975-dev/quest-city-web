import type { Queryable } from "./types";

export type SupportProfileCategory = "PRESENTATION" | "TIME_AND_LOAD" | "TOOLS" | "RESPONSE" | "FEEDBACK" | "ASSESSMENT" | "SUBJECT";
export type SupportProfileLevel = "SESSION_ONLY" | "PROFILE_LEVEL";
export type SupportProfileStatus = "ACTIVE" | "SUPERSEDED" | "REVOKED";
export type SupportProfileAppliedByRole = "TEACHER" | "SUPPORT_TEACHER" | "ASACOM";

export interface SupportProfileEntry {
  id: string;
  tenantId: string;
  studentProfileId: string;
  category: SupportProfileCategory;
  level: SupportProfileLevel;
  configJson: Record<string, unknown>;
  status: SupportProfileStatus;
  appliedByStaffAccountId: string;
  appliedByRole: SupportProfileAppliedByRole;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface Row {
  id: string;
  tenant_id: string;
  student_profile_id: string;
  category: SupportProfileCategory;
  level: SupportProfileLevel;
  config_json: Record<string, unknown>;
  status: SupportProfileStatus;
  applied_by_staff_account_id: string;
  applied_by_role: SupportProfileAppliedByRole;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `id, tenant_id, student_profile_id, category, level, config_json, status,
  applied_by_staff_account_id, applied_by_role, expires_at, created_at, updated_at`;

function mapRow(row: Row): SupportProfileEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentProfileId: row.student_profile_id,
    category: row.category,
    level: row.level,
    configJson: row.config_json,
    status: row.status,
    appliedByStaffAccountId: row.applied_by_staff_account_id,
    appliedByRole: row.applied_by_role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * `support_profile` -- minimal FACILITATION persistence slice (migration
 * 0012 header note D), NOT the full deferred 02_31/02_32 module. Backs
 * `GET /students/{id}/facilitation`, `POST /asacom/facilitation/{id}/apply-temporary`,
 * `POST /support-teacher/facilitation/{id}/apply` (02_26 v1.16 §37.6).
 */
export class SupportProfileRepository {
  constructor(private readonly db: Queryable) {}

  /** Current facilitation state (ACTIVE rows only) for a student, across both persistence levels -- `GET /students/{id}/facilitation`. */
  async findActiveByStudent(studentProfileId: string, tenantId: string): Promise<SupportProfileEntry[]> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM support_profile
       WHERE student_profile_id = $1 AND tenant_id = $2 AND status = 'ACTIVE'
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY category ASC`,
      [studentProfileId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  async findActiveByStudentAndCategory(studentProfileId: string, tenantId: string, category: SupportProfileCategory): Promise<SupportProfileEntry | null> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM support_profile
       WHERE student_profile_id = $1 AND tenant_id = $2 AND category = $3 AND status = 'ACTIVE'
         AND level = 'PROFILE_LEVEL'`,
      [studentProfileId, tenantId, category],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /**
   * Applies a facilitation. PROFILE_LEVEL writes supersede any existing
   * ACTIVE PROFILE_LEVEL row for the same (student, category) inside the
   * same transaction (the caller passes a transaction-bound client for
   * that atomicity) -- never two simultaneously-ACTIVE PROFILE_LEVEL rows
   * for one category, enforced by the partial unique index (migration
   * 0012) as a backstop, not the primary mechanism. SESSION_ONLY writes
   * are independent, short-lived, and never supersede anything.
   */
  async apply(input: {
    tenantId: string;
    studentProfileId: string;
    category: SupportProfileCategory;
    level: SupportProfileLevel;
    configJson: Record<string, unknown>;
    appliedByStaffAccountId: string;
    appliedByRole: SupportProfileAppliedByRole;
    expiresAt: Date | null;
  }): Promise<SupportProfileEntry> {
    if (input.level === "PROFILE_LEVEL") {
      await this.db.query(
        `UPDATE support_profile SET status = 'SUPERSEDED', updated_at = now()
         WHERE student_profile_id = $1 AND tenant_id = $2 AND category = $3 AND status = 'ACTIVE' AND level = 'PROFILE_LEVEL'`,
        [input.studentProfileId, input.tenantId, input.category],
      );
    }
    const result = await this.db.query<Row>(
      `INSERT INTO support_profile
         (tenant_id, student_profile_id, category, level, config_json, applied_by_staff_account_id, applied_by_role, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenantId,
        input.studentProfileId,
        input.category,
        input.level,
        JSON.stringify(input.configJson),
        input.appliedByStaffAccountId,
        input.appliedByRole,
        input.expiresAt,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }
}
