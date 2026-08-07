import type { Queryable } from "./types";

export type SessionRevokedReason =
  | "USER_LOGOUT"
  | "ROTATED"
  | "INACTIVITY_TIMEOUT"
  | "ABSOLUTE_EXPIRY"
  | "ADMIN_REVOKED"
  | "SECURITY_INCIDENT";

export interface StudentSession {
  id: string;
  tenantId: string;
  studentProfileId: string;
  enrollmentId: string;
  tokenHash: string;
  csrfTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  rotatedFrom: string | null;
  revokedAt: Date | null;
  revokedReason: SessionRevokedReason | null;
}

interface StudentSessionRow {
  id: string;
  tenant_id: string;
  student_profile_id: string;
  enrollment_id: string;
  token_hash: string;
  csrf_token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_seen_at: Date;
  rotated_from: string | null;
  revoked_at: Date | null;
  revoked_reason: SessionRevokedReason | null;
}

const SELECT_COLUMNS = `id, tenant_id, student_profile_id, enrollment_id, token_hash, csrf_token_hash,
       created_at, expires_at, last_seen_at, rotated_from, revoked_at, revoked_reason`;

function mapSession(row: StudentSessionRow): StudentSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentProfileId: row.student_profile_id,
    enrollmentId: row.enrollment_id,
    tokenHash: row.token_hash,
    csrfTokenHash: row.csrf_token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    rotatedFrom: row.rotated_from,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

export class StudentSessionRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: {
    tenantId: string;
    studentProfileId: string;
    enrollmentId: string;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: Date;
    rotatedFrom?: string | null;
  }): Promise<StudentSession> {
    const result = await this.db.query<StudentSessionRow>(
      `INSERT INTO student_session
         (tenant_id, student_profile_id, enrollment_id, token_hash, csrf_token_hash, expires_at, rotated_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenantId,
        input.studentProfileId,
        input.enrollmentId,
        input.tokenHash,
        input.csrfTokenHash,
        input.expiresAt,
        input.rotatedFrom ?? null,
      ],
    );
    const [row] = result.rows;
    if (!row) {
      throw new Error("INSERT ... RETURNING produced no row");
    }
    return mapSession(row);
  }

  /** Looked up by hash only — the caller (SessionService) evaluates expiry/revocation state. */
  async findByTokenHash(tokenHash: string): Promise<StudentSession | null> {
    const result = await this.db.query<StudentSessionRow>(
      `SELECT ${SELECT_COLUMNS} FROM student_session WHERE token_hash = $1`,
      [tokenHash],
    );
    const [row] = result.rows;
    return row ? mapSession(row) : null;
  }

  async findById(id: string, tenantId: string): Promise<StudentSession | null> {
    const result = await this.db.query<StudentSessionRow>(
      `SELECT ${SELECT_COLUMNS} FROM student_session WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapSession(row) : null;
  }

  /** Idempotent: revoking an already-revoked session leaves its original revoked_at/reason untouched. */
  async revoke(id: string, tenantId: string, reason: SessionRevokedReason): Promise<void> {
    await this.db.query(
      `UPDATE student_session SET revoked_at = now(), revoked_reason = $3
       WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
      [id, tenantId, reason],
    );
  }

  async touchLastSeen(id: string, tenantId: string): Promise<void> {
    await this.db.query(`UPDATE student_session SET last_seen_at = now() WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  }
}
