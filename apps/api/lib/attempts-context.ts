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
  SequenceRuntimeStateRepository,
  DurableSequenceRuntimeStateStore,
} from "@quest-city-web/attempts";
import { AuditRepository } from "@quest-city-web/identity";
import { createDefaultEngineRuntimeRegistry, type EngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import { LearningPathSnapshotRepository, resolveEffectiveForLaunch } from "@quest-city-web/learning-path-control";
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

export function getSequenceRuntimeStateRepository(): SequenceRuntimeStateRepository {
  return new SequenceRuntimeStateRepository(getAttemptsPool());
}

/** GLPC (02_41 §33-34, migration 0013) -- reuses the attempts pool, same rationale as every other factory in this file (student attempt traffic, not staff traffic). */
export function getLearningPathSnapshotRepository(): LearningPathSnapshotRepository {
  return new LearningPathSnapshotRepository(getAttemptsPool());
}

/** Binds `resolveEffectiveForLaunch` (student/system-triggered, no staff capability check) to the attempts pool. */
export function resolveEffectiveForLaunchAttempt(input: Parameters<typeof resolveEffectiveForLaunch>[1]): ReturnType<typeof resolveEffectiveForLaunch> {
  return resolveEffectiveForLaunch(getAttemptsPool(), input);
}

/**
 * M06 Non-Interactive Attempt Lifecycle (07_15_01 v1.3 §11-bis.2-bis): the
 * orchestration-stage-entry route audits its `CREATED -> IN_PROGRESS`
 * transition via the same single `audit_event` table every other actor
 * writes to (`packages/identity`, no second/parallel log) — reusing the
 * attempts pool rather than staff-identity's, since this is student
 * attempt traffic.
 */
export function getAuditRepository(): AuditRepository {
  return new AuditRepository(getAttemptsPool());
}

/** R3C.3: one instance per request, bound to the caller's server-resolved identity — see the class's own doc comment for why this must never be shared across requests. */
export function getDurableSequenceRuntimeStateStore(
  tenantId: string,
  studentProfileId: string,
  enrollmentId: string,
  sequenceId: string,
): DurableSequenceRuntimeStateStore {
  return new DurableSequenceRuntimeStateStore(getSequenceRuntimeStateRepository(), tenantId, studentProfileId, enrollmentId, sequenceId);
}
