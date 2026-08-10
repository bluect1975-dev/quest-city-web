import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  AssignmentRepository,
  AttemptConsolidationService,
  AttemptResponseRepository,
  ContentBundleRepository,
  LearningAttemptRepository,
  SemanticActionLogRepository,
  isWhollyNonInteractiveContentBundle,
  resolveEngineDispatch,
} from "@quest-city-web/attempts";
import { AuditRepository } from "@quest-city-web/identity";
import { createDefaultEngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import { loadBundleManifest } from "@quest-city-web/content-runtime";
import {
  WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST,
  WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID,
  WEB_TRANCHE5_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE5_CONTENT_BUNDLE_PUBLIC_ID,
} from "@quest-city-web/content-runtime";

/**
 * M06 Web Full Vertical Slice Tranche 5 (`07_26 v1.1` §13/§17) end-to-end
 * integration: real `INTRO_HOOK` content, seeded exactly as
 * `tools/seed-tranche5-content-bundle.ts` + `tools/seed-assignment.ts`
 * would, driven through the exact attempt-state-machine sequence
 * `apps/api`'s routes perform.
 *
 * INTRO_HOOK is wholly non-interactive (no engine, `07_26 v1.1` §17) — its
 * single stage never dispatches to an EngineHost, so it never submits a
 * semantic action of any kind (a prior fix here submitted a synthetic
 * `CONFIRM_SOLUTION` action specifically to force `CREATED -> IN_PROGRESS`;
 * audited against canon and reverted — see `SequenceHost.tsx`'s own
 * history). M06 Non-Interactive Attempt Lifecycle (`07_15_01 v1.3`
 * §11-bis.2-bis, `02_36 v1.4` §20-bis.12) resolves the resulting gap with a
 * second, orchestration-layer-owned trigger for `CREATED -> IN_PROGRESS` —
 * never a semantic action, never routed through `semantic_action_log`.
 * This suite exercises that trigger's full lifecycle (idempotency, resume,
 * `semantic_action_log` staying empty, no fabricated outcome/score at
 * consolidation) by composing the same repositories/services
 * `apps/api/app/attempts/[attemptId]/orchestration-stage-entry/route.ts`
 * composes, never calling `transitionToInProgress` directly without first
 * checking `isWhollyNonInteractiveContentBundle` — so a regression in
 * either piece is caught here.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- web-tranche5-intro-hook-flow
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

interface Fixture {
  tenantId: string;
  classId: string;
  studentProfileId: string;
  enrollmentId: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE sequence_runtime_state, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function buildFixture(): Promise<Fixture> {
  const tenantResult = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`,
    [`sch_${Math.random().toString(36).slice(2, 10)}`],
  );
  const tenantId = tenantResult.rows[0]!.id;

  const classResult = await pool.query<{ id: string }>(
    `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Test Class', 'ACTIVE') RETURNING id`,
    [tenantId, `cls_${Math.random().toString(36).slice(2, 10)}`],
  );
  const classId = classResult.rows[0]!.id;

  const profileResult = await pool.query<{ id: string }>(
    `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [tenantId, `std_${Math.random().toString(36).slice(2, 10)}`],
  );
  const studentProfileId = profileResult.rows[0]!.id;

  const enrollmentResult = await pool.query<{ id: string }>(
    `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
     VALUES ($1, $2, $3, 'Test', 'test', 'x', 'ACTIVE') RETURNING id`,
    [tenantId, classId, studentProfileId],
  );
  const enrollmentId = enrollmentResult.rows[0]!.id;

  return { tenantId, classId, studentProfileId, enrollmentId };
}

/** Mirrors tools/seed-tranche5-content-bundle.ts exactly (explicit id, real manifest, ACTIVITY_BUNDLE). */
async function seedTranche5ContentBundle(): Promise<void> {
  const validation = loadBundleManifest(WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST);
  if (!validation.ok) throw new Error(`manifest invalid: ${validation.errors.join("; ")}`);
  const manifest = WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST;
  await pool.query(
    `INSERT INTO content_bundle (id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      WEB_TRANCHE5_CONTENT_BUNDLE_PUBLIC_ID,
      manifest.subjectId,
      manifest.bundleVersion,
      manifest.bundleType,
      manifest.status,
      `sha256:${manifest.integrity.digest}`,
      "pkg://@quest-city-web/content-runtime/content/web-tranche5-intro-hook-content#WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST",
      manifest.publishedAt,
    ],
  );
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
  ]);
}

/** Mirrors tools/seed-assignment.ts exactly. */
async function seedTranche5Assignment(tenantId: string, classId: string): Promise<string> {
  const assignmentResult = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Equilibrio: capire un''equazione', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
    [tenantId, classId, WEB_TRANCHE5_ASSIGNMENT_PUBLIC_ID, WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID],
  );
  const assignmentId = assignmentResult.rows[0]!.id;
  await pool.query(`INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, 'WEB')`, [
    assignmentId,
    tenantId,
  ]);
  return assignmentId;
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("Tranche 5 real content bundle + assignment materialization", () => {
  it("the seeded content_bundle is a real, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED, WEB-compatible)", async () => {
    await seedTranche5ContentBundle();
    const bundle = await new ContentBundleRepository(pool).findById(WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID);
    expect(bundle).not.toBeNull();
    expect(bundle?.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(bundle?.status).toBe("PUBLISHED");
    expect(bundle?.compatibleRuntimes).toEqual(["WEB"]);
  });

  it("resolveEngineDispatch finds no engine for INTRO_HOOK's content id — it is wholly non-interactive (07_26 v1.1 §17), never a fallback to a similar engine", () => {
    const dispatch = resolveEngineDispatch(WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID);
    expect(dispatch).toBeUndefined();
  });
});

describe("Tranche 5 content materialization against real assignment (non-interactive single stage)", () => {
  it("a real launch-shaped attempt for INTRO_HOOK's content resolves to no engine dispatch (07_26 v1.1 §17.2 'nessuna semantic action di dominio')", async () => {
    const fx = await buildFixture();
    await seedTranche5ContentBundle();
    const assignmentId = await seedTranche5Assignment(fx.tenantId, fx.classId);

    const assignments = new AssignmentRepository(pool);
    const bundles = new ContentBundleRepository(pool);
    const attempts = new LearningAttemptRepository(pool);
    const assignment = await assignments.findByIdAndTenant(assignmentId, fx.tenantId);
    expect(assignment).not.toBeNull();
    const bundle = await bundles.findById(assignment!.contentBundleId);
    expect(bundle).not.toBeNull();

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: bundle!.id,
      contentId: bundle!.id,
      contentVersion: bundle!.bundleVersion,
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche5-launch-key-000001",
    });
    expect(attempt.contentId).toBe(WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID);
    expect(attempt.attemptState).toBe("CREATED");
    expect(resolveEngineDispatch(attempt.contentId)).toBeUndefined();

    // In real usage nothing ever calls POST /attempts/{id}/actions for
    // this content — INTRO_HOOK's "Continua" click logs no semantic
    // action, and never will (07_26 v1.1 §17.2, unchanged). See the
    // "Non-Interactive Attempt Lifecycle" describe block below for how
    // this attempt now leaves CREATED anyway, without one.
  });

  it("activityId (WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID) is a real, stable identifier", () => {
    expect(WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID).toBe("MAT-M06-U01-intro-hook");
    expect(WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID).not.toBe("fixture-balance-machine");
  });
});

describe("Tranche 5 regression guard: completion is rejected before the orchestration-stage-entry trigger lands", () => {
  it("a freshly-created attempt with zero logged actions and no orchestration-stage-entry call stays CREATED — transitionToCompletionSubmitted only succeeds from IN_PROGRESS", async () => {
    const fx = await buildFixture();
    await seedTranche5ContentBundle();
    const assignmentId = await seedTranche5Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche5-no-action-key-000001",
    });
    expect(attempt.attemptState).toBe("CREATED");

    const submitted = await attempts.transitionToCompletionSubmitted(attempt.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    expect(submitted).toBeNull();

    const stillCreated = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(stillCreated?.attemptState).toBe("CREATED");
  });
});

/**
 * M06 Non-Interactive Attempt Lifecycle (`07_15_01 v1.3` §11-bis.2-bis,
 * `02_36 v1.4` §20-bis.12). Each test composes the same pieces
 * `apps/api/app/attempts/[attemptId]/orchestration-stage-entry/route.ts`
 * composes — `isWhollyNonInteractiveContentBundle` eligibility check,
 * `LearningAttemptRepository.transitionToInProgress`, and
 * `AuditRepository.record` only when a real transition happened — rather
 * than calling `transitionToInProgress` unconditionally, so this suite
 * actually exercises the trigger's eligibility gate, not just the
 * pre-existing (already-idempotent) repository method.
 */
async function applyOrchestrationStageEntryTrigger(
  attempts: LearningAttemptRepository,
  audit: AuditRepository,
  attemptId: string,
  tenantId: string,
): Promise<{ attemptState: string; transitioned: boolean }> {
  const attempt = await attempts.findByIdAndTenant(attemptId, tenantId);
  if (!attempt) throw new Error("attempt not found");
  if (!isWhollyNonInteractiveContentBundle(attempt.contentId)) {
    throw new Error("ORCHESTRATION_STAGE_ENTRY_NOT_APPLICABLE");
  }
  const wasCreated = attempt.attemptState === "CREATED";
  const updated = wasCreated ? await attempts.transitionToInProgress(attemptId, tenantId) : attempt;
  if (wasCreated && updated?.attemptState === "IN_PROGRESS") {
    await audit.record({
      tenantId,
      actorType: "SYSTEM",
      action: "orchestration_stage_entry_attempt_transitioned",
      targetType: "learning_attempt",
      targetId: attemptId,
      result: "SUCCESS",
      metadataRedacted: { fromState: "CREATED", toState: "IN_PROGRESS" },
    });
  }
  return { attemptState: updated?.attemptState ?? attempt.attemptState, transitioned: wasCreated && updated?.attemptState === "IN_PROGRESS" };
}

describe("Non-Interactive Attempt Lifecycle: orchestration-stage-entry trigger (07_15_01 v1.3 §11-bis.2-bis)", () => {
  it("transitions CREATED -> IN_PROGRESS without ever touching semantic_action_log", async () => {
    const fx = await buildFixture();
    await seedTranche5ContentBundle();
    const assignmentId = await seedTranche5Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const actions = new SemanticActionLogRepository(pool);
    const audit = new AuditRepository(pool);

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche5-orch-trigger-key-000001",
    });
    expect(attempt.attemptState).toBe("CREATED");

    const result = await applyOrchestrationStageEntryTrigger(attempts, audit, attempt.id, fx.tenantId);
    expect(result).toEqual({ attemptState: "IN_PROGRESS", transitioned: true });

    const reloaded = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(reloaded?.attemptState).toBe("IN_PROGRESS");

    // NOT a semantic action: zero rows in semantic_action_log for this attempt, ever.
    const loggedActions = await actions.findByAttempt(attempt.id, fx.tenantId);
    expect(loggedActions).toEqual([]);
  });

  it("is idempotent: a second call after the first is a no-op (no re-transition, no second audit_event row)", async () => {
    const fx = await buildFixture();
    await seedTranche5ContentBundle();
    const assignmentId = await seedTranche5Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const audit = new AuditRepository(pool);

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche5-orch-trigger-key-000002",
    });

    const first = await applyOrchestrationStageEntryTrigger(attempts, audit, attempt.id, fx.tenantId);
    expect(first).toEqual({ attemptState: "IN_PROGRESS", transitioned: true });

    // Simulates a resume/reload re-entering the same stage, or a duplicate
    // client call — the attempt is already IN_PROGRESS, so this must be a
    // silent no-op, never an error and never a second effect.
    const second = await applyOrchestrationStageEntryTrigger(attempts, audit, attempt.id, fx.tenantId);
    expect(second).toEqual({ attemptState: "IN_PROGRESS", transitioned: false });

    const auditRows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_event WHERE target_id = $1 AND action = 'orchestration_stage_entry_attempt_transitioned'`,
      [attempt.id],
    );
    expect(auditRows.rows[0]?.count).toBe("1");
  });

  it("resume: re-applying the trigger after the attempt has already progressed further (COMPLETION_SUBMITTED) is still a safe no-op", async () => {
    const fx = await buildFixture();
    await seedTranche5ContentBundle();
    const assignmentId = await seedTranche5Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const audit = new AuditRepository(pool);

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche5-orch-trigger-key-000003",
    });
    await applyOrchestrationStageEntryTrigger(attempts, audit, attempt.id, fx.tenantId);
    await attempts.transitionToCompletionSubmitted(attempt.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");

    // A stale/duplicate client call (e.g. two tabs) after the attempt
    // already moved past IN_PROGRESS must never revert or otherwise touch it.
    const resumed = await applyOrchestrationStageEntryTrigger(attempts, audit, attempt.id, fx.tenantId);
    expect(resumed).toEqual({ attemptState: "COMPLETION_SUBMITTED", transitioned: false });
  });

  it("full lifecycle CREATED -> IN_PROGRESS -> COMPLETION_SUBMITTED -> COMPLETED, with no fabricated outcome/score (07_15_01 v1.3 §12.1)", async () => {
    const fx = await buildFixture();
    await seedTranche5ContentBundle();
    const assignmentId = await seedTranche5Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const actions = new SemanticActionLogRepository(pool);
    const attemptResponses = new AttemptResponseRepository(pool);
    const audit = new AuditRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses, createDefaultEngineRuntimeRegistry());

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche5-orch-trigger-key-000004",
    });

    await applyOrchestrationStageEntryTrigger(attempts, audit, attempt.id, fx.tenantId);
    const inProgress = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(inProgress?.attemptState).toBe("IN_PROGRESS");

    const submitted = await attempts.transitionToCompletionSubmitted(attempt.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    expect(submitted?.attemptState).toBe("COMPLETION_SUBMITTED");

    const loggedActions = await actions.findByAttempt(attempt.id, fx.tenantId);
    expect(loggedActions).toEqual([]);

    const result = await consolidation.consolidate({ attemptId: attempt.id, tenantId: fx.tenantId, contentId: attempt.contentId, actions: [] });
    expect(result.completionStatus).toBe("CONSOLIDATED");
    // No Learning Engine ever dispatched for this content — the outcome
    // reflects only sequence completion, never a fabricated score.
    expect(result.outcome).not.toHaveProperty("score");

    const completed = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(completed?.attemptState).toBe("COMPLETED");
    expect(completed?.completionStatus).toBe("CONSOLIDATED");
  });

  it("rejects (never silently transitions) an attempt whose content bundle is not wholly non-interactive", async () => {
    const fx = await buildFixture();
    await seedTranche5ContentBundle();
    const assignmentId = await seedTranche5Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const audit = new AuditRepository(pool);

    // content_bundle_id and content_id are both UUID-typed columns (0003
    // migration) — content_bundle_id must satisfy a real FK, so this reuses
    // the seeded Tranche 5 bundle row, but content_id (the eligibility key
    // isWhollyNonInteractiveContentBundle actually checks, no FK
    // constraint) is a fresh random UUID never present in its registry —
    // exactly the "unknown content id" case. The eligibility gate must
    // reject this before ever calling transitionToInProgress, exactly like
    // the real route would.
    const unknownContentId = randomUUID();
    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: unknownContentId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche5-orch-trigger-key-000005",
    });

    await expect(applyOrchestrationStageEntryTrigger(attempts, audit, attempt.id, fx.tenantId)).rejects.toThrow(
      "ORCHESTRATION_STAGE_ENTRY_NOT_APPLICABLE",
    );

    const stillCreated = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(stillCreated?.attemptState).toBe("CREATED");
  });
});
