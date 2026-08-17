import type { Queryable } from "./types";

/**
 * INDEPENDENT_EDUCATOR added (02_35 v1.4 §11ter.2 decision A, migration
 * 0010): a third, explicit membership role, never behavior derived from
 * tenant.type + TEACHER (capability-first authorization, 02_27 §5.3).
 * ASACOM and SUPPORT_TEACHER added (02_25 v1.12 §6.16.1, 02_35 v1.7
 * §11quinquies/§11sexies, migration 0012): a fourth and fifth role, same
 * discipline -- distinct professional mandates, never a collapse of one
 * into the other (02_39 v1.1 §1, §3). Enforced coherent with tenant.type
 * by a DB trigger (migration 0010, extended by migration 0012), never by
 * application code alone.
 */
export type StaffRole = "TEACHER" | "SCHOOL_ADMIN" | "INDEPENDENT_EDUCATOR" | "ASACOM" | "SUPPORT_TEACHER";
/**
 * INVITED and REVOKED added by School Onboarding + Staff Membership
 * (02_35 v1.2 §11bis.2, migration 0008). INVITED = invited, not yet
 * accepted; REVOKED = terminal until a fresh invitation. Both are
 * enforcement-equivalent to SUSPENDED (no capability may be exercised on
 * this tenant) but are tracked as distinct states — see
 * `StaffAuthService.resolveInternalIdentity`.
 */
export type StaffTenantMembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED";

export interface StaffTenantMembership {
  id: string;
  staffAccountId: string;
  tenantId: string;
  role: StaffRole;
  status: StaffTenantMembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface StaffTenantMembershipRow {
  id: string;
  staff_account_id: string;
  tenant_id: string;
  role: StaffRole;
  status: StaffTenantMembershipStatus;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `id, staff_account_id, tenant_id, role, status, created_at, updated_at`;

function mapRow(row: StaffTenantMembershipRow): StaffTenantMembership {
  return {
    id: row.id,
    staffAccountId: row.staff_account_id,
    tenantId: row.tenant_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Role/tenant scope resolution for a staff_account (02_35 §3). A
 * staff_account may hold multiple memberships across tenants, and (since
 * migration 0012, 02_25 v1.12 §6.16.6) multiple memberships on the SAME
 * tenant provided each has a distinct `role` (UNIQUE (staff_account_id,
 * tenant_id, role)) -- e.g. one human as both TEACHER and SUPPORT_TEACHER
 * in one school. Never two rows with the same (staff_account_id,
 * tenant_id, role) triple, and never a single row carrying two roles.
 */
export class StaffTenantMembershipRepository {
  constructor(private readonly db: Queryable) {}

  async findByStaffAccount(staffAccountId: string): Promise<StaffTenantMembership[]> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_tenant_membership WHERE staff_account_id = $1 ORDER BY created_at ASC`,
      [staffAccountId],
    );
    return result.rows.map(mapRow);
  }

  /**
   * Since migration 0012 this can legitimately match more than one row
   * (same-tenant multi-role, 02_25 v1.12 §6.16.6) -- callers that need a
   * SINGLE unambiguous membership (login tenant resolution, tenant
   * switching) must use `findByStaffAccountTenantAndRole` when a role is
   * known, or explicitly handle the multi-row case themselves
   * (AMBIGUOUS_TENANT_MEMBERSHIP, 02_35 v1.7 §11sexies.7). This method
   * itself still returns only the first row found -- kept only for call
   * sites that pre-date multi-role and are provably single-role-only
   * (e.g. a tenant that cannot yet have more than one role type in
   * practice); do not add a new call site without checking that
   * assumption still holds.
   */
  async findByStaffAccountAndTenant(staffAccountId: string, tenantId: string): Promise<StaffTenantMembership | null> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2`,
      [staffAccountId, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** All ACTIVE memberships (rarely more than one) a staff_account holds on one tenant -- the disambiguation set for AMBIGUOUS_TENANT_MEMBERSHIP (02_35 v1.7 §11sexies.7). */
  async findAllByStaffAccountAndTenant(staffAccountId: string, tenantId: string): Promise<StaffTenantMembership[]> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
      [staffAccountId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  /** Single-role lookup, safe under same-tenant multi-role (02_25 v1.12 §6.16.6) -- used by invitation creation, which must dedupe per (account, tenant, role), not per (account, tenant). */
  async findByStaffAccountTenantAndRole(staffAccountId: string, tenantId: string, role: StaffRole): Promise<StaffTenantMembership | null> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2 AND role = $3`,
      [staffAccountId, tenantId, role],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findById(id: string, tenantId: string): Promise<StaffTenantMembership | null> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_tenant_membership WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** `GET /staff/members` (02_35 §11bis.4/§11bis.14) — every membership in the tenant, including INVITED and non-ACTIVE rows; never didactic data. */
  async findByTenant(tenantId: string, pagination: { limit: number; offset: number }): Promise<StaffTenantMembership[]> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_tenant_membership WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
      [tenantId, pagination.limit, pagination.offset],
    );
    return result.rows.map(mapRow);
  }

  /** Count of ACTIVE SCHOOL_ADMIN memberships in a tenant — used by the LAST_SCHOOL_ADMIN_PROTECTED check (02_35 §11bis.2). */
  async countActiveSchoolAdmins(tenantId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM staff_tenant_membership WHERE tenant_id = $1 AND role = 'SCHOOL_ADMIN' AND status = 'ACTIVE'`,
      [tenantId],
    );
    return Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }

  /** Administrative provisioning only (02_35 §4.2) — no self-service membership creation exists. */
  async create(input: {
    staffAccountId: string;
    tenantId: string;
    role: StaffRole;
    status: StaffTenantMembershipStatus;
  }): Promise<StaffTenantMembership> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status)
       VALUES ($1, $2, $3, $4)
       RETURNING ${SELECT_COLUMNS}`,
      [input.staffAccountId, input.tenantId, input.role, input.status],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /**
   * Reactivates (or suspends) an existing membership row in place --
   * never a second INSERT (UNIQUE (staff_account_id, tenant_id) would
   * reject one anyway). Introduced for the Platform Admin School Admin
   * activation flow's "membership already exists, SUSPENDED" case
   * (School Pilot Readiness Tranche A).
   */
  async updateStatus(id: string, tenantId: string, status: StaffTenantMembershipStatus): Promise<StaffTenantMembership | null> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `UPDATE staff_tenant_membership SET status = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId, status],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
