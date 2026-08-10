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
import { createDefaultEngineRuntimeRegistry, replayActions } from "@quest-city-web/learning-engines";
import { loadBundleManifest } from "@quest-city-web/content-runtime";
import {
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID,
  WEB_TRANCHE4_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE4_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG,
} from "@quest-city-web/content-runtime";

/**
 * M06 Web Full Vertical Slice Tranche 4 (`07_26 v1.0` §5/§6/§13) end-to-end
 * integration: real `INTERACTIVE_EXERCISE` content (`MAT-M06-U01-IE001`),
 * seeded exactly as `tools/seed-tranche4-content-bundle.ts` +
 * `tools/seed-assignment.ts` would, driven through the exact sequence
 * `apps/api`'s routes perform, plus the mandatory durable restart/resume
 * scenario of this authorization's §13.
 *
 * This tranche's sequence has exactly one stage (`INTERACTIVE_EXERCISE`,
 * same single-stage shape as `WEB_M4_ACTIVITY_SEQUENCE_DEFINITION`/
 * `WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION`) — there is no
 * second, orchestrator-level "mid-sequence" resume scenario to test beyond
 * the engine-level one below, the same reason Tranche 2's flow test has
 * only one resume scenario (Tranche 3's Scenario B applied specifically to
 * its 7 MICRO_LESSON sub-stages, which this tranche does not have).
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- web-tranche4-interactive-exercise-flow
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

/** Mirrors tools/seed-tranche4-content-bundle.ts exactly (explicit id, real manifest, ACTIVITY_BUNDLE). */
async function seedTranche4ContentBundle(): Promise<void> {
  const validation = loadBundleManifest(WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST);
  if (!validation.ok) throw new Error(`manifest invalid: ${validation.errors.join("; ")}`);
  const manifest = WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST;
  await pool.query(
    `INSERT INTO content_bundle (id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
      WEB_TRANCHE4_CONTENT_BUNDLE_PUBLIC_ID,
      manifest.subjectId,
      manifest.bundleVersion,
      manifest.bundleType,
      manifest.status,
      `sha256:${manifest.integrity.digest}`,
      "pkg://@quest-city-web/content-runtime/content/web-tranche4-interactive-exercise-content#WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST",
      manifest.publishedAt,
    ],
  );
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
  ]);
}

/** Mirrors tools/seed-assignment.ts exactly. */
async function seedTranche4Assignment(tenantId: string, classId: string): Promise<string> {
  const assignmentResult = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Esercizio interattivo: applica l''operazione a entrambi i membri', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
    [tenantId, classId, WEB_TRANCHE4_ASSIGNMENT_PUBLIC_ID, WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID],
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

describe("Tranche 4 real content bundle + assignment materialization", () => {
  it("the seeded content_bundle is a real, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED, WEB-compatible)", async () => {
    await seedTranche4ContentBundle();
    const bundle = await new ContentBundleRepository(pool).findById(WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID);
    expect(bundle).not.toBeNull();
    expect(bundle?.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(bundle?.status).toBe("PUBLISHED");
    expect(bundle?.compatibleRuntimes).toEqual(["WEB"]);
  });

  it("resolveEngineDispatch resolves the real content_bundle id to ENG-DRAG with the real (non-invented) 2-slot config", () => {
    const dispatch = resolveEngineDispatch(WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID);
    expect(dispatch).toBeDefined();
    expect(dispatch?.runtimeAdapterId).toBe("QC-WEB-ENGINE-DRAG-DROP");
    const config = dispatch?.config as typeof WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG;
    expect(config.correctMapping).toHaveLength(2);
  });
});

describe("Tranche 4 full attempt lifecycle against real content (both members correctly modified)", () => {
  it("launch -> apply -3 to both members -> confirm -> complete: consolidates the real CORRECT outcome", async () => {
    const fx = await buildFixture();
    await seedTranche4ContentBundle();
    const assignmentId = await seedTranche4Assignment(fx.tenantId, fx.classId);

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
      creationIdempotencyKey: "web-tranche4-launch-key-000001",
    });
    expect(attempt.contentId).toBe(WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID);

    const semanticActions = new SemanticActionLogRepository(pool);
    await attempts.transitionToInProgress(attempt.id, fx.tenantId);

    let clientSequence = 0;
    for (const mapping of WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.correctMapping) {
      await semanticActions.insert({
        tenantId: fx.tenantId,
        attemptId: attempt.id,
        actionId: `act-place-${clientSequence}`,
        actionType: "PLACE_ITEM",
        targetRole: "drop-target",
        payload: { itemId: mapping.itemId, targetId: mapping.targetId },
        clientSequence: clientSequence++,
        runtimeChannel: "WEB",
        occurredAt: new Date(),
      });
    }
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: `act-confirm-${clientSequence}`,
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
      clientSequence: clientSequence++,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });

    const submitted = await attempts.transitionToCompletionSubmitted(attempt.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    expect(submitted).not.toBeNull();

    const actions = await semanticActions.findByAttempt(attempt.id, fx.tenantId);
    expect(actions).toHaveLength(3); // 2 placements + 1 confirm
    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses, createDefaultEngineRuntimeRegistry());
    const result = await consolidation.consolidate({
      attemptId: attempt.id,
      tenantId: fx.tenantId,
      contentId: attempt.contentId,
      actions,
    });

    expect(result.completionStatus).toBe("CONSOLIDATED");
    expect(result.outcome).toMatchObject({ score: 1 });

    const finalAttempt = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(finalAttempt?.attemptState).toBe("COMPLETED");

    const responses = await attemptResponses.findByAttempt(attempt.id, fx.tenantId);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.correctness).toBe("CORRECT");
  });

  it("activityId (WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID) is the real canonical MAT-M06-U01-IE001 identifier, not a fixture id", () => {
    expect(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID).toBe("MAT-M06-U01-IE001");
    expect(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ACTIVITY_ID).not.toBe("fixture-balance-machine");
  });
});

describe("Tranche 4 unilateral (partial) attempt against real content", () => {
  it("applying -3 to only one member consolidates INCORRECT with matchedCount=1 evidence — the specific unilateral-error signal (03_35 §17.1 point 6)", async () => {
    const fx = await buildFixture();
    await seedTranche4ContentBundle();
    const assignmentId = await seedTranche4Assignment(fx.tenantId, fx.classId);

    const attempts = new LearningAttemptRepository(pool);
    const semanticActions = new SemanticActionLogRepository(pool);

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche4-unilateral-key-000001",
    });
    await attempts.transitionToInProgress(attempt.id, fx.tenantId);

    const onlyLeft = WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.correctMapping[0]!;
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-place-0",
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: onlyLeft.itemId, targetId: onlyLeft.targetId },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-confirm-1",
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
      clientSequence: 1,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    await attempts.transitionToCompletionSubmitted(attempt.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");

    const actions = await semanticActions.findByAttempt(attempt.id, fx.tenantId);
    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses, createDefaultEngineRuntimeRegistry());
    const result = await consolidation.consolidate({
      attemptId: attempt.id,
      tenantId: fx.tenantId,
      contentId: attempt.contentId,
      actions,
    });

    expect(result.outcome).toMatchObject({ score: 0 });
    const responses = await attemptResponses.findByAttempt(attempt.id, fx.tenantId);
    expect(responses[0]?.correctness).toBe("INCORRECT");
    const evidence = responses[0]?.responseJson as Record<string, unknown>;
    expect(evidence["matchedCount"]).toBe(1);
    expect(evidence["feedbackText"]).toBe(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.feedback?.partialFeedbackText);
  });
});

describe("Tranche 4 mandatory durable resume scenario (07_26 v1.0 §13): mid-INTERACTIVE_EXERCISE, engine-level action-log replay", () => {
  it("placing the left member, then replaying the real semantic_action_log through the real engine (simulated restart) resumes with the left placement intact and the right member still pending — no reset, no duplication", async () => {
    const fx = await buildFixture();
    await seedTranche4ContentBundle();
    const assignmentId = await seedTranche4Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const semanticActions = new SemanticActionLogRepository(pool);

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche4-resume-key-000001",
    });
    await attempts.transitionToInProgress(attempt.id, fx.tenantId);

    // Place the left member only — leave the right member pending, do NOT confirm.
    const onlyLeft = WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.correctMapping[0]!;
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-place-0",
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: onlyLeft.itemId, targetId: onlyLeft.targetId },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });

    // Simulate a browser reload against a real restart: brand-new Pool, re-read the action log, replay it through a fresh engine instance.
    const restartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const restartActions = new SemanticActionLogRepository(restartPool);
      const loggedActions = await restartActions.findByAttempt(attempt.id, fx.tenantId);
      expect(loggedActions).toHaveLength(1); // exactly the one placement, nothing duplicated

      const engine = createDefaultEngineRuntimeRegistry().getByRuntimeAdapterId("QC-WEB-ENGINE-DRAG-DROP")!;
      const validation = engine.validateConfig(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG);
      expect(validation.valid).toBe(true);
      if (!validation.valid) return;
      const replay = replayActions(
        engine,
        validation.config,
        loggedActions.map((a) => ({ actionType: a.actionType, targetRole: a.targetRole, payload: a.payload })),
      );
      expect(replay.acceptedCount).toBe(1);
      const resumedState = replay.state as { placements: Record<string, string>; confirmed: boolean };
      // The left placement survived the restart intact; the right member is still absent — no silent reset, nothing skipped.
      expect(resumedState.placements[onlyLeft.itemId]).toBe(onlyLeft.targetId);
      expect(resumedState.confirmed).toBe(false);
      expect(Object.keys(resumedState.placements)).toHaveLength(1);

      // Complete the exercise from the resumed state: place the right member and confirm.
      const onlyRight = WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.correctMapping[1]!;
      let finalState = engine.applyAction(resumedState, validation.config, {
        actionType: "PLACE_ITEM",
        targetRole: "drop-target",
        payload: { itemId: onlyRight.itemId, targetId: onlyRight.targetId },
      }).state;
      finalState = engine.applyAction(finalState, validation.config, {
        actionType: "CONFIRM_SOLUTION",
        targetRole: "confirm-button",
        payload: {},
      }).state;
      const finalResult = engine.evaluate(finalState, validation.config);
      expect(finalResult).toMatchObject({ evaluated: true, correctness: "CORRECT" });
    } finally {
      await restartPool.end();
    }
  });
});
