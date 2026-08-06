import type { Queryable } from "../repository/types";

/**
 * FIXED_WINDOW rate limiting (AGENTS.md WEB-M1 baseline, rule 2; 02_26
 * §30.4): a single algorithm across 4 independent dimensions, backed by an
 * atomic Postgres upsert against `rate_limit_bucket`. The window boundary
 * is derived from wall-clock time, not from the first request in the
 * window — a deliberate FIXED_WINDOW (not sliding-window) trade-off.
 */
export interface RateLimitDimension {
  scope: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * D7 — binding thresholds, changing these requires the same authorization
 * as any other WEB-M1 security parameter. Declared with `satisfies`
 * (rather than a `Record<string, RateLimitDimension>` annotation) so each
 * named property keeps its own literal, non-optional type — a plain
 * `Record` index signature would make every access `T | undefined` under
 * `noUncheckedIndexedAccess`.
 */
export const RATE_LIMITS = {
  CLASS_CODE_RESOLVE_IP: { scope: "CLASS_CODE_RESOLVE_IP", limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  CLASS_CODE_RESOLVE_CODE: { scope: "CLASS_CODE_RESOLVE_CODE", limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  SESSION_START_IP: { scope: "SESSION_START_IP", limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  SESSION_START_ENROLLMENT: { scope: "SESSION_START_ENROLLMENT", limit: 5, windowMs: FIFTEEN_MINUTES_MS },
} satisfies Record<string, RateLimitDimension>;

export async function checkFixedWindow(
  db: Queryable,
  dimension: RateLimitDimension,
  bucketKey: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowStartMs = Math.floor(now.getTime() / dimension.windowMs) * dimension.windowMs;
  const windowStart = new Date(windowStartMs);
  const result = await db.query<{ count: number }>(
    `INSERT INTO rate_limit_bucket (scope, bucket_key, window_start, count, updated_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (scope, bucket_key, window_start)
     DO UPDATE SET count = rate_limit_bucket.count + 1, updated_at = now()
     RETURNING count`,
    [dimension.scope, bucketKey, windowStart],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error("rate_limit_bucket upsert returned no row");
  }
  const count = row.count;
  const windowEndMs = windowStartMs + dimension.windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - now.getTime()) / 1000));
  return {
    allowed: count <= dimension.limit,
    count,
    limit: dimension.limit,
    retryAfterSeconds,
  };
}
