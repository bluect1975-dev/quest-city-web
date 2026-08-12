import { Pool } from "pg";
import {
  ClassCodeService,
  SessionService,
  TenantRepository,
  SchoolEnrollmentRepository,
  type SessionSecurityConfig,
} from "@quest-city-web/identity";
import { loadEnv } from "./env";

let pool: Pool | undefined;
let classCodeService: ClassCodeService | undefined;
let sessionService: SessionService | undefined;
let tenantRepository: TenantRepository | undefined;

/**
 * Separate connection pool from `lib/db.ts`'s readiness-probe pool — that
 * one exists only to answer `/health/ready` and is deliberately kept free
 * of any domain concern (see its own doc comment). Identity request
 * traffic gets its own pool sized for real query load.
 */
function getIdentityPool(): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: true } : undefined,
      max: 10,
    });
  }
  return pool;
}

function getSessionSecurityConfig(): SessionSecurityConfig {
  const env = loadEnv();
  return {
    absoluteTtlSeconds: env.sessionAbsoluteTtlSeconds,
    inactivityTtlSeconds: env.sessionInactivityTtlSeconds,
  };
}

export function getClassCodeService(): ClassCodeService {
  if (!classCodeService) {
    const env = loadEnv();
    classCodeService = new ClassCodeService(getIdentityPool(), env.classCodeHashPepper);
  }
  return classCodeService;
}

export function getSessionService(): SessionService {
  if (!sessionService) {
    const env = loadEnv();
    sessionService = new SessionService(getIdentityPool(), env.classCodeHashPepper, getSessionSecurityConfig());
  }
  return sessionService;
}

/**
 * WEB-I18N-FOUNDATION I18N-B: the school level of the locale resolution
 * hierarchy (02_34 §3) reads `tenant.settings_json.locale`. No new
 * repository was needed -- TenantRepository already existed for WEB-M1.
 */
export function getTenantRepository(): TenantRepository {
  if (!tenantRepository) {
    tenantRepository = new TenantRepository(getIdentityPool());
  }
  return tenantRepository;
}

/**
 * `GET /me/assignments` (OpenAPI v1.10, 02_26 v1.12 §34.5) needs the
 * enrollment's own `status` — `SessionService.resolveInternalIdentity`
 * only returns `classId`, not `status` (02_26 §30.1's session model never
 * needed it before this contract). No new repository: `SchoolEnrollmentRepository`
 * already existed for WEB-M1.
 */
export function getSchoolEnrollmentRepository(): SchoolEnrollmentRepository {
  return new SchoolEnrollmentRepository(getIdentityPool());
}
