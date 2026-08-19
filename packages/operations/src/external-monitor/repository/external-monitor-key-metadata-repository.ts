import type { Queryable } from "../../repository/types";

export type ExternalMonitorKeyStatus = "CURRENT" | "PREVIOUS" | "REVOKED";

export interface ExternalMonitorKeyMetadata {
  id: string;
  keyId: string;
  status: ExternalMonitorKeyStatus;
  createdAt: Date;
  activatedAt: Date | null;
  revokedAt: Date | null;
  createdBy: string | null;
}

interface ExternalMonitorKeyMetadataRow {
  id: string;
  key_id: string;
  status: ExternalMonitorKeyStatus;
  created_at: Date;
  activated_at: Date | null;
  revoked_at: Date | null;
  created_by: string | null;
}

const SELECT_COLUMNS = `id, key_id, status, created_at, activated_at, revoked_at, created_by`;

function mapRow(row: ExternalMonitorKeyMetadataRow): ExternalMonitorKeyMetadata {
  return {
    id: row.id,
    keyId: row.key_id,
    status: row.status,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    revokedAt: row.revoked_at,
    createdBy: row.created_by,
  };
}

/**
 * Secret rotation metadata (02_42 v1.2 §54) -- NEVER the
 * EXTERNAL_MONITOR_HMAC_SECRET value itself, only key-id/lifecycle
 * bookkeeping. `findVerifiable` is the hot path used by every incoming
 * request (§53.4 check 1: keyId must resolve to CURRENT or PREVIOUS, not
 * REVOKED or unknown) -- a single indexed lookup by key_id.
 */
export class ExternalMonitorKeyMetadataRepository {
  constructor(private readonly db: Queryable) {}

  /** Returns the row only if status is CURRENT or PREVIOUS (§53.4 check 1) -- REVOKED/unknown both surface as null to the caller. */
  async findVerifiable(keyId: string): Promise<ExternalMonitorKeyMetadata | null> {
    const result = await this.db.query<ExternalMonitorKeyMetadataRow>(
      `SELECT ${SELECT_COLUMNS} FROM external_monitor_key_metadata WHERE key_id = $1 AND status IN ('CURRENT', 'PREVIOUS')`,
      [keyId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findByKeyId(keyId: string): Promise<ExternalMonitorKeyMetadata | null> {
    const result = await this.db.query<ExternalMonitorKeyMetadataRow>(
      `SELECT ${SELECT_COLUMNS} FROM external_monitor_key_metadata WHERE key_id = $1`,
      [keyId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findCurrent(): Promise<ExternalMonitorKeyMetadata | null> {
    const result = await this.db.query<ExternalMonitorKeyMetadataRow>(
      `SELECT ${SELECT_COLUMNS} FROM external_monitor_key_metadata WHERE status = 'CURRENT'`,
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async list(): Promise<ExternalMonitorKeyMetadata[]> {
    const result = await this.db.query<ExternalMonitorKeyMetadataRow>(
      `SELECT ${SELECT_COLUMNS} FROM external_monitor_key_metadata ORDER BY created_at DESC`,
    );
    return result.rows.map(mapRow);
  }

  /**
   * Rotation (02_42 §54 steps 3-4): demotes the current CURRENT row (if
   * any) to PREVIOUS and inserts the new CURRENT row, atomically within
   * the caller's transaction -- the partial unique index
   * `external_monitor_key_metadata_single_current_idx` backstops "at most
   * one CURRENT" even if this method is ever called outside a
   * transaction. Never touches the secret value itself.
   */
  async rotateIn(keyId: string, createdBy: string | null): Promise<ExternalMonitorKeyMetadata> {
    await this.db.query(
      `UPDATE external_monitor_key_metadata SET status = 'PREVIOUS' WHERE status = 'CURRENT'`,
    );
    const result = await this.db.query<ExternalMonitorKeyMetadataRow>(
      `INSERT INTO external_monitor_key_metadata (key_id, status, activated_at, created_by)
       VALUES ($1, 'CURRENT', now(), $2)
       RETURNING ${SELECT_COLUMNS}`,
      [keyId, createdBy],
    );
    const [row] = result.rows;
    if (!row) throw new Error("rotateIn: INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** Ends the overlap window (02_42 §54 step 5): PREVIOUS -> REVOKED. From that moment the keyId always fails auth (EXTERNAL_MONITOR_AUTH_INVALID). */
  async revoke(keyId: string): Promise<ExternalMonitorKeyMetadata | null> {
    const result = await this.db.query<ExternalMonitorKeyMetadataRow>(
      `UPDATE external_monitor_key_metadata
       SET status = 'REVOKED', revoked_at = now()
       WHERE key_id = $1 AND status IN ('CURRENT', 'PREVIOUS')
       RETURNING ${SELECT_COLUMNS}`,
      [keyId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
