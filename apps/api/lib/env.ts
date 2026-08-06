/**
 * Environment validation at startup (05_01 §11: "schema validation at
 * startup"). Fails fast and loud rather than letting a missing variable
 * surface as a confusing runtime error deep in a request handler.
 */
export interface ApiEnv {
  databaseUrl: string;
  databaseSsl: boolean;
  healthReadyDbTimeoutMs: number;
}

export type EnvSource = Record<string, string | undefined>;

export function loadEnv(source: EnvSource = process.env): ApiEnv {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (see .env.example).");
  }
  const timeoutRaw = source.HEALTH_READY_DB_TIMEOUT_MS ?? "2000";
  const healthReadyDbTimeoutMs = Number.parseInt(timeoutRaw, 10);
  if (Number.isNaN(healthReadyDbTimeoutMs) || healthReadyDbTimeoutMs <= 0) {
    throw new Error(`HEALTH_READY_DB_TIMEOUT_MS must be a positive integer, got: ${timeoutRaw}`);
  }
  return {
    databaseUrl,
    databaseSsl: source.DATABASE_SSL === "true",
    healthReadyDbTimeoutMs,
  };
}
