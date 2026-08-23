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
  SequenceRuntimeStateRepository,
} from "@quest-city-web/attempts";
import { createDefaultEngineRuntimeRegistry, replayActions } from "@quest-city-web/learning-engines";
import { loadBundleManifest, initializeSequence, receiveEngineResult, advanceStage, isSequenceComplete } from "@quest-city-web/content-runtime";
import {
  WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST,
  WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID,
  WEB_TRANCHE3_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE3_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG,
  WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION,
  WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
  WEB_TRANCHE3_MICRO_LESSON_STEPS,
} from "@quest-city-web/content-runtime";

/**
 * M06 Web Full Vertical Slice Tranche 3 (`07_26 v1.0` §5/§13) end-to-end
 * integration: real `PREREQUISITE_CHECK` + `MICRO_LESSON` content, seeded
 * exactly as `tools/seed-tranche3-content-bundle.ts` + `tools/seed-assignment.ts`
 * would, driven through the exact sequence `apps/api`'s routes perform,
 * plus the two mandatory durable restart/resume scenarios of this
 * authorization's §13: (A) mid-`PREREQUISITE_CHECK` (engine-level,
 * action-log replay — same mechanism Tranche 2 built) and (B)
 * mid-`MICRO_LESSON` (orchestrator-level, `currentStageId` — the same
 * already-durable mechanism `REFLECTION_AND_RESULT` and R3C.3 established,
 * reused here across 7 sub-stages instead of 1).
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- web-tranche3-prerequisite-check-micro-lesson-flow
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

/** Mirrors tools/seed-tranche3-content-bundle.ts exactly (explicit id, real manifest, ACTIVITY_BUNDLE). */
async function seedTranche3ContentBundle(): Promise<void> {
  const validation = loadBundleManifest(WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST);
  if (!validation.ok) throw new Error(`manifest invalid: ${validation.errors.join("; ")}`);
  const manifest = WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST;
  await pool.query(
    `INSERT INTO content_bundle (id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
      WEB_TRANCHE3_CONTENT_BUNDLE_PUBLIC_ID,
      manifest.subjectId,
      manifest.bundleVersion,
      manifest.bundleType,
      manifest.status,
      `sha256:${manifest.integrity.digest}`,
      "pkg://@quest-city-web/content-runtime/content/web-tranche3-prerequisite-check-micro-lesson-content#WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST",
      manifest.publishedAt,
    ],
  );
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
  ]);
}

/** Mirrors tools/seed-assignment.ts exactly. */
async function seedTranche3Assignment(tenantId: string, classId: string): Promise<string> {
  const assignmentResult = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Prima di iniziare: cosa è un''equazione?', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
    [tenantId, classId, WEB_TRANCHE3_ASSIGNMENT_PUBLIC_ID, WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID],
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

describe("Tranche 3 real content bundle + assignment materialization", () => {
  it("the seeded content_bundle is a real, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED, WEB-compatible)", async () => {
    await seedTranche3ContentBundle();
    const bundle = await new ContentBundleRepository(pool).findById(WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID);
    expect(bundle).not.toBeNull();
    expect(bundle?.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(bundle?.status).toBe("PUBLISHED");
    expect(bundle?.compatibleRuntimes).toEqual(["WEB"]);
  });

  it("resolveEngineDispatch resolves the real content_bundle id to ENG-QUICK with the real (non-invented) 2-item ITEM_SET config", () => {
    const dispatch = resolveEngineDispatch(WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID);
    expect(dispatch).toBeDefined();
    expect(dispatch?.runtimeAdapterId).toBe("QC-WEB-ENGINE-QUICK-QUESTION");
    const config = dispatch?.config as typeof WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG;
    expect(config.mode).toBe("ITEM_SET");
    if (config.mode === "ITEM_SET") {
      expect(config.items).toHaveLength(2);
    }
  });
});

describe("Tranche 3 full attempt lifecycle against real content (PREREQUISITE_CHECK, both items correct)", () => {
  it("launch-context -> answer both items correctly -> complete: consolidates the real aggregate outcome", async () => {
    const fx = await buildFixture();
    await seedTranche3ContentBundle();
    const assignmentId = await seedTranche3Assignment(fx.tenantId, fx.classId);

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
      creationIdempotencyKey: "web-tranche3-launch-key-000001",
    });
    expect(attempt.contentId).toBe(WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID);

    const semanticActions = new SemanticActionLogRepository(pool);
    await attempts.transitionToInProgress(attempt.id, fx.tenantId);

    // I001 -> "A" (correct, "x + 4 = 9" is an equation); I002 -> "C" (correct, "4x + 1" is not).
    const answers: Array<{ optionId: string }> = [{ optionId: "A" }, { optionId: "C" }];
    let clientSequence = 0;
    for (const answer of answers) {
      await semanticActions.insert({
        tenantId: fx.tenantId,
        attemptId: attempt.id,
        actionId: `act-${clientSequence}`,
        actionType: "SELECT_OPTION",
        targetRole: "option",
        payload: answer,
        clientSequence: clientSequence++,
        runtimeChannel: "WEB",
        occurredAt: new Date(),
      });
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
    }

    const submitted = await attempts.transitionToCompletionSubmitted(attempt.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    expect(submitted).not.toBeNull();

    const actions = await semanticActions.findByAttempt(attempt.id, fx.tenantId);
    expect(actions).toHaveLength(4); // 2 items x (1 select + 1 confirm)
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

  it("activityId (WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID) is a real, stable identifier", () => {
    expect(WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID.length).toBeGreaterThan(0);
    expect(WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID).not.toBe("fixture-balance-machine");
  });
});

describe("Tranche 3 mandatory durable resume scenario A (07_26 v1.0 §13-A): mid-PREREQUISITE_CHECK, engine-level action-log replay", () => {
  it("completing 1 of 2 items, then replaying the real semantic_action_log through the real engine (simulated restart) resumes at item 2 — no item skipped, no silent reset", async () => {
    const fx = await buildFixture();
    await seedTranche3ContentBundle();
    const assignmentId = await seedTranche3Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const semanticActions = new SemanticActionLogRepository(pool);

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche3-resume-key-000001",
    });
    await attempts.transitionToInProgress(attempt.id, fx.tenantId);

    // Complete item 1 (I001, correct "A") — leave item 2 (I002) pending.
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-select-0",
      actionType: "SELECT_OPTION",
      targetRole: "option",
      payload: { optionId: "A" },
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

    // Simulate a browser reload against a real restart: brand-new Pool, re-read the action log, replay it through a fresh engine instance.
    const restartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const restartActions = new SemanticActionLogRepository(restartPool);
      const loggedActions = await restartActions.findByAttempt(attempt.id, fx.tenantId);
      expect(loggedActions).toHaveLength(2); // 1 item x (1 select + 1 confirm), nothing duplicated

      const engine = createDefaultEngineRuntimeRegistry().getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
      const validation = engine.validateConfig(WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG);
      expect(validation.valid).toBe(true);
      if (!validation.valid) return;
      const replay = replayActions(
        engine,
        validation.config,
        loggedActions.map((a) => ({ actionType: a.actionType, targetRole: a.targetRole, payload: a.payload })),
      );
      expect(replay.acceptedCount).toBe(2);
      const resumedState = replay.state as { currentItemIndex?: number; itemResults?: Array<{ itemId: string; correctness: string }> };
      // Resumed at item 2 (index 1), not item 1 — the exact "no item skipped, no silent reset" requirement.
      expect(resumedState.currentItemIndex).toBe(1);
      expect(resumedState.itemResults).toHaveLength(1);
      expect(resumedState.itemResults?.[0]).toMatchObject({ itemId: "MAT-M06-U01-I001", correctness: "CORRECT" });
    } finally {
      await restartPool.end();
    }
  });
});

describe("Tranche 3 mandatory durable resume scenario B (07_26 v1.0 §13-B): mid-MICRO_LESSON, orchestrator-level currentStageId", () => {
  it("advancing to the 4th of 7 MICRO_LESSON sub-stages, then resuming after a simulated restart, lands exactly there — not at the first sub-stage, not at completion", async () => {
    const fx = await buildFixture();
    const definition = WEB_TRANCHE3_PREREQUISITE_CHECK_MICRO_LESSON_SEQUENCE_DEFINITION;

    // migration 0019 (per-attempt ownership): sequence_runtime_state now
    // requires a real learning_attempt row, so seed the same real
    // content_bundle -> assignment -> attempt chain the lifecycle test above uses.
    await seedTranche3ContentBundle();
    const assignmentId = await seedTranche3Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST.bundleVersion,
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche3-durability-key-000001",
    });
    const attemptId = attempt.id;

    const repoBeforeRestart = new SequenceRuntimeStateRepository(pool);
    let state = initializeSequence(definition, randomUUID());
    expect(state.currentStageId).toBe(WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID);

    // PREREQUISITE_CHECK evaluated CORRECT -> advance into MICRO_LESSON, then advance three more times (equilibrium + steps 1-2), landing on step 3 (the 4th MICRO_LESSON sub-stage overall).
    const outcome = receiveEngineResult(definition, state, {
      evaluated: true,
      correctness: "CORRECT",
      score: 1,
      evidence: { mode: "ITEM_SET", itemResults: [], correctCount: 2, totalItems: 2 },
    });
    expect(outcome.outcome).toBe("ADVANCED");
    state = advanceStage(definition, outcome.state); // -> micro-lesson-equilibrium
    state = advanceStage(definition, state); // -> micro-lesson-example-step-1
    state = advanceStage(definition, state); // -> micro-lesson-example-step-2
    expect(state.currentStageId).toBe("micro-lesson-example-step-2");

    const created = await repoBeforeRestart.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state,
    });
    expect(created.state.currentStageId).toBe("micro-lesson-example-step-2");

    // Simulate a process restart: a brand-new Pool/repository, no shared in-process state whatsoever.
    const restartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const repoAfterRestart = new SequenceRuntimeStateRepository(restartPool);
      const resumed = await repoAfterRestart.findByAttempt(fx.tenantId, attemptId);
      expect(resumed).not.toBeNull();
      // Resumed exactly at step 2, not step 1 (no silent reset) and not step 3+ (no item skipped).
      expect(resumed?.state.currentStageId).toBe("micro-lesson-example-step-2");
      expect(resumed?.state.sequenceCompletionState).toBe("IN_PROGRESS");
      const prereqStageState = resumed?.state.stageStates.find((s) => s.stageId === WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID);
      expect(prereqStageState?.status).toBe("COMPLETED");
      const equilibriumStageState = resumed?.state.stageStates.find((s) => s.stageId === "micro-lesson-equilibrium");
      expect(equilibriumStageState?.status).toBe("COMPLETED");
      const step1StageState = resumed?.state.stageStates.find((s) => s.stageId === "micro-lesson-example-step-1");
      expect(step1StageState?.status).toBe("COMPLETED");

      // Complete the remaining steps (step 2 through step 6) and persist.
      let finalState = resumed!.state;
      let version = resumed!.version;
      const remainingSteps = WEB_TRANCHE3_MICRO_LESSON_STEPS.length - 2; // already past equilibrium + step 1
      for (let i = 0; i < remainingSteps; i += 1) {
        finalState = advanceStage(definition, finalState);
      }
      expect(isSequenceComplete(finalState)).toBe(true);
      const saved = await repoAfterRestart.save(fx.tenantId, attemptId, version, finalState);
      expect(saved).not.toBeNull();
      expect(saved!.state.sequenceCompletionState).toBe("COMPLETED");
    } finally {
      await restartPool.end();
    }

    // Second simulated restart — COMPLETED must still stick, no silent reset to the initial stage.
    const secondRestartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const repoAfterSecondRestart = new SequenceRuntimeStateRepository(secondRestartPool);
      const finalCheck = await repoAfterSecondRestart.findByAttempt(fx.tenantId, attemptId);
      expect(finalCheck).not.toBeNull();
      expect(finalCheck?.state.sequenceCompletionState).toBe("COMPLETED");
      for (const step of WEB_TRANCHE3_MICRO_LESSON_STEPS) {
        expect(finalCheck?.state.stageStates.find((s) => s.stageId === step.stageId)?.status).toBe("COMPLETED");
      }
    } finally {
      await secondRestartPool.end();
    }
  });
});
