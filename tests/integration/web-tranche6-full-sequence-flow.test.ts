import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  AttemptConsolidationService,
  AttemptResponseRepository,
  ContentBundleRepository,
  isWhollyNonInteractiveContentBundle,
  LearningAttemptRepository,
  resolveEngineDispatch,
  SemanticActionLogRepository,
  SequenceRuntimeStateRepository,
} from "@quest-city-web/attempts";
import { AuditRepository } from "@quest-city-web/identity";
import { createDefaultEngineRuntimeRegistry, replayActions, type EngineSemanticAction } from "@quest-city-web/learning-engines";
import {
  addAttemptReference,
  advanceStage,
  initializeSequence,
  isSequenceComplete,
  loadBundleManifest,
  receiveEngineResult,
  resolveCurrentStage,
  resolveWebTranche6StageGroup,
  type WebContentBundleManifest,
  WEB_M4_ACTIVITY_STAGE_ID,
  WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST,
  WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG,
  WEB_M4_BALANCE_MACHINE_SOLUTION,
  WEB_M4_MAT_M06_ASSIGNMENT_PUBLIC_ID,
  WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE1_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST,
  WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID,
  WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG,
  WEB_TRANCHE2_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST,
  WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG,
  WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID,
  WEB_TRANCHE3_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST,
  WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG,
  WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID,
  WEB_TRANCHE4_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG,
  WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID,
  WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE5_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST,
  WEB_TRANCHE5_INTRO_HOOK_STAGE_ID,
  WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION,
  WEB_TRANCHE6_REFLECTION_ASSIGNMENT_PUBLIC_ID,
  WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST,
  WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_TRANCHE6_REFLECTION_STAGE_ID,
} from "@quest-city-web/content-runtime";

/**
 * M06 Web Full Vertical Slice Tranche 6 (`07_26 v1.1` §17.4) end-to-end
 * integration: the unified 14-entry `SequenceDefinition` driven exactly the
 * way `FullSequenceHost` drives it — one durable outer `SequenceRuntimeState`
 * (R3C.3), and one real `learning_attempt` per attempt-bearing group,
 * created lazily as the outer orchestration reaches it and recorded via
 * `addAttemptReference` (dormant since R3C.2, first real consumer here).
 * Repository-level (no HTTP/Next.js server), same convention as
 * `web-tranche5-intro-hook-flow.test.ts` / `sequence-runtime-state.test.ts`.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- web-tranche6-full-sequence-flow
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

interface GroupSeed {
  label: string;
  manifest: WebContentBundleManifest;
  contentBundleId: string;
  contentBundlePublicId: string;
  assignmentPublicId: string;
  pkgRef: string;
}

const GROUP_SEEDS: GroupSeed[] = [
  {
    label: "intro-hook",
    manifest: WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST,
    contentBundleId: WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID,
    contentBundlePublicId: "bnd_web_tranche5_intro_hook",
    assignmentPublicId: WEB_TRANCHE5_ASSIGNMENT_PUBLIC_ID,
    pkgRef: "web-tranche5-intro-hook-content#WEB_TRANCHE5_INTRO_HOOK_BUNDLE_MANIFEST",
  },
  {
    label: "prerequisite-check",
    manifest: WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST,
    contentBundleId: WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID,
    contentBundlePublicId: "bnd_web_tranche3_prerequisite_check_micro_lesson",
    assignmentPublicId: WEB_TRANCHE3_ASSIGNMENT_PUBLIC_ID,
    pkgRef: "web-tranche3-prerequisite-check-micro-lesson-content#WEB_TRANCHE3_PREREQUISITE_CHECK_BUNDLE_MANIFEST",
  },
  {
    label: "quick-question-set",
    manifest: WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST,
    contentBundleId: WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID,
    contentBundlePublicId: "bnd_web_tranche2_quick_question_set",
    assignmentPublicId: WEB_TRANCHE2_ASSIGNMENT_PUBLIC_ID,
    pkgRef: "web-tranche2-quick-question-set-content#WEB_TRANCHE2_QUICK_QUESTION_SET_BUNDLE_MANIFEST",
  },
  {
    label: "guided-practice",
    manifest: WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST,
    contentBundleId: WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID,
    contentBundlePublicId: "bnd_web_tranche1_guided_practice_reflection",
    assignmentPublicId: WEB_TRANCHE1_ASSIGNMENT_PUBLIC_ID,
    pkgRef: "web-tranche1-guided-practice-content#WEB_TRANCHE1_GUIDED_PRACTICE_BUNDLE_MANIFEST",
  },
  {
    label: "interactive-exercise",
    manifest: WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST,
    contentBundleId: WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID,
    contentBundlePublicId: "bnd_web_tranche4_interactive_exercise",
    assignmentPublicId: WEB_TRANCHE4_ASSIGNMENT_PUBLIC_ID,
    pkgRef: "web-tranche4-interactive-exercise-content#WEB_TRANCHE4_INTERACTIVE_EXERCISE_BUNDLE_MANIFEST",
  },
  {
    label: "balance-verification",
    manifest: WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST,
    contentBundleId: WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
    contentBundlePublicId: "bnd_web_m4_mat_m06_balance",
    assignmentPublicId: WEB_M4_MAT_M06_ASSIGNMENT_PUBLIC_ID,
    pkgRef: "web-m4-real-content#WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST",
  },
  {
    label: "reflection-and-result",
    manifest: WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST,
    contentBundleId: WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID,
    contentBundlePublicId: "bnd_web_tranche6_full_sequence_reflection",
    assignmentPublicId: WEB_TRANCHE6_REFLECTION_ASSIGNMENT_PUBLIC_ID,
    pkgRef: "web-tranche6-full-sequence-content#WEB_TRANCHE6_REFLECTION_BUNDLE_MANIFEST",
  },
];

async function seedAllGroups(tenantId: string, classId: string): Promise<void> {
  for (const seed of GROUP_SEEDS) {
    const validation = loadBundleManifest(seed.manifest);
    if (!validation.ok) throw new Error(`${seed.label} manifest invalid: ${validation.errors.join("; ")}`);
    const manifest = seed.manifest;
    await pool.query(
      `INSERT INTO content_bundle (id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        seed.contentBundleId,
        seed.contentBundlePublicId,
        manifest.subjectId,
        manifest.bundleVersion,
        manifest.bundleType,
        manifest.status,
        `sha256:${manifest.integrity.digest}`,
        `pkg://@quest-city-web/content-runtime/content/${seed.pkgRef}`,
        manifest.publishedAt,
      ],
    );
    await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
      seed.contentBundleId,
    ]);
    const assignmentResult = await pool.query<{ id: string }>(
      `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
       VALUES ($1, $2, $3, $4, 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $5) RETURNING id`,
      [tenantId, classId, seed.assignmentPublicId, `Full sequence group: ${seed.label}`, seed.contentBundleId],
    );
    await pool.query(`INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, 'WEB')`, [
      assignmentResult.rows[0]!.id,
      tenantId,
    ]);
  }
}

async function findAssignmentIdByPublicId(tenantId: string, publicId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`SELECT id FROM assignment WHERE tenant_id = $1 AND public_id = $2`, [
    tenantId,
    publicId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error(`assignment ${publicId} not found`);
  return row.id;
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("Tranche 6 group content materialization — all 7 groups seed as real, distinct, servable bundles", () => {
  it("every group's manifest validates and is a distinct content_bundle row", async () => {
    const fx = await buildFixture();
    await seedAllGroups(fx.tenantId, fx.classId);
    const bundles = new ContentBundleRepository(pool);
    for (const seed of GROUP_SEEDS) {
      const bundle = await bundles.findById(seed.contentBundleId);
      expect(bundle, seed.label).not.toBeNull();
      expect(bundle?.status).toBe("PUBLISHED");
    }
  });

  it("resolveEngineDispatch (server-side, contentId-keyed) resolves the 5 pre-existing interactive groups unchanged, and never resolves the two wholly non-interactive groups (INTRO_HOOK, REFLECTION_AND_RESULT)", () => {
    expect(resolveEngineDispatch(WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID)?.runtimeAdapterId).toBe("QC-WEB-ENGINE-QUICK-QUESTION");
    expect(resolveEngineDispatch(WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID)?.runtimeAdapterId).toBe("QC-WEB-ENGINE-QUICK-QUESTION");
    expect(resolveEngineDispatch(WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID)?.runtimeAdapterId).toBe("QC-WEB-ENGINE-QUICK-QUESTION");
    expect(resolveEngineDispatch(WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID)?.runtimeAdapterId).toBe("QC-WEB-ENGINE-DRAG-DROP");
    expect(resolveEngineDispatch(WEB_M4_MAT_M06_CONTENT_BUNDLE_ID)?.runtimeAdapterId).toBe("QC-WEB-ENGINE-BALANCE-MACHINE");
    expect(resolveEngineDispatch(WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID)).toBeUndefined();
    expect(resolveEngineDispatch(WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID)).toBeUndefined();
  });

  it("isWhollyNonInteractiveContentBundle is true for INTRO_HOOK and the new REFLECTION_AND_RESULT group, false for the 5 interactive groups", () => {
    expect(isWhollyNonInteractiveContentBundle(WEB_TRANCHE5_MAT_M06_CONTENT_BUNDLE_ID)).toBe(true);
    expect(isWhollyNonInteractiveContentBundle(WEB_TRANCHE6_REFLECTION_MAT_M06_CONTENT_BUNDLE_ID)).toBe(true);
    expect(isWhollyNonInteractiveContentBundle(WEB_TRANCHE3_MAT_M06_CONTENT_BUNDLE_ID)).toBe(false);
    expect(isWhollyNonInteractiveContentBundle(WEB_TRANCHE2_MAT_M06_CONTENT_BUNDLE_ID)).toBe(false);
    expect(isWhollyNonInteractiveContentBundle(WEB_TRANCHE1_MAT_M06_CONTENT_BUNDLE_ID)).toBe(false);
    expect(isWhollyNonInteractiveContentBundle(WEB_TRANCHE4_MAT_M06_CONTENT_BUNDLE_ID)).toBe(false);
    expect(isWhollyNonInteractiveContentBundle(WEB_M4_MAT_M06_CONTENT_BUNDLE_ID)).toBe(false);
  });
});

describe("Tranche 6 full 14-entry sequence traversal — one real attempt per group, durable outer state, no fabricated outcomes", () => {
  it("completes end-to-end: 7 real learning_attempt rows (5 CORRECT-scored, 2 score-less), outer SequenceRuntimeState COMPLETED, durable resume verified mid-flight", async () => {
    const fx = await buildFixture();
    await seedAllGroups(fx.tenantId, fx.classId);

    const definition = WEB_TRANCHE6_FULL_M06_SEQUENCE_DEFINITION;
    const attempts = new LearningAttemptRepository(pool);
    const actionsRepo = new SemanticActionLogRepository(pool);
    const attemptResponses = new AttemptResponseRepository(pool);
    const audit = new AuditRepository(pool);
    const engineRegistry = createDefaultEngineRuntimeRegistry();
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses, engineRegistry);
    const runtimeStateRepo = new SequenceRuntimeStateRepository(pool);

    let state = initializeSequence(definition, randomUUID());
    const created = await runtimeStateRepo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state,
    });
    let version = created.version;
    state = created.state;

    const groupAttemptIds = new Map<string, string>();

    /** Mirrors FullSequenceHost's group-resolution effect: create-or-reuse the current stage's group attempt. */
    async function ensureGroupAttempt(): Promise<string> {
      const stage = resolveCurrentStage(definition, state);
      const group = resolveWebTranche6StageGroup(stage.stageId);
      const existingRef = state.attemptReferences.find((r) => r.stageId === group.groupStageId);
      if (existingRef) return existingRef.attemptId;
      const assignmentId = await findAssignmentIdByPublicId(fx.tenantId, group.assignmentPublicId);
      const attempt = await attempts.create({
        tenantId: fx.tenantId,
        eventId: randomUUID(),
        assignmentId,
        studentProfileId: fx.studentProfileId,
        enrollmentId: fx.enrollmentId,
        contentBundleId: group.contentBundleId,
        contentId: group.contentBundleId,
        contentVersion: "1.0.0",
        runtimeChannel: "WEB",
        creationIdempotencyKey: `tr6-${group.groupStageId}-${fx.studentProfileId}`,
      });
      state = addAttemptReference(state, group.groupStageId, attempt.id);
      groupAttemptIds.set(group.groupStageId, attempt.id);
      const saved = await runtimeStateRepo.save(fx.tenantId, fx.studentProfileId, definition.sequenceId, version, state);
      if (!saved) throw new Error("unexpected version conflict");
      version = saved.version;
      state = saved.state;
      return attempt.id;
    }

    async function applyNonInteractiveTrigger(attemptId: string): Promise<void> {
      const attempt = await attempts.findByIdAndTenant(attemptId, fx.tenantId);
      if (!attempt) throw new Error("attempt not found");
      expect(isWhollyNonInteractiveContentBundle(attempt.contentId)).toBe(true);
      if (attempt.attemptState !== "CREATED") return;
      const updated = await attempts.transitionToInProgress(attemptId, fx.tenantId);
      if (updated?.attemptState === "IN_PROGRESS") {
        await audit.record({
          tenantId: fx.tenantId,
          actorType: "SYSTEM",
          action: "orchestration_stage_entry_attempt_transitioned",
          targetType: "learning_attempt",
          targetId: attemptId,
          result: "SUCCESS",
          metadataRedacted: { fromState: "CREATED", toState: "IN_PROGRESS" },
        });
      }
    }

    async function completeGroupAttempt(attemptId: string, actions: EngineSemanticAction[], startingClientSequence = 0): Promise<void> {
      let clientSequence = startingClientSequence;
      for (const action of actions) {
        await actionsRepo.insert({
          tenantId: fx.tenantId,
          attemptId,
          actionId: `act-${attemptId}-${clientSequence}`,
          actionType: action.actionType,
          ...(action.targetRole ? { targetRole: action.targetRole } : {}),
          payload: action.payload,
          clientSequence,
          runtimeChannel: "WEB",
          occurredAt: new Date(),
        });
        clientSequence += 1;
      }
      const inProgress = await attempts.findByIdAndTenant(attemptId, fx.tenantId);
      if (inProgress?.attemptState === "CREATED") {
        await attempts.transitionToInProgress(attemptId, fx.tenantId);
      }
      const submitted = await attempts.transitionToCompletionSubmitted(attemptId, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
      expect(submitted?.attemptState).toBe("COMPLETION_SUBMITTED");
      const persistedActions = await actionsRepo.findByAttempt(attemptId, fx.tenantId);
      const result = await consolidation.consolidate({
        attemptId,
        tenantId: fx.tenantId,
        contentId: inProgress!.contentId,
        actions: persistedActions,
      });
      expect(result.completionStatus).toBe("CONSOLIDATED");
    }

    /** Advances the outer orchestration and completes the outgoing group's attempt when a group boundary is crossed — mirrors FullSequenceHost.maybeCompleteOutgoingGroup. */
    async function advanceOuter(outgoingAttemptId: string | null, outgoingGroupStageId: string | null): Promise<void> {
      state = advanceStage(definition, state);
      const saved = await runtimeStateRepo.save(fx.tenantId, fx.studentProfileId, definition.sequenceId, version, state);
      if (!saved) throw new Error("unexpected version conflict");
      version = saved.version;
      state = saved.state;
      if (!outgoingAttemptId || !outgoingGroupStageId) return;
      const stillSameGroup =
        !isSequenceComplete(state) && resolveWebTranche6StageGroup(state.currentStageId).groupStageId === outgoingGroupStageId;
      if (stillSameGroup) return;
      const attempt = await attempts.findByIdAndTenant(outgoingAttemptId, fx.tenantId);
      if (attempt?.attemptState === "COMPLETED") return; // already completed via completeGroupAttempt (interactive path)
      // Non-interactive group, no actions ever submitted (INTRO_HOOK / REFLECTION_AND_RESULT).
      const submitted = await attempts.transitionToCompletionSubmitted(outgoingAttemptId, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
      expect(submitted?.attemptState).toBe("COMPLETION_SUBMITTED");
      const result = await consolidation.consolidate({
        attemptId: outgoingAttemptId,
        tenantId: fx.tenantId,
        contentId: attempt!.contentId,
        actions: [],
      });
      expect(result.completionStatus).toBe("CONSOLIDATED");
      expect(result.outcome).not.toHaveProperty("score");
    }

    // --- Stage 1: INTRO_HOOK (non-interactive, own group) ---
    expect(state.currentStageId).toBe(WEB_TRANCHE5_INTRO_HOOK_STAGE_ID);
    let attemptId = await ensureGroupAttempt();
    await applyNonInteractiveTrigger(attemptId);
    const loggedForIntro = await actionsRepo.findByAttempt(attemptId, fx.tenantId);
    expect(loggedForIntro).toEqual([]); // never a semantic action, 07_15_01 §11-bis.2-bis
    await advanceOuter(attemptId, WEB_TRANCHE5_INTRO_HOOK_STAGE_ID);

    // Durable resume scenario A: reload the outer state fresh from the DB after crossing the first group boundary.
    const reloadedAfterIntro = await runtimeStateRepo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, definition.sequenceId);
    expect(reloadedAfterIntro).not.toBeNull();
    expect(reloadedAfterIntro!.state.currentStageId).toBe(WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID);
    state = reloadedAfterIntro!.state;
    version = reloadedAfterIntro!.version;

    // --- Stage group 2: PREREQUISITE_CHECK + 7x MICRO_LESSON (one attempt, real correct answers) ---
    attemptId = await ensureGroupAttempt();
    const prereqValidation = engineRegistry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!.validateConfig(WEB_TRANCHE3_PREREQUISITE_CHECK_ENGINE_CONFIG);
    if (!prereqValidation.valid) throw new Error("unreachable");
    const prereqActions: EngineSemanticAction[] = [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "A" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "C" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ];
    {
      const engine = engineRegistry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
      const { state: engineState } = replayActions(engine, prereqValidation.config, prereqActions);
      const evaluation = engine.evaluate(engineState, prereqValidation.config);
      expect(evaluation).toMatchObject({ evaluated: true, correctness: "CORRECT" });
      const outcome = receiveEngineResult(definition, state, evaluation);
      expect(outcome.outcome).toBe("ADVANCED"); // ON_ENGINE_EVALUATION_ANY
      state = outcome.state;
    }
    await completeGroupAttempt(attemptId, prereqActions);
    // The prerequisite-check group spans 8 stages (PREREQUISITE_CHECK + 7 MICRO_LESSON sub-stages), so exactly 8
    // advanceStage calls are needed to walk from PREREQUISITE_CHECK (the group's first stage, current now) past
    // the last MICRO_LESSON sub-stage into QUICK_QUESTION_SET. advanceOuter is safe to call with the
    // (already-COMPLETED) attemptId on every hop: maybeCompleteOutgoingGroup no-ops until the group boundary is
    // actually crossed, and even then it sees the attempt already COMPLETED (via completeGroupAttempt above) and
    // skips re-completion.
    for (let i = 0; i < 8; i += 1) {
      const stillInGroup = resolveWebTranche6StageGroup(state.currentStageId).groupStageId === WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID;
      expect(stillInGroup, `iteration ${i}`).toBe(true);
      await advanceOuter(attemptId, WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID);
    }
    expect(resolveWebTranche6StageGroup(state.currentStageId).groupStageId).not.toBe(WEB_TRANCHE3_PREREQUISITE_CHECK_STAGE_ID);

    // --- Stage group 3: QUICK_QUESTION_SET (durable resume scenario B: reload mid-item-set) ---
    attemptId = await ensureGroupAttempt();
    const qqEngine = engineRegistry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const qqValidation = qqEngine.validateConfig(WEB_TRANCHE2_QUICK_QUESTION_SET_ENGINE_CONFIG);
    if (!qqValidation.valid) throw new Error("unreachable");
    const qqAllAnswers: EngineSemanticAction[] = [
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "B" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "SELECT_OPTION", targetRole: "option", payload: { optionId: "D" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 13 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 6 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 4 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 5 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ];
    // Log only the first item's 2 actions, then reload from the DB (resume scenario B: "complete only part of the item set, reload").
    await actionsRepo.insert({
      tenantId: fx.tenantId,
      attemptId,
      actionId: "act-qq-0",
      actionType: "SELECT_OPTION",
      targetRole: "option",
      payload: { optionId: "B" },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    await actionsRepo.insert({
      tenantId: fx.tenantId,
      attemptId,
      actionId: "act-qq-1",
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
      clientSequence: 1,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    const partialActions = await actionsRepo.findByAttempt(attemptId, fx.tenantId);
    expect(partialActions).toHaveLength(2); // durable resume resumes exactly from item 2, not from scratch
    const { state: partialEngineState } = replayActions(qqEngine, qqValidation.config, partialActions as unknown as EngineSemanticAction[]);
    const partialEvaluation = qqEngine.evaluate(partialEngineState, qqValidation.config);
    expect(partialEvaluation.evaluated).toBe(false); // set not complete yet — engine-level resume reconstructs correctly (scenario C)
    // The first item's 2 actions are already persisted (above) — only the remaining 10 are inserted here, continuing clientSequence from 2.
    await completeGroupAttempt(attemptId, qqAllAnswers.slice(2), 2);
    {
      const { state: engineState } = replayActions(qqEngine, qqValidation.config, qqAllAnswers);
      const evaluation = qqEngine.evaluate(engineState, qqValidation.config);
      const outcome = receiveEngineResult(definition, state, evaluation);
      expect(outcome.outcome).toBe("ADVANCED");
      state = outcome.state;
    }
    await advanceOuter(attemptId, WEB_TRANCHE2_QUICK_QUESTION_SET_STAGE_ID);

    // --- Stage group 4: GUIDED_PRACTICE ---
    attemptId = await ensureGroupAttempt();
    const gpEngine = engineRegistry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")!;
    const gpValidation = gpEngine.validateConfig(WEB_TRANCHE1_QUICK_QUESTION_ENGINE_CONFIG);
    if (!gpValidation.valid) throw new Error("unreachable");
    const gpActions: EngineSemanticAction[] = [
      { actionType: "ENTER_VALUE", targetRole: "value-input", payload: { value: 7 } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ];
    {
      const { state: engineState } = replayActions(gpEngine, gpValidation.config, gpActions);
      const evaluation = gpEngine.evaluate(engineState, gpValidation.config);
      expect(evaluation).toMatchObject({ evaluated: true, correctness: "CORRECT" });
      const outcome = receiveEngineResult(definition, state, evaluation);
      expect(outcome.outcome).toBe("ADVANCED"); // ON_ENGINE_EVALUATION_CORRECT
      state = outcome.state;
    }
    await completeGroupAttempt(attemptId, gpActions);
    await advanceOuter(attemptId, WEB_TRANCHE1_GUIDED_PRACTICE_STAGE_ID);

    // --- Stage group 5: INTERACTIVE_EXERCISE (durable resume scenario C: partial engine state via one PLACE_ITEM, no CONFIRM) ---
    attemptId = await ensureGroupAttempt();
    const dragEngine = engineRegistry.getByRuntimeAdapterId("QC-WEB-ENGINE-DRAG-DROP")!;
    const dragValidation = dragEngine.validateConfig(WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG);
    if (!dragValidation.valid) throw new Error("unreachable");
    const mapping = WEB_TRANCHE4_INTERACTIVE_EXERCISE_ENGINE_CONFIG.correctMapping;
    const dragActions: EngineSemanticAction[] = [
      ...mapping.map((m) => ({ actionType: "PLACE_ITEM" as const, targetRole: "drop-target", payload: { itemId: m.itemId, targetId: m.targetId } })),
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ];
    await actionsRepo.insert({
      tenantId: fx.tenantId,
      attemptId,
      actionId: "act-drag-partial",
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: mapping[0]!.itemId, targetId: mapping[0]!.targetId },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    const partialDragActions = await actionsRepo.findByAttempt(attemptId, fx.tenantId);
    const { state: partialDragState } = replayActions(dragEngine, dragValidation.config, partialDragActions as unknown as EngineSemanticAction[]);
    const partialDragEvaluation = dragEngine.evaluate(partialDragState, dragValidation.config);
    expect(partialDragEvaluation.evaluated).toBe(false); // reconstructed mid-interaction state, not yet confirmed
    // mapping[0]'s PLACE_ITEM is already persisted (above) — only the remaining actions are inserted here, continuing clientSequence from 1.
    await completeGroupAttempt(attemptId, dragActions.slice(1), 1);
    {
      const { state: engineState } = replayActions(dragEngine, dragValidation.config, dragActions);
      const evaluation = dragEngine.evaluate(engineState, dragValidation.config);
      expect(evaluation).toMatchObject({ evaluated: true, correctness: "CORRECT" });
      const outcome = receiveEngineResult(definition, state, evaluation);
      expect(outcome.outcome).toBe("ADVANCED");
      state = outcome.state;
    }
    await advanceOuter(attemptId, WEB_TRANCHE4_INTERACTIVE_EXERCISE_STAGE_ID);

    // --- Stage group 6: BALANCE_MACHINE_CHALLENGE ---
    attemptId = await ensureGroupAttempt();
    const balanceEngine = engineRegistry.getByRuntimeAdapterId("QC-WEB-ENGINE-BALANCE-MACHINE")!;
    const balanceValidation = balanceEngine.validateConfig(WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG);
    if (!balanceValidation.valid) throw new Error("unreachable");
    const balanceActions: EngineSemanticAction[] = [
      ...Object.entries(WEB_M4_BALANCE_MACHINE_SOLUTION).map(([tokenId, side]) => ({
        actionType: "PLACE_ITEM" as const,
        targetRole: "weight-token",
        payload: { tokenId, side },
      })),
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ];
    {
      const { state: engineState } = replayActions(balanceEngine, balanceValidation.config, balanceActions);
      const evaluation = balanceEngine.evaluate(engineState, balanceValidation.config);
      expect(evaluation).toMatchObject({ evaluated: true, correctness: "CORRECT" });
      const outcome = receiveEngineResult(definition, state, evaluation);
      expect(outcome.outcome).toBe("ADVANCED");
      state = outcome.state;
    }
    await completeGroupAttempt(attemptId, balanceActions);
    await advanceOuter(attemptId, WEB_M4_ACTIVITY_STAGE_ID);

    // --- Stage group 7: REFLECTION_AND_RESULT (non-interactive, own group, last stage) ---
    expect(state.currentStageId).toBe(WEB_TRANCHE6_REFLECTION_STAGE_ID);
    attemptId = await ensureGroupAttempt();
    await applyNonInteractiveTrigger(attemptId);
    // Idempotency (resume scenario D): re-applying the trigger is a silent no-op, never a second audit_event.
    await applyNonInteractiveTrigger(attemptId);
    const auditRows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_event WHERE target_id = $1 AND action = 'orchestration_stage_entry_attempt_transitioned'`,
      [attemptId],
    );
    expect(auditRows.rows[0]?.count).toBe("1");
    await advanceOuter(attemptId, WEB_TRANCHE6_REFLECTION_STAGE_ID);

    // --- Final assertions ---
    expect(isSequenceComplete(state)).toBe(true);
    expect(state.stageStates).toHaveLength(14);
    expect(state.stageStates.every((s) => s.status === "COMPLETED")).toBe(true);
    expect(state.attemptReferences).toHaveLength(7);
    expect(new Set(state.attemptReferences.map((r) => r.attemptId)).size).toBe(7); // 7 distinct real attempts, no reuse/collision

    for (const ref of state.attemptReferences) {
      const attempt = await attempts.findByIdAndTenant(ref.attemptId, fx.tenantId);
      expect(attempt?.attemptState, ref.stageId).toBe("COMPLETED");
      expect(attempt?.completionStatus, ref.stageId).toBe("CONSOLIDATED");
    }

    // Durable resume scenario A (final): the fully-completed outer state reloads correctly from a fresh query.
    const finalReload = await runtimeStateRepo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, definition.sequenceId);
    expect(finalReload).not.toBeNull();
    expect(isSequenceComplete(finalReload!.state)).toBe(true);
  });
});
