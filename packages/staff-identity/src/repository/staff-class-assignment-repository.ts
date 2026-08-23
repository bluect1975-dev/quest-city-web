import type { Queryable } from "./types";

export interface StaffClassAssignment {
  id: string;
  staffTenantMembershipId: string;
  tenantId: string;
  classId: string;
  createdAt: Date;
}

interface StaffClassAssignmentRow {
  id: string;
  staff_tenant_membership_id: string;
  tenant_id: string;
  class_id: string;
  created_at: Date;
}

const SELECT_COLUMNS = `id, staff_tenant_membership_id, tenant_id, class_id, created_at`;

function mapRow(row: StaffClassAssignmentRow): StaffClassAssignment {
  return {
    id: row.id,
    staffTenantMembershipId: row.staff_tenant_membership_id,
    tenantId: row.tenant_id,
    classId: row.class_id,
    createdAt: row.created_at,
  };
}

/**
 * Per-class scope for TEACHER memberships only (02_35 §3.2). A
 * SCHOOL_ADMIN membership never has rows here — its scope is the whole
 * tenant implicitly; the DB trigger `staff_class_assignment_teacher_only`
 * rejects any INSERT against a non-TEACHER membership.
 */
export class StaffClassAssignmentRepository {
  constructor(private readonly db: Queryable) {}

  async findByMembership(staffTenantMembershipId: string, tenantId: string): Promise<StaffClassAssignment[]> {
    const result = await this.db.query<StaffClassAssignmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_class_assignment WHERE staff_tenant_membership_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
      [staffTenantMembershipId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  /** Inverse of `findByMembership` — every staff member assigned to one class (`GET /me/class`, Pilot Product Experience Remediation G2: a student's "la mia classe" surface needs the count of teachers assigned, not just a teacher's own class list). */
  async findByClass(classId: string, tenantId: string): Promise<StaffClassAssignment[]> {
    const result = await this.db.query<StaffClassAssignmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_class_assignment WHERE class_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
      [classId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  /** Used to authorize a TEACHER's access to one specific class (02_35 §3.2, CLASS_ACCESS_DENIED on empty result). */
  async findByMembershipAndClass(
    staffTenantMembershipId: string,
    classId: string,
    tenantId: string,
  ): Promise<StaffClassAssignment | null> {
    const result = await this.db.query<StaffClassAssignmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_class_assignment
       WHERE staff_tenant_membership_id = $1 AND class_id = $2 AND tenant_id = $3`,
      [staffTenantMembershipId, classId, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** `DELETE /classes/{classId}/teachers/{staffTenantMembershipId}` (02_35 §11bis.6): hard delete — the row is purely an access-scope grant, not a historical record. Returns true iff a row was actually removed. */
  async delete(staffTenantMembershipId: string, classId: string, tenantId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM staff_class_assignment WHERE staff_tenant_membership_id = $1 AND class_id = $2 AND tenant_id = $3`,
      [staffTenantMembershipId, classId, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Student-facing only (`GET /me/class`, Tranche H1 — closes
   * `NEW-GAP-STAFF-DISPLAY-NAME-01`): the real display names of every
   * teacher assigned to one class, tenant-scoped at every join hop
   * (`staff_class_assignment` -> `staff_tenant_membership` ->
   * `staff_account`, all three filtered by the same `tenant_id`) so a
   * cross-tenant row can never leak through a shared `staff_account_id`.
   * Returns `displayName: null` for a teacher who has never set one — the
   * caller decides the student-facing fallback label, never this
   * repository (no email is selected here at all, so it cannot leak even
   * by accident).
   */
  async findDisplayNamesByClass(classId: string, tenantId: string): Promise<Array<{ displayName: string | null }>> {
    const result = await this.db.query<{ display_name: string | null }>(
      `SELECT sa.display_name
       FROM staff_class_assignment sca
       JOIN staff_tenant_membership stm
         ON stm.id = sca.staff_tenant_membership_id AND stm.tenant_id = sca.tenant_id
       JOIN staff_account sa
         ON sa.id = stm.staff_account_id
       WHERE sca.class_id = $1 AND sca.tenant_id = $2
       ORDER BY sca.created_at ASC`,
      [classId, tenantId],
    );
    return result.rows.map((row) => ({ displayName: row.display_name }));
  }

  /** Administrative provisioning only (02_35 §4.2). Fails via DB trigger if the membership is not role = TEACHER. */
  async create(input: { staffTenantMembershipId: string; tenantId: string; classId: string }): Promise<StaffClassAssignment> {
    const result = await this.db.query<StaffClassAssignmentRow>(
      `INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id)
       VALUES ($1, $2, $3)
       RETURNING ${SELECT_COLUMNS}`,
      [input.staffTenantMembershipId, input.tenantId, input.classId],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }
}
