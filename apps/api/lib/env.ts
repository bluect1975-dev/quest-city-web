import { decodeClassCodePepper } from "@quest-city-web/identity";
import { decodeExternalMonitorHmacSecret } from "@quest-city-web/operations";

/**
 * Environment validation at startup (05_01 §11: "schema validation at
 * startup"). Fails fast and loud rather than letting a missing variable
 * surface as a confusing runtime error deep in a request handler.
 */
export interface ApiEnv {
  databaseUrl: string;
  databaseSsl: boolean;
  healthReadyDbTimeoutMs: number;
  nodeEnv: string;
  sessionCookieName: string;
  sessionAbsoluteTtlSeconds: number;
  sessionInactivityTtlSeconds: number;
  /**
   * WEB-M1 Fase 2 correction report §6: honored ONLY when nodeEnv ===
   * "development" (allow-list, not a deny-list of just "production") —
   * staging and production always get a Secure cookie regardless of this
   * variable's value.
   */
  sessionCookieSecureOverrideInsecureLocal: boolean;
  /** Origins allowed to perform mutating web-auth requests (CSRF Origin check, AGENTS.md WEB-M1 baseline rule 1). */
  webAuthTrustedOrigins: string[];
  /** WEB-M3B (02_35 §4.4): distinct cookie name from `sessionCookieName` — never the same cookie or table as the student session. */
  staffSessionCookieName: string;
  staffSessionAbsoluteTtlSeconds: number;
  staffSessionInactivityTtlSeconds: number;
  /** Origins allowed to perform mutating staff-auth/dashboard requests — separate list from `webAuthTrustedOrigins` since `apps/dashboard` runs on its own origin. */
  staffAuthTrustedOrigins: string[];
  /** School Pilot Readiness Tranche A (02_38 §4.1, §20 "riusa staff_account"): distinct cookie name from `staffSessionCookieName`, never the same cookie or table as staff/student sessions. */
  platformSessionCookieName: string;
  platformSessionAbsoluteTtlSeconds: number;
  platformSessionInactivityTtlSeconds: number;
  /** Origins allowed to perform mutating platform-admin requests — separate list, since the Platform Admin surface may run on its own origin/app. */
  platformAuthTrustedOrigins: string[];
  /**
   * HMAC-SHA-256 key for class-code hashing (WEB-M1 Fase 2 correction #1).
   * Required in every environment — no default, ever. Decoded and length
   * checked (>= 32 bytes) by `loadEnv` itself, so a missing or too-short
   * pepper fails startup rather than surfacing later inside a request.
   */
  classCodeHashPepper: Buffer;
  /**
   * Per-pool connection tuning (07_06 §12 "connection pooling quando
   * necessario"; Tranche E design report §19). Defaults reproduce exactly
   * what every pool already did before these variables existed — health
   * pool max=5, all other pools max=10, idleTimeoutMillis unset (which is
   * node-postgres's own built-in default of 10000ms, already applying
   * implicitly), connectionTimeoutMillis unset (pg's own "wait
   * indefinitely" default of 0) for every pool except the health pool,
   * which already used `healthReadyDbTimeoutMs`. Leaving these variables
   * unset therefore changes nothing for local dev or CI. Staging overrides
   * them via environment variables (see docker-compose.staging.yml) —
   * never by editing these defaults.
   */
  dbPoolHealthMax: number;
  dbPoolHealthIdleTimeoutMs: number;
  dbPoolAttemptsMax: number;
  dbPoolAttemptsIdleTimeoutMs: number;
  dbPoolAttemptsConnectionTimeoutMs: number;
  dbPoolIdentityMax: number;
  dbPoolIdentityIdleTimeoutMs: number;
  dbPoolIdentityConnectionTimeoutMs: number;
  dbPoolStaffIdentityMax: number;
  dbPoolStaffIdentityIdleTimeoutMs: number;
  dbPoolStaffIdentityConnectionTimeoutMs: number;
  dbPoolPlatformIdentityMax: number;
  dbPoolPlatformIdentityIdleTimeoutMs: number;
  dbPoolPlatformIdentityConnectionTimeoutMs: number;
  /**
   * Tranche E2 out-of-band external monitoring, Level 2 (02_42 v1.2 PARTE
   * U §53-54, AGENTS.md §4.31 rule 3). Optional, same "falls back
   * gracefully when unconfigured" posture as `TELEGRAM_BOT_TOKEN` (never a
   * hard startup failure like `classCodeHashPepper`) -- when unset, no
   * `external_monitor_key_metadata` row can ever verify against a real
   * secret, so `POST /platform/operations/external-monitor-report`
   * uniformly fails closed with EXTERNAL_MONITOR_AUTH_INVALID rather than
   * blocking every other route from starting. Two independent slots (not
   * one) so a CURRENT/PREVIOUS rotation overlap window (§54) can hold two
   * simultaneously valid secret values without ever storing either in the
   * database -- `external_monitor_key_metadata` carries only key-id
   * status metadata, never the secret bytes themselves. When set, each is
   * decoded/length-checked exactly like `classCodeHashPepper` (fail fast
   * on a malformed value, never on mere absence).
   */
  externalMonitorHmacSecretCurrent: Buffer | null;
  externalMonitorHmacSecretPrevious: Buffer | null;
}

export type EnvSource = Record<string, string | undefined>;

function parsePositiveInt(source: EnvSource, key: string, fallback: string): number {
  const raw = source[key] ?? fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer, got: ${raw}`);
  }
  return value;
}

/** Like `parsePositiveInt`, but 0 is valid — used for timeouts where 0 legitimately means "no timeout" (pg's own default). */
function parseNonNegativeInt(source: EnvSource, key: string, fallback: string): number {
  const raw = source[key] ?? fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer, got: ${raw}`);
  }
  return value;
}

export function loadEnv(source: EnvSource = process.env): ApiEnv {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (see .env.example).");
  }
  const healthReadyDbTimeoutMs = parsePositiveInt(source, "HEALTH_READY_DB_TIMEOUT_MS", "2000");
  // 12h absolute / 60min inactivity (WEB-M1 Fase 2 correction report §5).
  const sessionAbsoluteTtlSeconds = parsePositiveInt(source, "SESSION_ABSOLUTE_TTL_SECONDS", String(12 * 60 * 60));
  const sessionInactivityTtlSeconds = parsePositiveInt(source, "SESSION_INACTIVITY_TTL_SECONDS", String(60 * 60));
  // WEB-M3B (02_35 §4.4): 12h absolute / 60min inactivity — same baseline
  // values as the student session, independently configurable.
  const staffSessionAbsoluteTtlSeconds = parsePositiveInt(source, "STAFF_SESSION_ABSOLUTE_TTL_SECONDS", String(12 * 60 * 60));
  const staffSessionInactivityTtlSeconds = parsePositiveInt(source, "STAFF_SESSION_INACTIVITY_TTL_SECONDS", String(60 * 60));
  // School Pilot Readiness Tranche A: same 12h absolute / 60min inactivity baseline, independently configurable.
  const platformSessionAbsoluteTtlSeconds = parsePositiveInt(source, "PLATFORM_SESSION_ABSOLUTE_TTL_SECONDS", String(12 * 60 * 60));
  const platformSessionInactivityTtlSeconds = parsePositiveInt(source, "PLATFORM_SESSION_INACTIVITY_TTL_SECONDS", String(60 * 60));
  const dbPoolHealthMax = parsePositiveInt(source, "DB_POOL_HEALTH_MAX", "5");
  const dbPoolHealthIdleTimeoutMs = parseNonNegativeInt(source, "DB_POOL_HEALTH_IDLE_TIMEOUT_MS", "10000");
  const dbPoolAttemptsMax = parsePositiveInt(source, "DB_POOL_ATTEMPTS_MAX", "10");
  const dbPoolAttemptsIdleTimeoutMs = parseNonNegativeInt(source, "DB_POOL_ATTEMPTS_IDLE_TIMEOUT_MS", "10000");
  const dbPoolAttemptsConnectionTimeoutMs = parseNonNegativeInt(source, "DB_POOL_ATTEMPTS_CONNECTION_TIMEOUT_MS", "0");
  const dbPoolIdentityMax = parsePositiveInt(source, "DB_POOL_IDENTITY_MAX", "10");
  const dbPoolIdentityIdleTimeoutMs = parseNonNegativeInt(source, "DB_POOL_IDENTITY_IDLE_TIMEOUT_MS", "10000");
  const dbPoolIdentityConnectionTimeoutMs = parseNonNegativeInt(source, "DB_POOL_IDENTITY_CONNECTION_TIMEOUT_MS", "0");
  const dbPoolStaffIdentityMax = parsePositiveInt(source, "DB_POOL_STAFF_IDENTITY_MAX", "10");
  const dbPoolStaffIdentityIdleTimeoutMs = parseNonNegativeInt(source, "DB_POOL_STAFF_IDENTITY_IDLE_TIMEOUT_MS", "10000");
  const dbPoolStaffIdentityConnectionTimeoutMs = parseNonNegativeInt(
    source,
    "DB_POOL_STAFF_IDENTITY_CONNECTION_TIMEOUT_MS",
    "0",
  );
  const dbPoolPlatformIdentityMax = parsePositiveInt(source, "DB_POOL_PLATFORM_IDENTITY_MAX", "10");
  const dbPoolPlatformIdentityIdleTimeoutMs = parseNonNegativeInt(
    source,
    "DB_POOL_PLATFORM_IDENTITY_IDLE_TIMEOUT_MS",
    "10000",
  );
  const dbPoolPlatformIdentityConnectionTimeoutMs = parseNonNegativeInt(
    source,
    "DB_POOL_PLATFORM_IDENTITY_CONNECTION_TIMEOUT_MS",
    "0",
  );
  const nodeEnv = source.NODE_ENV ?? "development";
  const sessionCookieSecureOverrideInsecureLocal =
    nodeEnv === "development" && source.SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL === "true";

  // Required in every environment, no default, ever (WEB-M1 Fase 2
  // correction #1) — the underlying error from decodeClassCodePepper
  // never includes the raw value, only lengths/config names, so it is
  // always safe to let this propagate into a log.
  let classCodeHashPepper: Buffer;
  try {
    classCodeHashPepper = decodeClassCodePepper(source.CLASS_CODE_HASH_PEPPER);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail} Set CLASS_CODE_HASH_PEPPER (see .env.example) — there is no default value.`);
  }

  // Optional -- absence disables the endpoint's ability to ever verify a
  // signature (fails closed per-request, not at startup). A malformed
  // *present* value still fails startup loudly, same as classCodeHashPepper.
  function decodeOptionalExternalMonitorSecret(envVarName: string, value: string | undefined): Buffer | null {
    if (!value || value.length === 0) return null;
    try {
      return decodeExternalMonitorHmacSecret(value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${detail} (${envVarName})`);
    }
  }
  const externalMonitorHmacSecretCurrent = decodeOptionalExternalMonitorSecret(
    "EXTERNAL_MONITOR_HMAC_SECRET_CURRENT",
    source.EXTERNAL_MONITOR_HMAC_SECRET_CURRENT,
  );
  const externalMonitorHmacSecretPrevious = decodeOptionalExternalMonitorSecret(
    "EXTERNAL_MONITOR_HMAC_SECRET_PREVIOUS",
    source.EXTERNAL_MONITOR_HMAC_SECRET_PREVIOUS,
  );

  return {
    databaseUrl,
    databaseSsl: source.DATABASE_SSL === "true",
    healthReadyDbTimeoutMs,
    nodeEnv,
    sessionCookieName: source.SESSION_COOKIE_NAME ?? "qc_web_session",
    sessionAbsoluteTtlSeconds,
    sessionInactivityTtlSeconds,
    sessionCookieSecureOverrideInsecureLocal,
    webAuthTrustedOrigins: (source.WEB_AUTH_TRUSTED_ORIGINS ?? "http://localhost:3000,http://localhost:8080")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    classCodeHashPepper,
    staffSessionCookieName: source.STAFF_SESSION_COOKIE_NAME ?? "qc_staff_session",
    staffSessionAbsoluteTtlSeconds,
    staffSessionInactivityTtlSeconds,
    staffAuthTrustedOrigins: (source.STAFF_AUTH_TRUSTED_ORIGINS ?? "http://localhost:3001,http://localhost:8080")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    platformSessionCookieName: source.PLATFORM_SESSION_COOKIE_NAME ?? "qc_platform_session",
    platformSessionAbsoluteTtlSeconds,
    platformSessionInactivityTtlSeconds,
    platformAuthTrustedOrigins: (source.PLATFORM_AUTH_TRUSTED_ORIGINS ?? "http://localhost:3002,http://localhost:8080")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    dbPoolHealthMax,
    dbPoolHealthIdleTimeoutMs,
    dbPoolAttemptsMax,
    dbPoolAttemptsIdleTimeoutMs,
    dbPoolAttemptsConnectionTimeoutMs,
    dbPoolIdentityMax,
    dbPoolIdentityIdleTimeoutMs,
    dbPoolIdentityConnectionTimeoutMs,
    dbPoolStaffIdentityMax,
    dbPoolStaffIdentityIdleTimeoutMs,
    dbPoolStaffIdentityConnectionTimeoutMs,
    dbPoolPlatformIdentityMax,
    dbPoolPlatformIdentityIdleTimeoutMs,
    dbPoolPlatformIdentityConnectionTimeoutMs,
    externalMonitorHmacSecretCurrent,
    externalMonitorHmacSecretPrevious,
  };
}
