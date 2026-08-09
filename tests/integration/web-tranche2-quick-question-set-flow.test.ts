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
import { createDefaultEngineRuntimeRegistry, replayActions } from "@quest-city-web/learning-engines";
import { loadBundleManifest, initializeSequence, receiveEngineResult, advanceStage, isSequenceComplete } from "@quest-city-web/content-runtime";
import {
  WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID,
  WEB_TRANCHE2_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE2_CONTENT_BUNDLE_PUBLIC_ID,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG,
  WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION,
  WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
} from "@quest-city-web/content-runtime";

/**
 * M06 Web Full Vertical Slice Tranche 2 (`07_26 v1.0` §16, §13) end-to-end
 * integration: real QUICK_QUESTION_SET content, seeded exactly as
 * `tools/seed-tranche2-content-bundle.ts` + `tools/seed-assignment.ts`
 * would, driven through the exact sequence `apps/api`'s routes perform,
 * plus a durable restart/resume mid-item-set — mirrors
 * `web-tranche1-guided-practice-flow.test.ts`, applied to this tranche's
 * real content and its ITEM_SET-specific resume mechanism (§13: replaying
 * the attempt's own semantic action log through the real engine, the same
 * mechanism `GET /attempts/{attemptId}/actions` + `EngineHost`'s
 * `initialActions` prop use client-side).
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- web-tranche2-quick-question-set-flow
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

/** Mirrors tools/seed-tranche2-content-bundle.ts exactly (explicit id, real manifest, ACTIVITY_BUNDLE). */
async function seedTranche2ContentBundle(): Promise<void> {
  const validation = loadBundleManifest(WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST);
  if (!validation.ok) throw new Error(`manifest invalid: ${validation.errors.join("; ")}`);
  const manifest = WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST;
  await pool.query(
    `INSERT INTO content_bundle (id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
      WEB_TRANCHE2_CONTENT_BUNDLE_PUBLIC_ID,
      manifest.subjectId,
      manifest.bundleVersion,
      manifest.bundleType,
      manifest.status,
      `sha256:${manifest.integrity.digest}`,
      "pkg://@quest-city-web/content-runtime/content/web-tranche2-quick-question-set-content#WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST",
      manifest.publishedAt,
    ],
  );
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
  ]);
}

/** Mirrors tools/seed-assignment.ts exactly. */
async function seedTranche2Assignment(tenantId: string, classId: string): Promise<string> {
  const assignmentResult = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Domande rapide: equazioni', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
    [tenantId, classId, WEB_TRANCHE2_ASSIGNMENT_PUBLIC_ID, WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID],
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

describe("Tranche 2 real content bundle + assignment materialization", () => {
  it("the seeded content_bundle is a real, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED, WEB-compatible)", async () => {
    await seedTranche2ContentBundle();
    const bundle = await new ContentBundleRepository(pool).findById(WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID);
    expect(bundle).not.toBeNull();
    expect(bundle?.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(bundle?.status).toBe("PUBLISHED");
    expect(bundle?.compatibleRuntimes).toEqual(["WEB"]);
  });

  it("resolveEngineDispatch resolves the real content_bundle id to ENG-QUICK with the real (non-invented) ITEM_SET config", () => {
    const dispatch = resolveEngineDispatch(WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID);
    expect(dispatch).toBeDefined();
    expect(dispatch?.runtimeAdapterId).toBe("QC-WEB-ENGINE-QUICK-QUESTION");
    const config = dispatch?.config as typeof WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG;
    expect(config.mode).toBe("ITEM_SET");
    if (config.mode === "ITEM_SET") {
      expect(config.items).toHaveLength(6);
    }
  });
});

describe("Tranche 2 full attempt lifecycle against real content (one wrong item, non-punitive completion)", () => {
  it("launch-context -> answer all 6 items (I003 wrong, rest correct) -> complete: consolidates the real aggregate outcome", async () => {
    const fx = await buildFixture();
    await seedTranche2ContentBundle();
    const assignmentId = await seedTranche2Assignment(fx.tenantId, fx.classId);

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
      creationIdempotencyKey: "web-tranche2-launch-key-000001",
    });
    expect(attempt.contentId).toBe(WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID);

    const semanticActions = new SemanticActionLogRepository(pool);
    await attempts.transitionToInProgress(attempt.id, fx.tenantId);

    // I003 answered wrong ("A", MAT.MIS.ALG.001), the remaining 5 items answered correctly.
    const answers: Array<{ actionType: "SELECT_OPTION" | "ENTER_VALUE"; targetRole: string; payload: Record<string, unknown> }> = [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "A" } }, // I003 -> wrong
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "D" } }, // I004 -> correct
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 13 } }, // I006 -> correct
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 6 } }, // I007 -> correct
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 4 } }, // I009 -> correct
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 5 } }, // I010 -> correct
    ];
    let clientSequence = 0;
    for (const answer of answers) {
      await semanticActions.insert({
        tenantId: fx.tenantId,
        attemptId: attempt.id,
        actionId: `act-${clientSequence}`,
        actionType: answer.actionType,
        targetRole: answer.targetRole,
        payload: answer.payload,
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
    expect(actions).toHaveLength(12); // 6 items x (1 answer + 1 confirm)
    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses, createDefaultEngineRuntimeRegistry());
    const result = await consolidation.consolidate({
      attemptId: attempt.id,
      tenantId: fx.tenantId,
      contentId: attempt.contentId,
      actions,
    });

    expect(result.completionStatus).toBe("CONSOLIDATED");
    // Non-punitive (07_13 §6): the set completes and consolidates even
    // though one item was wrong — the aggregate `outcome.score` reflects
    // that (score is 0|1 binary per the engine-runtime contract, 0 here
    // since not all 6 items were correct), but the attempt itself reaches
    // COMPLETED/CONSOLIDATED, not blocked or discarded. `correctness` is
    // stored separately on `attempt_response`, not on `outcome`.
    expect(result.outcome).toMatchObject({ score: 0 });

    const finalAttempt = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(finalAttempt?.attemptState).toBe("COMPLETED");

    const responses = await attemptResponses.findByAttempt(attempt.id, fx.tenantId);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.correctness).toBe("INCORRECT");
  });

  it("activityId (WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID) is a real, stable identifier", () => {
    expect(WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID.length).toBeGreaterThan(0);
    expect(WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID).not.toBe("fixture-balance-machine");
  });
});

describe("Tranche 2 durable restart/resume — orchestrator stage state (07_26 v1.0 §11, §16)", () => {
  it("the single QUICK_QUESTION_SET stage survives a simulated process restart without resetting, and completes/sticks after a second restart", async () => {
    const fx = await buildFixture();
    const definition = WEB_TRANCHE2_QUICK_QUESTION_SET_SEQUENCE_DEFINITION;

    const repoBeforeRestart = new SequenceRuntimeStateRepository(pool);
    let state = initializeSequence(definition, randomUUID());
    const created = await repoBeforeRestart.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state,
    });
    expect(created.state.currentStageId).toBe(WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID);

    // Simulate a process restart: a brand-new Pool/repository, no shared in-process state whatsoever.
    const restartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const repoAfterRestart = new SequenceRuntimeStateRepository(restartPool);
      const resumed = await repoAfterRestart.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, definition.sequenceId);
      expect(resumed).not.toBeNull();
      expect(resumed?.state.currentStageId).toBe(WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID);
      expect(resumed?.state.sequenceCompletionState).toBe("IN_PROGRESS");

      // The whole item set was answered (mirroring a real aggregate
      // ON_ENGINE_EVALUATION_ANY result already applied client-side) —
      // ADVANCED completes the sequence since it is the only stage.
      const outcome = receiveEngineResult(definition, resumed!.state, {
        evaluated: true,
        correctness: "CORRECT",
        score: 1,
        evidence: { mode: "ITEM_SET", itemResults: [], correctCount: 6, totalItems: 6 },
      });
      expect(outcome.outcome).toBe("ADVANCED");
      const completed = advanceStage(definition, outcome.state);
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
      expect(finalState?.state.stageStates.find((s) => s.stageId === WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID)?.status).toBe("COMPLETED");
    } finally {
      await secondRestartPool.end();
    }
  });
});

describe("Tranche 2 durable restart/resume — engine-level item progress via action-log replay (07_26 v1.0 §13)", () => {
  it("completing 2 of 6 items, then replaying the real semantic_action_log through the real engine (simulated restart) resumes at item 3 — no item skipped, no silent reset", async () => {
    const fx = await buildFixture();
    await seedTranche2ContentBundle();
    const assignmentId = await seedTranche2Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const semanticActions = new SemanticActionLogRepository(pool);

    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-tranche2-resume-key-000001",
    });
    await attempts.transitionToInProgress(attempt.id, fx.tenantId);

    // Complete item 1 (I003, correct "B") and item 2 (I004, correct "D") — leave the rest pending.
    let clientSequence = 0;
    for (const optionId of ["B", "D"]) {
      await semanticActions.insert({
        tenantId: fx.tenantId,
        attemptId: attempt.id,
        actionId: `act-select-${clientSequence}`,
        actionType: "SELECT_OPTION",
        targetRole: "option",
        payload: { optionId },
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

    // Simulate a browser reload against a real restart: brand-new Pool, re-read the action log, replay it through a fresh engine instance — exactly what GET /attempts/{attemptId}/actions + EngineHost's initialActions prop do together.
    const restartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const restartActions = new SemanticActionLogRepository(restartPool);
      const loggedActions = await restartActions.findByAttempt(attempt.id, fx.tenantId);
      expect(loggedActions).toHaveLength(4); // 2 items x (1 select + 1 confirm), nothing duplicated

      const engine = createDefaultEngineRuntimeRegistry().getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
      const validation = engine.validateConfig(WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG);
      expect(validation.valid).toBe(true);
      if (!validation.valid) return;
      const replay = replayActions(
        engine,
        validation.config,
        loggedActions.map((a) => ({ actionType: a.actionType, targetRole: a.targetRole, payload: a.payload })),
      );
      expect(replay.acceptedCount).toBe(4);
      const resumedState = replay.state as { currentItemIndex?: number; itemResults?: Array<{ itemId: string; correctness: string }> };
      // Resumed at item 3 (index 2), not item 1 — the exact "no item skipped, no silent reset" requirement.
      expect(resumedState.currentItemIndex).toBe(2);
      expect(resumedState.itemResults).toHaveLength(2);
      expect(resumedState.itemResults?.map((r) => r.correctness)).toEqual(["CORRECT", "CORRECT"]);
    } finally {
      await restartPool.end();
    }
  });
});
