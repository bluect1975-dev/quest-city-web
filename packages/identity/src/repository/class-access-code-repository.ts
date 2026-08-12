import type { Queryable } from "./types";

export type ClassAccessCodeStatus = "ACTIVE" | "REVOKED";

export interface ClassAccessCode {
  id: string;
  tenantId: string;
  classId: string;
  codeHash: string;
  status: ClassAccessCodeStatus;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

interface ClassAccessCodeRow {
  id: string;
  tenant_id: string;
  class_id: string;
  code_hash: string;
  status: ClassAccessCodeStatus;
  expires_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
}

function mapCode(row: ClassAccessCodeRow): ClassAccessCode {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    classId: row.class_id,
    codeHash: row.code_hash,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export class ClassAccessCodeRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Looks up an ACTIVE code by its hash only — the caller decides whether
   * an expired `expires_at` still counts as usable (uniform
   * CLASS_CODE_INVALID is returned by the service layer for every cause,
   * per 02_26 §30.2).
   */
  async findActiveByCodeHash(codeHash: string): Promise<ClassAccessCode | null> {
    const result = await this.db.query<ClassAccessCodeRow>(
      `SELECT id, tenant_id, class_id, code_hash, status, expires_at, created_at, revoked_at
       FROM class_access_code WHERE code_hash = $1 AND status = 'ACTIVE'`,
      [codeHash],
    );
    const [row] = result.rows;
    return row ? mapCode(row) : null;
  }

  /**
   * The current ACTIVE code for a class, if any (02_25 §6.11: at most one
   * ACTIVE row per class, enforced at the service layer by revoking this
   * row, inside the same transaction, before inserting a replacement).
   */
  async findActiveByClassId(classId: string, tenantId: string): Promise<ClassAccessCode | null> {
    const result = await this.db.query<ClassAccessCodeRow>(
      `SELECT id, tenant_id, class_id, code_hash, status, expires_at, created_at, revoked_at
       FROM class_access_code WHERE class_id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
      [classId, tenantId],
    );
    const [row] = result.rows;
    return row ? mapCode(row) : null;
  }

  async create(input: { tenantId: string; classId: string; codeHash: string; expiresAt: Date | null }): Promise<ClassAccessCode> {
    const result = await this.db.query<ClassAccessCodeRow>(
      `INSERT INTO class_access_code (tenant_id, class_id, code_hash, status, expires_at)
       VALUES ($1, $2, $3, 'ACTIVE', $4)
       RETURNING id, tenant_id, class_id, code_hash, status, expires_at, created_at, revoked_at`,
      [input.tenantId, input.classId, input.codeHash, input.expiresAt],
    );
    const [row] = result.rows;
    if (!row) {
      throw new Error("INSERT ... RETURNING produced no row");
    }
    return mapCode(row);
  }

  async revoke(id: string, tenantId: string): Promise<void> {
    await this.db.query(
      `UPDATE class_access_code SET status = 'REVOKED', revoked_at = now() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
  }
}
