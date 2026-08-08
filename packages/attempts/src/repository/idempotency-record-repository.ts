import type { Queryable } from "./types";

export type IdempotencyBeginOutcome =
  | { outcome: "NEW"; generation: number }
  | { outcome: "REOPENED"; generation: number }
  | { outcome: "DUPLICATE_SAME_PAYLOAD"; response: unknown }
  | { outcome: "CONFLICT_DIFFERENT_PAYLOAD" }
  | { outcome: "FAILED_TERMINAL"; response: unknown }
  | { outcome: "RETRY_TOO_SOON"; retryAfterSeconds: number };

export type IdempotencyFinishOutcome = { outcome: "COMMITTED" } | { outcome: "STALE_GENERATION" };

const RETRY_WINDOW_SECONDS = 30;
const DEFAULT_TTL_MINUTES = 15;

interface IdempotencyRecordRow {
  id: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  generation: number;
  response_json: unknown;
  request_hash: string;
  failure_retryable: boolean | null;
  created_at: Date;
  updated_at: Date;
  inserted_fresh: boolean;
}

/**
 * Generation-based optimistic-concurrency idempotency (07_15_01 v1.1 §10,
 * §11-bis.6; extended to staff write scopes by 02_35 §14 / migration
 * 0004). Semantic actions dedup via semantic_action_log's own unique
 * constraints, never through this table (AGENTS.md v4.30, one mechanism
 * per operation) — `scope` selects which of the CHECK-constrained
 * `idempotency_record.scope` values this call belongs to, but the
 * mechanism itself (single atomic `INSERT ... ON CONFLICT DO UPDATE ...
 * WHERE`) is shared unmodified across every scope. Postgres's own
 * row-level locking makes concurrent callers on the same key race safely;
 * at most one gets NEW/REOPENED per generation.
 */
export class IdempotencyRecordRepository {
  constructor(private readonly db: Queryable) {}

  async begin(input: {
    tenantId: string;
    scope: string;
    scopeKey: string;
    requestHash: string;
  }): Promise<IdempotencyBeginOutcome> {
    const upsert = await this.db.query<IdempotencyRecordRow>(
      `INSERT INTO idempotency_record (tenant_id, scope, scope_key, request_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, 'PENDING', now() + interval '${DEFAULT_TTL_MINUTES} minutes')
       ON CONFLICT (tenant_id, scope, scope_key) DO UPDATE
         SET status = 'PENDING', response_json = NULL, failure_retryable = NULL,
             generation = idempotency_record.generation + 1, updated_at = now(),
             expires_at = now() + interval '${DEFAULT_TTL_MINUTES} minutes'
         WHERE idempotency_record.status = 'FAILED'
           AND idempotency_record.failure_retryable = true
           AND idempotency_record.request_hash = EXCLUDED.request_hash
           AND idempotency_record.updated_at < now() - interval '${RETRY_WINDOW_SECONDS} seconds'
       RETURNING generation, (xmax = 0) AS inserted_fresh, status, response_json, request_hash, failure_retryable, created_at, updated_at, id`,
      [input.tenantId, input.scope, input.scopeKey, input.requestHash],
    );

    const [row] = upsert.rows;
    if (row) {
      return { outcome: row.inserted_fresh ? "NEW" : "REOPENED", generation: row.generation };
    }

    // The UPSERT's WHERE clause didn't match (no fresh insert, no reopen
    // eligible) — classify the existing row to produce the exact outcome.
    const existing = await this.db.query<IdempotencyRecordRow>(
      `SELECT id, status, generation, response_json, request_hash, failure_retryable, created_at, updated_at, false AS inserted_fresh
       FROM idempotency_record WHERE tenant_id = $1 AND scope = $2 AND scope_key = $3`,
      [input.tenantId, input.scope, input.scopeKey],
    );
    const [existingRow] = existing.rows;
    if (!existingRow) {
      throw new Error("idempotency_record: UPSERT produced no row and no existing row found (race condition)");
    }

    if (existingRow.request_hash !== input.requestHash) {
      return { outcome: "CONFLICT_DIFFERENT_PAYLOAD" };
    }
    if (existingRow.status === "COMPLETED") {
      return { outcome: "DUPLICATE_SAME_PAYLOAD", response: existingRow.response_json };
    }
    if (existingRow.status === "FAILED") {
      if (!existingRow.failure_retryable) {
        return { outcome: "FAILED_TERMINAL", response: existingRow.response_json };
      }
      const elapsedMs = Date.now() - new Date(existingRow.updated_at).getTime();
      const retryAfterSeconds = Math.max(0, RETRY_WINDOW_SECONDS - Math.floor(elapsedMs / 1000));
      return { outcome: "RETRY_TOO_SOON", retryAfterSeconds };
    }
    // status === 'PENDING' with matching hash: another request for the
    // exact same completion is already in flight under the current
    // generation — treat as "too soon to retry" (no distinct in-flight
    // outcome is defined; the caller should poll/backoff).
    return { outcome: "RETRY_TOO_SOON", retryAfterSeconds: RETRY_WINDOW_SECONDS };
  }

  async complete(input: {
    tenantId: string;
    scope: string;
    scopeKey: string;
    expectedGeneration: number;
    response: unknown;
  }): Promise<IdempotencyFinishOutcome> {
    const result = await this.db.query(
      `UPDATE idempotency_record
       SET status = 'COMPLETED', response_json = $5, failure_retryable = NULL, updated_at = now()
       WHERE tenant_id = $1 AND scope = $2 AND scope_key = $3
         AND status = 'PENDING' AND generation = $4
       RETURNING id`,
      [input.tenantId, input.scope, input.scopeKey, input.expectedGeneration, JSON.stringify(input.response)],
    );
    return result.rows.length > 0 ? { outcome: "COMMITTED" } : { outcome: "STALE_GENERATION" };
  }

  async fail(input: {
    tenantId: string;
    scope: string;
    scopeKey: string;
    expectedGeneration: number;
    retryable: boolean;
    response: unknown;
  }): Promise<IdempotencyFinishOutcome> {
    const result = await this.db.query(
      `UPDATE idempotency_record
       SET status = 'FAILED', response_json = $5, failure_retryable = $6, updated_at = now()
       WHERE tenant_id = $1 AND scope = $2 AND scope_key = $3
         AND status = 'PENDING' AND generation = $4
       RETURNING id`,
      [input.tenantId, input.scope, input.scopeKey, input.expectedGeneration, JSON.stringify(input.response), input.retryable],
    );
    return result.rows.length > 0 ? { outcome: "COMMITTED" } : { outcome: "STALE_GENERATION" };
  }
}
