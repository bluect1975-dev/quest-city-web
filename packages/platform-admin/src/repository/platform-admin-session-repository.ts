import type { Queryable } from "./types";

export type PlatformAdminSessionRevokedReason =
  | "USER_LOGOUT"
  | "ROTATED"
  | "INACTIVITY_TIMEOUT"
  | "ABSOLUTE_EXPIRY"
  | "ADMIN_REVOKED"
  | "SECURITY_INCIDENT";

export interface PlatformAdminSession {
  id: string;
  staffAccountId: string;
  tokenHash: string;
  csrfTokenHash: string;
  createdAt: Date;
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  rotatedFrom: string | null;
  revokedAt: Date | null;
  revokedReason: PlatformAdminSessionRevokedReason | null;
}

interface PlatformAdminSessionRow {
  id: string;
  staff_account_id: string;
  token_hash: string;
  csrf_token_hash: string;
  created_at: Date;
  absolute_expires_at: Date;
  last_seen_at: Date;
  rotated_from: string | null;
  revoked_at: Date | null;
  revoked_reason: PlatformAdminSessionRevokedReason | null;
}

const SELECT_COLUMNS = `id, staff_account_id, token_hash, csrf_token_hash, created_at, absolute_expires_at,
       last_seen_at, rotated_from, revoked_at, revoked_reason`;

function mapRow(row: PlatformAdminSessionRow): PlatformAdminSession {
  return {
    id: row.id,
    staffAccountId: row.staff_account_id,
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
 * Own table, own cookie (`qc_platform_session`) -- never shared with
 * `staff_session` or `student_session` (same "never the same cookie,
 * never the same table" discipline as 02_35 §2.1/§4.4). No tenant_id:
 * platform-scoped for its entire lifetime.
 */
export class PlatformAdminSessionRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: {
    staffAccountId: string;
    tokenHash: string;
    csrfTokenHash: string;
    absoluteExpiresAt: Date;
    rotatedFrom?: string | null;
  }): Promise<PlatformAdminSession> {
    const result = await this.db.query<PlatformAdminSessionRow>(
      `INSERT INTO platform_admin_session (staff_account_id, token_hash, csrf_token_hash, absolute_expires_at, rotated_from)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SELECT_COLUMNS}`,
      [input.staffAccountId, input.tokenHash, input.csrfTokenHash, input.absoluteExpiresAt, input.rotatedFrom ?? null],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  async findByTokenHash(tokenHash: string): Promise<PlatformAdminSession | null> {
    const result = await this.db.query<PlatformAdminSessionRow>(
      `SELECT ${SELECT_COLUMNS} FROM platform_admin_session WHERE token_hash = $1`,
      [tokenHash],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Idempotent: revoking an already-revoked session leaves its original revoked_at/reason untouched. */
  async revoke(id: string, reason: PlatformAdminSessionRevokedReason): Promise<void> {
    await this.db.query(
      `UPDATE platform_admin_session SET revoked_at = now(), revoked_reason = $2
       WHERE id = $1 AND revoked_at IS NULL`,
      [id, reason],
    );
  }

  async touchLastSeen(id: string): Promise<void> {
    await this.db.query(`UPDATE platform_admin_session SET last_seen_at = now() WHERE id = $1`, [id]);
  }
}
