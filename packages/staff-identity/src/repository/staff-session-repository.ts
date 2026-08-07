import type { Queryable } from "./types";

export type StaffSessionRevokedReason =
  | "USER_LOGOUT"
  | "ROTATED"
  | "INACTIVITY_TIMEOUT"
  | "ABSOLUTE_EXPIRY"
  | "ADMIN_REVOKED"
  | "SECURITY_INCIDENT";

export interface StaffSession {
  id: string;
  staffAccountId: string;
  tenantId: string;
  staffTenantMembershipId: string;
  tokenHash: string;
  csrfTokenHash: string;
  createdAt: Date;
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  rotatedFrom: string | null;
  revokedAt: Date | null;
  revokedReason: StaffSessionRevokedReason | null;
}

interface StaffSessionRow {
  id: string;
  staff_account_id: string;
  tenant_id: string;
  staff_tenant_membership_id: string;
  token_hash: string;
  csrf_token_hash: string;
  created_at: Date;
  absolute_expires_at: Date;
  last_seen_at: Date;
  rotated_from: string | null;
  revoked_at: Date | null;
  revoked_reason: StaffSessionRevokedReason | null;
}

const SELECT_COLUMNS = `id, staff_account_id, tenant_id, staff_tenant_membership_id, token_hash, csrf_token_hash,
       created_at, absolute_expires_at, last_seen_at, rotated_from, revoked_at, revoked_reason`;

function mapRow(row: StaffSessionRow): StaffSession {
  return {
    id: row.id,
    staffAccountId: row.staff_account_id,
    tenantId: row.tenant_id,
    staffTenantMembershipId: row.staff_tenant_membership_id,
    tokenHash: row.token_hash,
    csrfTokenHash: row.csrf_token_hash,
    createdAt: row.created_at,
    absoluteExpiresAt: row.absolute_expires_at,
    lastSeenAt: row.last_seen_at,
    rotatedFrom: row.rotated_from,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

/**
 * Separate table from `student_session` (02_35 §2.1, §4.4) — same
 * security posture (HttpOnly/Secure/SameSite=Lax cookie, absolute +
 * inactivity TTL, rotation, revocation reasons) but never the same
 * cookie name or row. `staffTenantMembershipId`/`tenantId` are fixed at
 * creation and never change across a refresh/rotation.
 */
export class StaffSessionRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: {
    staffAccountId: string;
    tenantId: string;
    staffTenantMembershipId: string;
    tokenHash: string;
    csrfTokenHash: string;
    absoluteExpiresAt: Date;
    rotatedFrom?: string | null;
  }): Promise<StaffSession> {
    const result = await this.db.query<StaffSessionRow>(
      `INSERT INTO staff_session
         (staff_account_id, tenant_id, staff_tenant_membership_id, token_hash, csrf_token_hash, absolute_expires_at, rotated_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.staffAccountId,
        input.tenantId,
        input.staffTenantMembershipId,
        input.tokenHash,
        input.csrfTokenHash,
        input.absoluteExpiresAt,
        input.rotatedFrom ?? null,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** Looked up by hash only — the caller (StaffAuthService) evaluates expiry/revocation state. */
  async findByTokenHash(tokenHash: string): Promise<StaffSession | null> {
    const result = await this.db.query<StaffSessionRow>(`SELECT ${SELECT_COLUMNS} FROM staff_session WHERE token_hash = $1`, [
      tokenHash,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findById(id: string, tenantId: string): Promise<StaffSession | null> {
    const result = await this.db.query<StaffSessionRow>(
      `SELECT ${SELECT_COLUMNS} FROM staff_session WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Idempotent: revoking an already-revoked session leaves its original revoked_at/reason untouched. */
  async revoke(id: string, tenantId: string, reason: StaffSessionRevokedReason): Promise<void> {
    await this.db.query(
      `UPDATE staff_session SET revoked_at = now(), revoked_reason = $3
       WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
      [id, tenantId, reason],
    );
  }

  async touchLastSeen(id: string, tenantId: string): Promise<void> {
    await this.db.query(`UPDATE staff_session SET last_seen_at = now() WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  }
}
