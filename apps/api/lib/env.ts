import { decodeClassCodePepper } from "@quest-city-web/identity";

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
  /**
   * HMAC-SHA-256 key for class-code hashing (WEB-M1 Fase 2 correction #1).
   * Required in every environment — no default, ever. Decoded and length
   * checked (>= 32 bytes) by `loadEnv` itself, so a missing or too-short
   * pepper fails startup rather than surfacing later inside a request.
   */
  classCodeHashPepper: Buffer;
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

export function loadEnv(source: EnvSource = process.env): ApiEnv {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (see .env.example).");
  }
  const healthReadyDbTimeoutMs = parsePositiveInt(source, "HEALTH_READY_DB_TIMEOUT_MS", "2000");
  // 12h absolute / 60min inactivity (WEB-M1 Fase 2 correction report §5).
  const sessionAbsoluteTtlSeconds = parsePositiveInt(source, "SESSION_ABSOLUTE_TTL_SECONDS", String(12 * 60 * 60));
  const sessionInactivityTtlSeconds = parsePositiveInt(source, "SESSION_INACTIVITY_TTL_SECONDS", String(60 * 60));
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
  };
}
