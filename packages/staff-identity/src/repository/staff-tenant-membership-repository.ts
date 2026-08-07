import type { Queryable } from "./types";

export type StaffRole = "TEACHER" | "SCHOOL_ADMIN";
export type StaffTenantMembershipStatus = "ACTIVE" | "SUSPENDED";

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

/** Role/tenant scope resolution for a staff_account (02_35 §3). A staff_account may hold at most one membership per tenant (UNIQUE (staff_account_id, tenant_id)), but multiple memberships across tenants. */
export class StaffTenantMembershipRepository {
  constructor(private readonly db: Queryable) {}

  async findByStaffAccount(staffAccountId: string): Promise<StaffTenantMembership[]> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_tenant_membership WHERE staff_account_id = $1 ORDER BY created_at ASC`,
      [staffAccountId],
    );
    return result.rows.map(mapRow);
  }

  async findByStaffAccountAndTenant(staffAccountId: string, tenantId: string): Promise<StaffTenantMembership | null> {
    const result = await this.db.query<StaffTenantMembershipRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2`,
      [staffAccountId, tenantId],
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
}
