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
