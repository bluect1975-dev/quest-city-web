import type { Queryable } from "./types";

export interface StaffInvitation {
  id: string;
  staffTenantMembershipId: string;
  tenantId: string;
  tokenHash: string;
  issuedByStaffAccountId: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

interface StaffInvitationRow {
  id: string;
  staff_tenant_membership_id: string;
  tenant_id: string;
  token_hash: string;
  issued_by_staff_account_id: string;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  revoked_at: Date | null;
}

const SELECT_COLUMNS = `id, staff_tenant_membership_id, tenant_id, token_hash, issued_by_staff_account_id,
       created_at, expires_at, consumed_at, revoked_at`;

function mapRow(row: StaffInvitationRow): StaffInvitation {
  return {
    id: row.id,
    staffTenantMembershipId: row.staff_tenant_membership_id,
    tenantId: row.tenant_id,
    tokenHash: row.token_hash,
    issuedByStaffAccountId: row.issued_by_staff_account_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * `staff_invitation` (02_35 v1.2 §11bis.3, migration 0008): one-time,
 * hashed-only token bound to a `staff_tenant_membership` row. A re-invite
 * (REVOKED -> INVITED) always creates a fresh row rather than reusing an
 * old, already-consumed/revoked one — the membership row is what's
 * reused, never the invitation.
 */
export class StaffInvitationRepository {
  constructor(private readonly db: Queryable) {}

  async findByTokenHash(tokenHash: string): Promise<StaffInvitation | null> {
    const result = await this.db.query<StaffInvitationRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_invitation WHERE token_hash = $1`,
      [tokenHash],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** The current outstanding (not consumed, not revoked) invitation for a membership, if any — used for the INVITATION_ALREADY_PENDING dedup check. */
  async findPendingByMembership(staffTenantMembershipId: string, tenantId: string): Promise<StaffInvitation | null> {
    const result = await this.db.query<StaffInvitationRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_invitation
       WHERE staff_tenant_membership_id = $1 AND tenant_id = $2
         AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [staffTenantMembershipId, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async create(input: {
    staffTenantMembershipId: string;
    tenantId: string;
    tokenHash: string;
    issuedByStaffAccountId: string;
    expiresAt: Date;
  }): Promise<StaffInvitation> {
    const result = await this.db.query<StaffInvitationRow>(
      `INSERT INTO staff_invitation (staff_tenant_membership_id, tenant_id, token_hash, issued_by_staff_account_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SELECT_COLUMNS}`,
      [input.staffTenantMembershipId, input.tenantId, input.tokenHash, input.issuedByStaffAccountId, input.expiresAt],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** One-time consumption — idempotent no-op if already consumed (caller distinguishes via the returned row's consumedAt). */
  async consume(id: string, tenantId: string): Promise<StaffInvitation | null> {
    const result = await this.db.query<StaffInvitationRow>(
      `UPDATE staff_invitation SET consumed_at = now()
       WHERE id = $1 AND tenant_id = $2 AND consumed_at IS NULL AND revoked_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId],
    );
    const [updated] = result.rows;
    if (updated) return mapRow(updated);
    return this.findById(id, tenantId);
  }

  async findById(id: string, tenantId: string): Promise<StaffInvitation | null> {
    const result = await this.db.query<StaffInvitationRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_invitation WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Idempotent: revoking an already-revoked or already-consumed invitation leaves it unchanged. */
  async revoke(id: string, tenantId: string): Promise<void> {
    await this.db.query(
      `UPDATE staff_invitation SET revoked_at = now()
       WHERE id = $1 AND tenant_id = $2 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [id, tenantId],
    );
  }
}
