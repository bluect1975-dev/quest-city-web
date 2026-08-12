import type { Queryable } from "./types";

export type PlatformAdminGrantStatus = "ACTIVE" | "SUSPENDED";
export type PlatformAdminGrantedByActorType = "ADMIN_BOOTSTRAP_SCRIPT" | "PLATFORM_ADMIN";

export const CAPABILITIES = [
  "tenant.create",
  "tenant.read",
  "tenant.suspend",
  "school_admin.activate",
  "audit.read.global",
  "independent_educator.activate",
  "independent_educator.read",
  "independent_educator.status.manage",
] as const;

/** `Capability` is a closed union matching the DB CHECK on `capability_grant.capability` exactly (migration 0006). */
export type Capability = (typeof CAPABILITIES)[number];

export interface PlatformAdminGrant {
  id: string;
  staffAccountId: string;
  status: PlatformAdminGrantStatus;
  grantedByActorType: PlatformAdminGrantedByActorType;
  grantedByActorId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PlatformAdminGrantRow {
  id: string;
  staff_account_id: string;
  status: PlatformAdminGrantStatus;
  granted_by_actor_type: PlatformAdminGrantedByActorType;
  granted_by_actor_id: string;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `id, staff_account_id, status, granted_by_actor_type, granted_by_actor_id, created_at, updated_at`;

function mapRow(row: PlatformAdminGrantRow): PlatformAdminGrant {
  return {
    id: row.id,
    staffAccountId: row.staff_account_id,
    status: row.status,
    grantedByActorType: row.granted_by_actor_type,
    grantedByActorId: row.granted_by_actor_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * One row per platform-admin-standing `staff_account` (UNIQUE
 * staff_account_id, migration 0006) -- re-suspension/reactivation always
 * updates this single row, never inserts a second one, preserving ONE
 * HUMAN -> ONE PLATFORM IDENTITY (02_38 §9) at this layer too.
 */
export class PlatformAdminGrantRepository {
  constructor(private readonly db: Queryable) {}

  async findByStaffAccountId(staffAccountId: string): Promise<PlatformAdminGrant | null> {
    const result = await this.db.query<PlatformAdminGrantRow>(
      `SELECT ${SELECT_COLUMNS} FROM platform_admin_grant WHERE staff_account_id = $1`,
      [staffAccountId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Administrative provisioning only -- no public self-registration path exists for platform admin standing (02_38 §4.1). */
  async create(input: {
    staffAccountId: string;
    status: PlatformAdminGrantStatus;
    grantedByActorType: PlatformAdminGrantedByActorType;
    grantedByActorId: string;
  }): Promise<PlatformAdminGrant> {
    const result = await this.db.query<PlatformAdminGrantRow>(
      `INSERT INTO platform_admin_grant (staff_account_id, status, granted_by_actor_type, granted_by_actor_id)
       VALUES ($1, $2, $3, $4)
       RETURNING ${SELECT_COLUMNS}`,
      [input.staffAccountId, input.status, input.grantedByActorType, input.grantedByActorId],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  async listCapabilities(platformAdminGrantId: string): Promise<Capability[]> {
    const result = await this.db.query<{ capability: Capability }>(
      `SELECT capability FROM capability_grant WHERE platform_admin_grant_id = $1`,
      [platformAdminGrantId],
    );
    return result.rows.map((row) => row.capability);
  }

  /** Idempotent: re-granting an already-granted capability is a no-op (UNIQUE(platform_admin_grant_id, capability)). */
  async grantCapability(platformAdminGrantId: string, capability: Capability): Promise<void> {
    await this.db.query(
      `INSERT INTO capability_grant (platform_admin_grant_id, capability) VALUES ($1, $2)
       ON CONFLICT (platform_admin_grant_id, capability) DO NOTHING`,
      [platformAdminGrantId, capability],
    );
  }
}
