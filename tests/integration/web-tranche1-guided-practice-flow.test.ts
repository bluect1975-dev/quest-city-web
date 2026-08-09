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
  RuntimeCapabilityResolver,
  resolveEngineDispatch,
  SequenceRuntimeStateRepository,
} from "@quest-city-web/attempts";
import { createDefaultEngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import {
  loadBundleManifest,
  initializeSequence,
  requestHint,
  advanceStage,
  isSequenceComplete,
} from "@quest-city-web/content-runtime";
import {
  WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST,
  WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID,
  WEB_TRANCHE1_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE1_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION,
  WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
  WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID,
} from "@quest-city-web/content-runtime";

/**
 * M06 Web Full Vertical Slice Tranche 1 (`07_26 v1.0` §14, §18) end-to-end
 * integration: real GUIDED_PRACTICE content, seeded exactly as
 * `tools/seed-tranche1-content-bundle.ts` + `tools/seed-assignment.ts`
 * would, driven through the exact sequence `apps/api`'s routes perform,
 * plus a durable restart/resume of the real 2-stage `SequenceRuntimeState`
 * — mirrors `web-m4-activity-flow.test.ts` and
 * `sequence-runtime-state.test.ts`'s "Durability" describe block, applied
 * to this tranche's real content instead of a generic fixture.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- web-tranche1-guided-practice-flow
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

/** Mirrors tools/seed-tranche1-content-bundle.ts exactly (explicit id, real manifest, ACTIVITY_BUNDLE). */
async function seedTranche1ContentBundle(): Promise<void> {
  const validation = loadBundleManifest(WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST);
  if (!validation.ok) throw new Error(`manifest invalid: ${validation.errors.join("; ")}`);
  const manifest = WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST;
  await pool.query(
    `INSERT INTO content_bundle (id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID,
      WEB_TRANCHE1_CONTENT_BUNDLE_PUBLIC_ID,
      manifest.subjectId,
      manifest.bundleVersion,
      manifest.bundleType,
      manifest.status,
      `sha256:${manifest.integrity.digest}`,
      "pkg://@quest-city-web/content-runtime/content/web-tranche1-guided-practice-content#WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST",
      manifest.publishedAt,
    ],
  );
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID,
  ]);
}

/** Mirrors tools/seed-assignment.ts exactly. */
async function seedTranche1Assignment(tenantId: string, classId: string): Promise<string> {
  const assignmentResult = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Pratica guidata: equazioni', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
    [tenantId, classId, WEB_TRANCHE1_ASSIGNMENT_PUBLIC_ID, WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID],
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

describe("Tranche 1 real content bundle + assignment materialization", () => {
  it("the seeded content_bundle is a real, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED, WEB-compatible)", async () => {
    await seedTranche1ContentBundle();
    const bundle = await new ContentBundleRepository(pool).findById(WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID);
    expect(bundle).not.toBeNull();
    expect(bundle?.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(bundle?.status).toBe("PUBLISHED");
    expect(bundle?.compatibleRuntimes).toEqual(["WEB"]);
  });

  it("resolveEngineDispatch resolves the real content_bundle id to ENG-QUICK with the real (non-invented) ENTER_VALUE config", () => {
    const dispatch = resolveEngineDispatch(WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID);
    expect(dispatch).toBeDefined();
    expect(dispatch?.runtimeAdapterId).toBe("QC-WEB-ENGINE-QUICK-QUESTION");
    expect(dispatch?.config).toMatchObject({ mode: "ENTER_VALUE", expectedValue: 7, tolerance: 0 });
  });
});

describe("Tranche 1 full attempt lifecycle against real content (retry then correct)", () => {
  it("launch-context -> wrong answer (retry) -> correct answer -> complete: consolidates CORRECT via the real engine/content wiring", async () => {
    const fx = await buildFixture();
    await seedTranche1ContentBundle();
    const assignmentId = await seedTranche1Assignment(fx.tenantId, fx.classId);

    const assignments = new AssignmentRepository(pool);
    const bundles = new ContentBundleRepository(pool);
    const attempts = new LearningAttemptRepository(pool);
    const assignment = await assignments.findByIdAndTenant(assignmentId, fx.tenantId);
    expect(assignment).not.toBeNull();
    const bundle = await bundles.findById(assignment!.contentBundleId);
    expect(bundle).not.toBeNull();

    const resolver = new RuntimeCapabilityResolver();
    const resolution = resolver.resolve({
      runtimeChannel: "WEB",
      requestedCapabilities: ["html", "keyboard"],
      availableAdapters: [
        {
          adapterId: "default-web-adapter",
          adapterVersion: "1.0.0",
          supportedRuntimeChannels: ["WEB"],
          supportedCapabilities: ["html", "keyboard"],
        },
      ],
    });
    expect(resolution.compatible).toBe(true);

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
      creationIdempotencyKey: "web-tranche1-launch-key-000001",
    });
    expect(attempt.contentId).toBe(WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID);

    const semanticActions = new SemanticActionLogRepository(pool);
    await attempts.transitionToInProgress(attempt.id, fx.tenantId);

    // Wrong answer first (x = 5, the answer to the out-of-scope PR-M06-L01-02) — the retry path is real, not simulated.
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-enter-wrong",
      actionType: "ENTER_VALUE",
      targetRole: "value-input",
      payload: { value: 5 },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-confirm-wrong",
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
      clientSequence: 1,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    // Correct answer (x = 7, PR-M06-L01-01, 03_13 §9) after retry.
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-enter-correct",
      actionType: "ENTER_VALUE",
      targetRole: "value-input",
      payload: { value: 7 },
      clientSequence: 2,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-confirm-correct",
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
      clientSequence: 3,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });

    const submitted = await attempts.transitionToCompletionSubmitted(attempt.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    expect(submitted).not.toBeNull();

    const actions = await semanticActions.findByAttempt(attempt.id, fx.tenantId);
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
    expect(finalAttempt?.outcome).toMatchObject({ score: 1 });

    const responses = await attemptResponses.findByAttempt(attempt.id, fx.tenantId);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.correctness).toBe("CORRECT");
  });

  it("activityId (WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID) is a real, stable identifier", () => {
    expect(WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID.length).toBeGreaterThan(0);
    expect(WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID).not.toBe("fixture-balance-machine");
  });
});

describe("Tranche 1 durable restart/resume against the real 2-stage SequenceDefinition (07_26 v1.0 §11, §14)", () => {
  it("GUIDED_PRACTICE hint progress survives a simulated process restart, and REFLECTION_AND_RESULT completion sticks after a second restart", async () => {
    const fx = await buildFixture();
    const definition = WEB_TRANCHE1_GUIDED_PRACTICE_SEQUENCE_DEFINITION;

    const repoBeforeRestart = new SequenceRuntimeStateRepository(pool);
    let state = initializeSequence(definition, randomUUID());
    state = requestHint(definition, state); // hintLevel 0 -> 1, used before the (simulated) reload.
    const created = await repoBeforeRestart.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state,
    });
    expect(created.state.currentStageId).toBe(WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID);

    // Simulate a process restart: a brand-new Pool/repository, no shared in-process state whatsoever.
    const restartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const repoAfterRestart = new SequenceRuntimeStateRepository(restartPool);
      const resumed = await repoAfterRestart.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, definition.sequenceId);
      expect(resumed).not.toBeNull();
      expect(resumed?.state.currentStageId).toBe(WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID);
      expect(resumed?.state.stageStates.find((s) => s.stageId === WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID)?.hintLevel).toBe(1);
      expect(resumed?.state.sequenceCompletionState).toBe("IN_PROGRESS");

      // Resume completes GUIDED_PRACTICE (advanceStage, mirroring a correct
      // engine evaluation already applied client-side) and enters
      // REFLECTION_AND_RESULT, then confirms it too (non-interactive continue).
      const afterGuidedPractice = advanceStage(definition, resumed!.state);
      expect(afterGuidedPractice.currentStageId).toBe(WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID);
      expect(isSequenceComplete(afterGuidedPractice)).toBe(false);
      const completed = advanceStage(definition, afterGuidedPractice);
      expect(isSequenceComplete(completed)).toBe(true);
      await repoAfterRestart.save(fx.tenantId, fx.studentProfileId, definition.sequenceId, resumed!.version, completed);
    } finally {
      await restartPool.end();
    }

    // Second simulated restart — COMPLETED must still stick, no silent reset to the initial stage.
    const secondRestartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const repoAfterSecondRestart = new SequenceRuntimeStateRepository(secondRestartPool);
      const finalState = await repoAfterSecondRestart.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, definition.sequenceId);
      expect(finalState).not.toBeNull();
      expect(finalState?.state.sequenceCompletionState).toBe("COMPLETED");
      expect(finalState?.state.currentStageId).toBe(WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID);
      expect(finalState?.state.stageStates.find((s) => s.stageId === WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID)?.status).toBe("COMPLETED");
      expect(finalState?.state.stageStates.find((s) => s.stageId === WEB_TRANCHE1_REFLECTION_AND_RESULT_STAGE_ID)?.status).toBe("COMPLETED");
    } finally {
      await secondRestartPool.end();
    }
  });
});
