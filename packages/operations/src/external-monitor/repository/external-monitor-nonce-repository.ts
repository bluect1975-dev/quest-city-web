import type { Queryable } from "../../repository/types";

/**
 * Protocol-level replay protection (02_42 v1.2 §59.A), distinct from API
 * idempotency (§59.B, handled via `idempotency_record` + `observationId`
 * in the report service) and from incident dedup (§59.C, unchanged
 * `(type, service, source)`). The composite primary key `(key_id, nonce)`
 * on `external_monitor_nonce_seen` is the actual race-safety mechanism --
 * `recordIfNew` below is race-safe by construction (a single atomic
 * `INSERT ... ON CONFLICT DO NOTHING`, never a separate SELECT-then-INSERT
 * that a concurrent request could interleave with).
 */
export class ExternalMonitorNonceRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Attempts to record (keyId, nonce) as seen. Returns `true` if this is
   * the first time this pair has been seen (request may proceed), `false`
   * if it was already recorded (EXTERNAL_MONITOR_REPLAY_DETECTED, 02_42
   * §53.4 check 3, §59.A) -- regardless of body content, per contract.
   */
  async recordIfNew(keyId: string, nonce: string): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO external_monitor_nonce_seen (key_id, nonce) VALUES ($1, $2)
       ON CONFLICT (key_id, nonce) DO NOTHING
       RETURNING key_id`,
      [keyId, nonce],
    );
    return result.rows.length > 0;
  }

  /** Bounded-retention purge (02_42 §59.A pilot reference: 10 minutes) -- outside request-handling scope, invoked by a periodic job/tool, never by the request path itself. */
  async purgeOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db.query(`DELETE FROM external_monitor_nonce_seen WHERE seen_at < $1`, [cutoff]);
    return result.rowCount ?? 0;
  }
}
