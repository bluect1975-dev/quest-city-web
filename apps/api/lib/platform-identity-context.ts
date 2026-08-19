import { Pool } from "pg";
import {
  PlatformAuthService,
  TenantProvisioningService,
  TenantStatusService,
  SchoolAdminActivationService,
  IndependentEducatorActivationService,
  IndependentEducatorStatusService,
  type PlatformAdminSessionSecurityConfig,
} from "@quest-city-web/platform-admin";
import { AuditRepository } from "@quest-city-web/identity";
import {
  ConvergencePreviewService,
  ConvergenceExecutionService,
  ConvergenceRollbackReviewService,
} from "@quest-city-web/convergence";
import { loadEnv } from "./env";

/** Own connection pool, same separation rationale as every prior milestone's own pool (lib/staff-identity-context.ts precedent). */
let pool: Pool | undefined;

function getPlatformAdminPool(): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: true } : undefined,
      max: env.dbPoolPlatformIdentityMax,
      idleTimeoutMillis: env.dbPoolPlatformIdentityIdleTimeoutMs,
      connectionTimeoutMillis: env.dbPoolPlatformIdentityConnectionTimeoutMs,
    });
  }
  return pool;
}

function getPlatformSessionSecurityConfig(): PlatformAdminSessionSecurityConfig {
  const env = loadEnv();
  return {
    absoluteTtlSeconds: env.platformSessionAbsoluteTtlSeconds,
    inactivityTtlSeconds: env.platformSessionInactivityTtlSeconds,
    maxFailedLoginAttempts: 5,
    lockoutDurationSeconds: 15 * 60,
  };
}

export function getPlatformAuthService(): PlatformAuthService {
  return new PlatformAuthService(getPlatformAdminPool(), getPlatformSessionSecurityConfig());
}

export function getTenantProvisioningService(): TenantProvisioningService {
  return new TenantProvisioningService(getPlatformAdminPool());
}

export function getTenantStatusService(): TenantStatusService {
  return new TenantStatusService(getPlatformAdminPool());
}

export function getSchoolAdminActivationService(): SchoolAdminActivationService {
  return new SchoolAdminActivationService(getPlatformAdminPool());
}

export function getIndependentEducatorActivationService(): IndependentEducatorActivationService {
  return new IndependentEducatorActivationService(getPlatformAdminPool());
}

export function getIndependentEducatorStatusService(): IndependentEducatorStatusService {
  return new IndependentEducatorStatusService(getPlatformAdminPool());
}

/** For the audit-read route, which lists audit_event rows directly (capability audit.read.global) without going through a platform-admin write service. */
export function getPlatformAuditRepository(): AuditRepository {
  return new AuditRepository(getPlatformAdminPool());
}

export function getPlatformAdminPoolForQueries(): Pool {
  return getPlatformAdminPool();
}

/** Account/Tenant Convergence (02_38, 02_26 v1.14 §36) — PLATFORM_ADMIN-authed surfaces, same pool-reuse convention as every other factory in this file. */
export function getConvergencePreviewService(): ConvergencePreviewService {
  return new ConvergencePreviewService(getPlatformAdminPool());
}

export function getConvergenceExecutionService(): ConvergenceExecutionService {
  return new ConvergenceExecutionService(getPlatformAdminPool());
}

export function getConvergenceRollbackReviewService(): ConvergenceRollbackReviewService {
  return new ConvergenceRollbackReviewService(getPlatformAdminPool());
}
