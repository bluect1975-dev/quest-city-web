import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  AssignmentRepository,
  ContentBundleRepository,
  LearningAttemptRepository,
  SemanticActionLogRepository,
  AttemptResponseRepository,
  AttemptConsolidationService,
  resolveEngineDispatch,
} from "@quest-city-web/attempts";
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
 * single stage never dispatches to an EngineHost, so `SequenceHost`'s
 * "Continua" button is the ONLY thing that ever logs a semantic action for
 * this attempt (`CONFIRM_SOLUTION`, added specifically so the attempt can
 * leave CREATED — found via a live browser walkthrough: without it,
 * `POST /attempts/{id}/complete` rejects the attempt as
 * ATTEMPT_NOT_COMPLETABLE/INVALID_STATE, since `07_15_01 v1.1` §11-bis.2
 * requires CREATED -> IN_PROGRESS before completion, and IN_PROGRESS is
 * only ever reached as a side effect of a real logged action). This test
 * reproduces that exact sequence — transitionToInProgress only via a real
 * inserted CONFIRM_SOLUTION action, never called directly — so a
 * regression that removes the client's action submission is caught here
 * too, not only in `SequenceHost.test.tsx`'s component-level assertion.
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

describe("Tranche 5 full attempt lifecycle against real content (non-interactive single stage)", () => {
  it("launch -> Continua's real CONFIRM_SOLUTION action (the only thing that ever transitions this attempt out of CREATED) -> complete: consolidates without a score, never ATTEMPT_NOT_COMPLETABLE", async () => {
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

    // Real ATTEMPT_NOT_COMPLETABLE/INVALID_STATE precondition (07_15_01
    // v1.1 §11-bis.2) — a CREATED attempt with zero logged actions is not
    // completable, exactly the state the browser walkthrough bug produced.
    expect(attempt.attemptState).not.toBe("IN_PROGRESS");

    const semanticActions = new SemanticActionLogRepository(pool);
    // The only action this activity ever logs: SequenceHost.handleContinue's
    // CONFIRM_SOLUTION, submitted when the student clicks "Continua" on the
    // non-interactive INTRO_HOOK stage (never a PLACE_ITEM/SELECT_OPTION/
    // ENTER_VALUE — there is no EngineHost dispatch for this content).
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-confirm-0",
      actionType: "CONFIRM_SOLUTION",
      targetRole: null,
      payload: { stageId: "intro-hook", interactive: false },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });

    // Mirrors apps/api's actions route: the FIRST logged action transitions
    // CREATED -> IN_PROGRESS as a side effect (never called directly by
    // this test, exactly as the real route never calls it except from
    // inside POST /attempts/{id}/actions).
    const inProgress = await attempts.transitionToInProgress(attempt.id, fx.tenantId);
    expect(inProgress?.attemptState).toBe("IN_PROGRESS");

    const submitted = await attempts.transitionToCompletionSubmitted(attempt.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    expect(submitted).not.toBeNull();

    const actions = await semanticActions.findByAttempt(attempt.id, fx.tenantId);
    expect(actions).toHaveLength(1);
    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses, createDefaultEngineRuntimeRegistry());
    const result = await consolidation.consolidate({
      attemptId: attempt.id,
      tenantId: fx.tenantId,
      contentId: attempt.contentId,
      actions,
    });

    // No engine dispatch for this content -> outcome omits `score`
    // entirely (still schema-valid, honestly absent a real result — same
    // shape §41 already establishes for any unregistered/no-engine content).
    expect(result.completionStatus).toBe("CONSOLIDATED");
    expect(result.outcome).not.toHaveProperty("score");

    const finalAttempt = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(finalAttempt?.attemptState).toBe("COMPLETED");

    const responses = await attemptResponses.findByAttempt(attempt.id, fx.tenantId);
    expect(responses).toHaveLength(0); // no scored engine evaluation to record
  });

  it("activityId (WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID) is a real, stable identifier", () => {
    expect(WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID).toBe("MAT-M06-U01-intro-hook");
    expect(WEB_TRANCHE5_INTRO_HOOK_ACTIVITY_ID).not.toBe("fixture-balance-machine");
  });
});

describe("Tranche 5 regression guard: completion is rejected before the Continua action lands", () => {
  it("a freshly-created attempt with zero logged actions stays CREATED — transitionToCompletionSubmitted only succeeds from IN_PROGRESS", async () => {
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

    // No action ever logged (the exact bug scenario) — transitionToCompletionSubmitted
    // requires IN_PROGRESS and must return null, never silently succeed from CREATED.
    const submitted = await attempts.transitionToCompletionSubmitted(attempt.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    expect(submitted).toBeNull();

    const stillCreated = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(stillCreated?.attemptState).toBe("CREATED");
  });
});
