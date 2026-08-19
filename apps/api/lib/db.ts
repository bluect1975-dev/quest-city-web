import { Pool } from "pg";
import { loadEnv } from "./env";

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: true } : undefined,
      max: env.dbPoolHealthMax,
      idleTimeoutMillis: env.dbPoolHealthIdleTimeoutMs,
      connectionTimeoutMillis: env.healthReadyDbTimeoutMs,
    });
  }
  return pool;
}

/**
 * Readiness-probe query only. This never becomes a domain data-access
 * layer here — apps/api's WEB-M0 scope is health checking, not the shared
 * Platform API's business logic (02_25 §4 service modules stay
 * IMPLEMENT_LATER, consumed rather than duplicated).
 */
export async function checkDatabaseReachable(): Promise<{ ok: true } | { ok: false; error: string }> {
  const env = loadEnv();
  const client = getPool();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("database readiness check timed out")), env.healthReadyDbTimeoutMs);
  });
  try {
    await Promise.race([client.query("SELECT 1"), timeout]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
