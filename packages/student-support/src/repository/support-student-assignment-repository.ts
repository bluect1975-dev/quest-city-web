import { randomUUID } from "node:crypto";
import type { Queryable } from "./types";

export type SupportStudentAssignmentStatus = "ACTIVE" | "ENDED" | "REVOKED";

export interface SupportStudentAssignment {
  id: string;
  publicId: string;
  tenantId: string;
  staffTenantMembershipId: string;
  studentProfileId: string;
  classId: string | null;
  status: SupportStudentAssignmentStatus;
  startsAt: Date;
  endsAt: Date | null;
  assignedByStaffAccountId: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedByStaffAccountId: string | null;
}

interface Row {
  id: string;
  public_id: string;
  tenant_id: string;
  staff_tenant_membership_id: string;
  student_profile_id: string;
  class_id: string | null;
  status: SupportStudentAssignmentStatus;
  starts_at: Date;
  ends_at: Date | null;
  assigned_by_staff_account_id: string;
  created_at: Date;
  revoked_at: Date | null;
  revoked_by_staff_account_id: string | null;
}

const SELECT_COLUMNS = `id, public_id, tenant_id, staff_tenant_membership_id, student_profile_id, class_id,
  status, starts_at, ends_at, assigned_by_staff_account_id, created_at, revoked_at, revoked_by_staff_account_id`;

function mapRow(row: Row): SupportStudentAssignment {
  return {
    id: row.id,
    publicId: row.public_id,
    tenantId: row.tenant_id,
    staffTenantMembershipId: row.staff_tenant_membership_id,
    studentProfileId: row.student_profile_id,
    classId: row.class_id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    assignedByStaffAccountId: row.assigned_by_staff_account_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedByStaffAccountId: row.revoked_by_staff_account_id,
  };
}

/**
 * `support_student_assignment` (02_25 v1.12 §6.16.2, 02_39 v1.1 §8/§3bis.3
 * -- generalized from the never-migrated v1.0 `asacom_student_assignment`).
 * Pure SQL, no authorization logic (same layering discipline as
 * `@quest-city-web/staff-identity`'s repositories) -- tenant_id always in
 * WHERE, scope/capability checks belong to the service layer.
 */
export class SupportStudentAssignmentRepository {
  constructor(private readonly db: Queryable) {}

  /** Raw internal UUID lookup -- for internal cross-references only (e.g. resolving a learning_support_observation's support_student_assignment_id FK), never for a route-supplied "id" (always the public_id -- use `findByPublicId` for that). */
  async findById(id: string, tenantId: string): Promise<SupportStudentAssignment | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM support_student_assignment WHERE id = $1 AND tenant_id = $2`, [
      id,
      tenantId,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findByPublicId(publicId: string, tenantId: string): Promise<SupportStudentAssignment | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM support_student_assignment WHERE public_id = $1 AND tenant_id = $2`, [
      publicId,
      tenantId,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** ACTIVE-only lookup for a specific (membership, student) pair -- the core scope check (02_39 §11quinquies.4/§11sexies.4). */
  async findActiveByMembershipAndStudent(staffTenantMembershipId: string, studentProfileId: string, tenantId: string): Promise<SupportStudentAssignment | null> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM support_student_assignment
       WHERE staff_tenant_membership_id = $1 AND student_profile_id = $2 AND tenant_id = $3 AND status = 'ACTIVE'`,
      [staffTenantMembershipId, studentProfileId, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** All ACTIVE assignments for the given membership -- "My assigned students" (02_39 §22, §21bis). */
  async findActiveByMembership(staffTenantMembershipId: string, tenantId: string): Promise<SupportStudentAssignment[]> {
    const result = await this.db.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM support_student_assignment
       WHERE staff_tenant_membership_id = $1 AND tenant_id = $2 AND status = 'ACTIVE' ORDER BY created_at ASC`,
      [staffTenantMembershipId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  /** School Admin coverage view + management list (`GET /platform/support-assignments`, 02_26 v1.16 §37.2), filterable. */
  async findByTenant(
    tenantId: string,
    filter: { staffAccountId?: string; studentProfileId?: string; status?: SupportStudentAssignmentStatus },
    pagination: { limit: number; offset: number },
  ): Promise<SupportStudentAssignment[]> {
    const conditions: string[] = ["ssa.tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter.staffAccountId) {
      params.push(filter.staffAccountId);
      conditions.push(`stm.staff_account_id = $${params.length}`);
    }
    if (filter.studentProfileId) {
      params.push(filter.studentProfileId);
      conditions.push(`ssa.student_profile_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`ssa.status = $${params.length}`);
    }
    params.push(pagination.limit, pagination.offset);
    const result = await this.db.query<Row>(
      `SELECT ssa.id, ssa.public_id, ssa.tenant_id, ssa.staff_tenant_membership_id, ssa.student_profile_id, ssa.class_id,
              ssa.status, ssa.starts_at, ssa.ends_at, ssa.assigned_by_staff_account_id, ssa.created_at, ssa.revoked_at, ssa.revoked_by_staff_account_id
       FROM support_student_assignment ssa
       JOIN staff_tenant_membership stm ON stm.id = ssa.staff_tenant_membership_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ssa.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return result.rows.map(mapRow);
  }

  /** `student_support_assignment.manage` (SCHOOL_ADMIN-only, 02_39 §8) -- membership role/tenant coherence enforced by the DB trigger, not here. */
  async create(input: {
    tenantId: string;
    staffTenantMembershipId: string;
    studentProfileId: string;
    classId: string | null;
    assignedByStaffAccountId: string;
    startsAt?: Date;
    endsAt?: Date | null;
  }): Promise<SupportStudentAssignment> {
    const publicId = `ssa_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const result = await this.db.query<Row>(
      `INSERT INTO support_student_assignment
         (public_id, tenant_id, staff_tenant_membership_id, student_profile_id, class_id, assigned_by_staff_account_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8)
       RETURNING ${SELECT_COLUMNS}`,
      [
        publicId,
        input.tenantId,
        input.staffTenantMembershipId,
        input.studentProfileId,
        input.classId,
        input.assignedByStaffAccountId,
        input.startsAt ?? null,
        input.endsAt ?? null,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** ACTIVE -> ENDED (natural conclusion) or ACTIVE -> REVOKED (early termination), 02_39 §8. Returns null if the row is not currently ACTIVE (409 SUPPORT_ASSIGNMENT_INACTIVE at the service layer). `publicId` -- the route-supplied id is always the public_id (see the note on FacilitationProposalRepository.review, same bug class, caught the same way). */
  async transitionStatus(
    publicId: string,
    tenantId: string,
    targetStatus: "ENDED" | "REVOKED",
    revokedByStaffAccountId: string | null,
  ): Promise<SupportStudentAssignment | null> {
    const result = await this.db.query<Row>(
      `UPDATE support_student_assignment
       SET status = $3,
           ends_at = CASE WHEN $3 = 'ENDED' THEN now() ELSE ends_at END,
           revoked_at = CASE WHEN $3 = 'REVOKED' THEN now() ELSE revoked_at END,
           revoked_by_staff_account_id = CASE WHEN $3 = 'REVOKED' THEN $4 ELSE revoked_by_staff_account_id END
       WHERE public_id = $1 AND tenant_id = $2 AND status = 'ACTIVE'
       RETURNING ${SELECT_COLUMNS}`,
      [publicId, tenantId, targetStatus, revokedByStaffAccountId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
