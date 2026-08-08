import { Pool } from "pg";
import {
  AssignmentRepository,
  ContentBundleRepository,
  LearningAttemptRepository,
  SemanticActionLogRepository,
  AttemptResponseRepository,
  IdempotencyRecordRepository,
  IdempotencyService,
  AttemptConsolidationService,
  CrossRuntimeReconciliationService,
} from "@quest-city-web/attempts";
import { createDefaultEngineRuntimeRegistry, type EngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import { loadEnv } from "./env";

let engineRuntimeRegistry: EngineRuntimeRegistry | undefined;

function getEngineRuntimeRegistry(): EngineRuntimeRegistry {
  if (!engineRuntimeRegistry) {
    engineRuntimeRegistry = createDefaultEngineRuntimeRegistry();
  }
  return engineRuntimeRegistry;
}

/**
 * Separate connection pool from `lib/db.ts` (health probe) and
 * `lib/identity-context.ts` (WEB-M1 identity traffic) — WEB-M2 attempt/
 * assignment traffic gets its own pool, same pattern as identity's own
 * separation rationale.
 */
let pool: Pool | undefined;

function getAttemptsPool(): Pool {
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

export function getAssignmentRepository(): AssignmentRepository {
  return new AssignmentRepository(getAttemptsPool());
}

export function getContentBundleRepository(): ContentBundleRepository {
  return new ContentBundleRepository(getAttemptsPool());
}

export function getLearningAttemptRepository(): LearningAttemptRepository {
  return new LearningAttemptRepository(getAttemptsPool());
}

export function getSemanticActionLogRepository(): SemanticActionLogRepository {
  return new SemanticActionLogRepository(getAttemptsPool());
}

export function getAttemptResponseRepository(): AttemptResponseRepository {
  return new AttemptResponseRepository(getAttemptsPool());
}

export function getIdempotencyService(): IdempotencyService {
  return new IdempotencyService(new IdempotencyRecordRepository(getAttemptsPool()));
}

export function getAttemptConsolidationService(): AttemptConsolidationService {
  return new AttemptConsolidationService(
    getLearningAttemptRepository(),
    getAttemptResponseRepository(),
    getEngineRuntimeRegistry(),
  );
}

export function getCrossRuntimeReconciliationService(): CrossRuntimeReconciliationService {
  return new CrossRuntimeReconciliationService(getLearningAttemptRepository());
}
