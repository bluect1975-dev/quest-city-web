import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  SequenceRuntimeStateRepository,
  SequenceRuntimeStateAlreadyExistsError,
  DurableSequenceRuntimeStateStore,
  SequenceRuntimeStateVersionConflictError,
} from "@quest-city-web/attempts";
import {
  InMemorySequenceRuntimeStateStore,
  addAttemptReference,
  advanceStage,
  initializeSequence,
  isSequenceComplete,
  requestHint,
  type SequenceDefinition,
  type SequenceRuntimeState,
} from "@quest-city-web/content-runtime";

/**
 * R3C.3 integration tests against a real, dockerized PostgreSQL instance
 * with migrations 0001-0019 applied — same pattern/connection convention
 * as `attempt-lifecycle.test.ts`.
 *
 * Re-scoped by migration 0019 (UAT Failure Remediation,
 * `UAT-RC4-NEW-ASSIGNMENT-LAUNCH-STATE-01`): ownership moved from
 * `(tenant, student, sequence)` to `(tenant, attempt)`, so every fixture
 * here now creates a real `learning_attempt` row (via a real
 * `content_bundle` + `assignment`) rather than only a bare
 * tenant/student/enrollment triple.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

interface Fixture {
  tenantId: string;
  otherTenantId: string;
  studentProfileId: string;
  otherStudentProfileId: string;
  enrollmentId: string;
  otherEnrollmentId: string;
  classId: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE sequence_runtime_state, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function insertTenantStudentEnrollment(): Promise<{ tenantId: string; studentProfileId: string; enrollmentId: string; classId: string }> {
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

  return { tenantId, studentProfileId, enrollmentId, classId };
}

async function buildFixture(): Promise<Fixture> {
  const a = await insertTenantStudentEnrollment();
  const b = await insertTenantStudentEnrollment();
  return {
    tenantId: a.tenantId,
    otherTenantId: b.tenantId,
    studentProfileId: a.studentProfileId,
    otherStudentProfileId: b.studentProfileId,
    enrollmentId: a.enrollmentId,
    otherEnrollmentId: b.enrollmentId,
    classId: a.classId,
  };
}

/**
 * A real `content_bundle` -> `assignment` -> `learning_attempt` chain, the
 * minimum a `sequence_runtime_state` row can now legally reference
 * (migration 0019's `learning_attempt_id` FK). `sequenceIdLabel` is folded
 * into the bundle's `public_id` only for readability in failed-test
 * output — it has no bearing on the real `SequenceDefinition.sequenceId`
 * the caller drives through `initializeSequence`.
 */
async function insertAttempt(
  tenantId: string,
  studentProfileId: string,
  enrollmentId: string,
  classId: string,
  sequenceIdLabel: string,
): Promise<string> {
  const bundleResult = await pool.query<{ id: string }>(
    `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref)
     VALUES ($1, 'MAT', '1.0.0', 'ACTIVITY_BUNDLE', 'PUBLISHED', $2, 'test://fixture')
     RETURNING id`,
    [`bnd_${sequenceIdLabel}_${Math.random().toString(36).slice(2, 8)}`, `hash_${Math.random().toString(36).slice(2, 10)}`],
  );
  const contentBundleId = bundleResult.rows[0]!.id;

  const assignmentResult = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Test Assignment', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4)
     RETURNING id`,
    [tenantId, classId, `asg_${Math.random().toString(36).slice(2, 10)}`, contentBundleId],
  );
  const assignmentId = assignmentResult.rows[0]!.id;

  const attemptResult = await pool.query<{ id: string }>(
    `INSERT INTO learning_attempt
       (tenant_id, event_id, assignment_id, student_profile_id, enrollment_id, content_bundle_id, content_id, content_version, runtime_channel, creation_idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '1.0.0', 'WEB', $8)
     RETURNING id`,
    [
      tenantId,
      `evt_${randomUUID()}`,
      assignmentId,
      studentProfileId,
      enrollmentId,
      contentBundleId,
      randomUUID(),
      `idem_${randomUUID()}`,
    ],
  );
  return attemptResult.rows[0]!.id;
}

const DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: "R3C3-TEST-SEQUENCE",
  sequenceVersion: "1.0.0",
  stages: [
    { stageId: "intro", stageType: "INTRO_HOOK", order: 0, isInteractive: false },
    {
      stageId: "quick",
      stageType: "QUICK_QUESTION_SET",
      order: 1,
      isInteractive: true,
      progressionRule: { triggerType: "MANUAL" },
      hintPolicy: { maxHintLevel: 2 },
    },
    { stageId: "result", stageType: "REFLECTION_AND_RESULT", order: 2, isInteractive: false },
  ],
};

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("SequenceRuntimeStateRepository — ownership and CRUD (per-attempt, migration 0019)", () => {
  it("create() then findByAttempt() round-trips the exact contract shape", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const initial = initializeSequence(DEFINITION, randomUUID());

    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initial,
    });
    expect(created.version).toBe(1);
    expect(created.state).toEqual(initial);
    expect(created.learningAttemptId).toBe(attemptId);

    const found = await repo.findByAttempt(fx.tenantId, attemptId);
    expect(found?.state).toEqual(initial);
    expect(found?.version).toBe(1);
  });

  it("findByAttempt() returns null for an attempt with no row", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const found = await repo.findByAttempt(fx.tenantId, attemptId);
    expect(found).toBeNull();
  });

  it("a second create() for the same (tenant, attempt) throws SequenceRuntimeStateAlreadyExistsError", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const state = initializeSequence(DEFINITION, randomUUID());
    await repo.create({ tenantId: fx.tenantId, studentProfileId: fx.studentProfileId, enrollmentId: fx.enrollmentId, learningAttemptId: attemptId, state });
    await expect(
      repo.create({
        tenantId: fx.tenantId,
        studentProfileId: fx.studentProfileId,
        enrollmentId: fx.enrollmentId,
        learningAttemptId: attemptId,
        state: initializeSequence(DEFINITION, randomUUID()),
      }),
    ).rejects.toThrow(SequenceRuntimeStateAlreadyExistsError);
  });

  it("create() rejects a state that fails contract validation (defense in depth, never persisted)", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const malformed = { contractType: "SEQUENCE_RUNTIME_STATE", runtimeStateId: "x" } as unknown as SequenceRuntimeState;
    await expect(
      repo.create({ tenantId: fx.tenantId, studentProfileId: fx.studentProfileId, enrollmentId: fx.enrollmentId, learningAttemptId: attemptId, state: malformed }),
    ).rejects.toThrow();
    const found = await repo.findByAttempt(fx.tenantId, attemptId);
    expect(found).toBeNull();
  });

  it("ownership: another student's attempt row is never returned, even within the same tenant", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const sameTenantOther = await pool.query<{ id: string }>(
      `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [fx.tenantId, `std_${Math.random().toString(36).slice(2, 10)}`],
    );
    const otherStudentInSameTenant = sameTenantOther.rows[0]!.id;
    const otherEnrollment = await pool.query<{ id: string }>(
      `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
       VALUES ($1, $2, $3, 'Other', 'other', 'x', 'ACTIVE') RETURNING id`,
      [fx.tenantId, fx.classId, otherStudentInSameTenant],
    );

    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const otherAttemptId = await insertAttempt(fx.tenantId, otherStudentInSameTenant, otherEnrollment.rows[0]!.id, fx.classId, "b");

    await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });

    const foundByOtherAttempt = await repo.findByAttempt(fx.tenantId, otherAttemptId);
    expect(foundByOtherAttempt).toBeNull();
  });

  it("ownership: another tenant's attempt id collision is impossible (FK-scoped) and cross-tenant lookup returns null", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });
    const crossTenant = await repo.findByAttempt(fx.otherTenantId, attemptId);
    expect(crossTenant).toBeNull();
  });
});

/** "intro" (order 0, the sequence's initial stage) has no `hintPolicy` — only "quick" does, so every hint-focused test below must advance past "intro" before requesting a hint. */
function initialStateAtQuickStage(): SequenceRuntimeState {
  return advanceStage(DEFINITION, initializeSequence(DEFINITION, randomUUID()));
}

describe("SequenceRuntimeStateRepository — optimistic concurrency (§11)", () => {
  it("save() with the correct expectedVersion succeeds and increments version", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initialStateAtQuickStage(),
    });
    const mutated = requestHint(DEFINITION, created.state);
    const saved = await repo.save(fx.tenantId, attemptId, created.version, mutated);
    expect(saved).not.toBeNull();
    expect(saved?.version).toBe(2);
    expect(saved?.state.stageStates.find((s) => s.stageId === "quick")?.hintCount).toBe(1);
  });

  it("save() with a stale expectedVersion returns null (conflict) and never overwrites the row", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initialStateAtQuickStage(),
    });
    await repo.save(fx.tenantId, attemptId, created.version, requestHint(DEFINITION, created.state));

    const conflictResult = await repo.save(
      fx.tenantId,
      attemptId,
      created.version,
      requestHint(DEFINITION, requestHint(DEFINITION, created.state)),
    );
    expect(conflictResult).toBeNull();

    const current = await repo.findByAttempt(fx.tenantId, attemptId);
    expect(current?.version).toBe(2);
    expect(current?.state.stageStates.find((s) => s.stageId === "quick")?.hintCount).toBe(1);
  });

  it("two concurrent hint requests from the same stale base: exactly one succeeds, hintCount increments exactly once", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initialStateAtQuickStage(),
    });
    const mutatedA = requestHint(DEFINITION, created.state);
    const mutatedB = requestHint(DEFINITION, created.state);

    const [resultA, resultB] = await Promise.all([
      repo.save(fx.tenantId, attemptId, created.version, mutatedA),
      repo.save(fx.tenantId, attemptId, created.version, mutatedB),
    ]);
    const outcomes = [resultA, resultB];
    expect(outcomes.filter((r) => r !== null)).toHaveLength(1);
    expect(outcomes.filter((r) => r === null)).toHaveLength(1);

    const final = await repo.findByAttempt(fx.tenantId, attemptId);
    expect(final?.state.stageStates.find((s) => s.stageId === "quick")?.hintCount).toBe(1);
  });
});

describe("addAttemptReference dedup (domain-level, §12)", () => {
  it("adding the same {stageId, attemptId} twice never duplicates the reference, even across a persisted round-trip", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });
    const withRef = addAttemptReference(created.state, "quick", attemptId);
    const saved1 = await repo.save(fx.tenantId, attemptId, created.version, withRef);
    expect(saved1?.state.attemptReferences).toHaveLength(1);

    const withRefAgain = addAttemptReference(saved1!.state, "quick", attemptId);
    expect(withRefAgain).toBe(saved1!.state); // same reference, addAttemptReference is a no-op here
    const saved2 = await repo.save(fx.tenantId, attemptId, saved1!.version, withRefAgain);
    expect(saved2?.state.attemptReferences).toHaveLength(1);
  });
});

describe("DurableSequenceRuntimeStateStore — SequenceRuntimeStateStore conformance and parity with InMemory (§17)", () => {
  it("get()/save() drive the same M06-style mutation sequence to the same resulting state as InMemorySequenceRuntimeStateStore", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const durable = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, attemptId);
    const inMemory = new InMemorySequenceRuntimeStateStore();

    const runtimeStateId = randomUUID();
    const initial = initializeSequence(DEFINITION, runtimeStateId);
    await durable.save(initial);
    await inMemory.save(initial);

    async function driveMutations(store: InMemorySequenceRuntimeStateStore | DurableSequenceRuntimeStateStore) {
      let current = (await store.get(runtimeStateId))!;
      current = requestHint(DEFINITION, current);
      await store.save(current);
      current = (await store.get(runtimeStateId))!;
      current = advanceStage(DEFINITION, current); // intro -> quick
      await store.save(current);
      current = (await store.get(runtimeStateId))!;
      current = advanceStage(DEFINITION, current); // quick -> result
      await store.save(current);
      current = (await store.get(runtimeStateId))!;
      current = advanceStage(DEFINITION, current); // result -> COMPLETED
      await store.save(current);
      return (await store.get(runtimeStateId))!;
    }

    const durableFinal = await driveMutations(durable);
    const inMemoryFinal = await driveMutations(inMemory);

    expect(isSequenceComplete(durableFinal)).toBe(true);
    expect(isSequenceComplete(inMemoryFinal)).toBe(true);
    expect(durableFinal).toEqual(inMemoryFinal);
  });

  it("get() throws if the requested runtimeStateId does not match the stored one for this attempt", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const durable = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, attemptId);
    await durable.save(initializeSequence(DEFINITION, "the-real-runtime-state-id"));
    await expect(durable.get("a-different-guessed-runtime-state-id")).rejects.toThrow();
  });

  it("save() after a stale get() throws SequenceRuntimeStateVersionConflictError instead of silently overwriting", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const runtimeStateId = randomUUID();
    const storeA = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, attemptId);
    await storeA.save(initializeSequence(DEFINITION, runtimeStateId));

    const storeB = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, attemptId);
    const stateForA = (await storeA.get(runtimeStateId))!;
    const stateForB = (await storeB.get(runtimeStateId))!;

    await storeA.save(requestHint(DEFINITION, stateForA));
    await expect(storeB.save(requestHint(DEFINITION, stateForB))).rejects.toThrow(SequenceRuntimeStateVersionConflictError);
  });
});

describe("Durability: restart/resume simulation (§16, §21)", () => {
  it("hint/stage progress survives a simulated process restart (fresh repository instance over a fresh pool connection)", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repoBeforeRestart = new SequenceRuntimeStateRepository(pool);
    const runtimeStateId = randomUUID();

    const created = await repoBeforeRestart.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initializeSequence(DEFINITION, runtimeStateId),
    });
    const withHint = requestHint(DEFINITION, created.state);
    const afterHint = await repoBeforeRestart.save(fx.tenantId, attemptId, created.version, withHint);
    const advanced = advanceStage(DEFINITION, afterHint!.state); // intro -> quick
    await repoBeforeRestart.save(fx.tenantId, attemptId, afterHint!.version, advanced);

    const restartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const repoAfterRestart = new SequenceRuntimeStateRepository(restartPool);
      const resumed = await repoAfterRestart.findByAttempt(fx.tenantId, attemptId);
      expect(resumed).not.toBeNull();
      expect(resumed?.state.currentStageId).toBe("quick");
      expect(resumed?.state.stageStates.find((s) => s.stageId === "intro")?.hintCount).toBe(1);
      expect(resumed?.state.sequenceCompletionState).toBe("IN_PROGRESS");

      const completed = advanceStage(DEFINITION, advanceStage(DEFINITION, resumed!.state)); // quick -> result -> COMPLETED
      await repoAfterRestart.save(fx.tenantId, attemptId, resumed!.version, completed);
    } finally {
      await restartPool.end();
    }

    const secondRestartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const repoAfterSecondRestart = new SequenceRuntimeStateRepository(secondRestartPool);
      const finalState = await repoAfterSecondRestart.findByAttempt(fx.tenantId, attemptId);
      expect(finalState?.state.sequenceCompletionState).toBe("COMPLETED");
      expect(isSequenceComplete(finalState!.state)).toBe(true);
    } finally {
      await secondRestartPool.end();
    }
  });
});

describe("Failure / recovery (§16)", () => {
  it("a stored row with malformed state_json fails loudly (throws) rather than being silently treated as fresh/empty", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });
    await pool.query(`UPDATE sequence_runtime_state SET state_json = '{"not":"a valid contract"}'::jsonb WHERE id = $1`, [created.id]);
    await expect(repo.findByAttempt(fx.tenantId, attemptId)).rejects.toThrow();
  });

  it("an attempt with no runtime state row yet simply returns null — not an error, not a fabricated NOT_STARTED row", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const found = await repo.findByAttempt(fx.tenantId, attemptId);
    expect(found).toBeNull();
  });

  it("reloading an already-COMPLETED sequence returns the COMPLETED state unchanged, never resets it", async () => {
    const fx = await buildFixture();
    const attemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "a");
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: attemptId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });
    const completed = advanceStage(DEFINITION, advanceStage(DEFINITION, advanceStage(DEFINITION, created.state)));
    await repo.save(fx.tenantId, attemptId, created.version, completed);

    const reloaded = await repo.findByAttempt(fx.tenantId, attemptId);
    expect(reloaded?.state.sequenceCompletionState).toBe("COMPLETED");
    expect(reloaded?.state.currentStageId).toBe(completed.currentStageId);
  });

  it("save() against a nonexistent attempt row returns null rather than creating one", async () => {
    const fx = await buildFixture();
    const never = await new SequenceRuntimeStateRepository(pool).save(fx.tenantId, randomUUID(), 1, initializeSequence(DEFINITION, randomUUID()));
    expect(never).toBeNull();
  });
});

describe("P0 regression — UAT-RC4-NEW-ASSIGNMENT-LAUNCH-STATE-01: two attempts against the same sequence never share state", () => {
  it("a fresh attempt against a sequence an EARLIER attempt already COMPLETED gets its own independent NOT_STARTED state, never the old COMPLETED one", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);

    // Attempt #1: "Balance Machine Challenge" — played through to completion.
    const firstAttemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "balance");
    const firstStore = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, firstAttemptId);
    const firstRuntimeStateId = randomUUID();
    let firstState = initializeSequence(DEFINITION, firstRuntimeStateId);
    await firstStore.save(firstState);
    firstState = (await firstStore.get(firstRuntimeStateId))!;
    firstState = advanceStage(DEFINITION, firstState); // intro -> quick
    await firstStore.save(firstState);
    firstState = (await firstStore.get(firstRuntimeStateId))!;
    firstState = advanceStage(DEFINITION, firstState); // quick -> result
    await firstStore.save(firstState);
    firstState = (await firstStore.get(firstRuntimeStateId))!;
    firstState = advanceStage(DEFINITION, firstState); // result -> COMPLETED
    await firstStore.save(firstState);
    firstState = (await firstStore.get(firstRuntimeStateId))!;
    expect(isSequenceComplete(firstState)).toBe(true);

    // Attempt #2: "Riattiva la Balance Machine" — a SECOND, independent
    // assignment/attempt against the exact same SequenceDefinition
    // (same `sequenceId`/`sequenceVersion`) — the real remediation
    // scenario that exposed the bug.
    const secondAttemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "balance");
    const secondStore = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, secondAttemptId);

    // The exact bootstrap SequenceHost performs on mount: "is there
    // already durable state for THIS attempt?"
    const secondRuntimeStateId = randomUUID();
    const loaded = await secondStore.get(secondRuntimeStateId).catch(() => undefined);
    expect(loaded).toBeUndefined(); // must be "not found", never the first attempt's COMPLETED state

    const secondFresh = initializeSequence(DEFINITION, secondRuntimeStateId);
    await secondStore.save(secondFresh);
    const secondLoaded = (await secondStore.get(secondRuntimeStateId))!;

    expect(isSequenceComplete(secondLoaded)).toBe(false);
    // initializeSequence() marks the first stage IN_PROGRESS immediately
    // (SEQUENCE_STARTED) — the real assertion is that it is a genuinely
    // FRESH IN_PROGRESS state (currentStageId back at "intro", zero hints/
    // attempts on that stage), never the first attempt's COMPLETED one.
    expect(secondLoaded.sequenceCompletionState).toBe("IN_PROGRESS");
    expect(secondLoaded.currentStageId).toBe("intro");
    expect(secondLoaded.stageStates.find((s) => s.stageId === "intro")?.attemptsForStage).toBe(0);

    // The first attempt's own state must be completely unaffected.
    const firstReloaded = await repo.findByAttempt(fx.tenantId, firstAttemptId);
    expect(firstReloaded?.state.sequenceCompletionState).toBe("COMPLETED");

    // And the two rows are genuinely independent DB rows.
    const secondPersisted = await repo.findByAttempt(fx.tenantId, secondAttemptId);
    expect(secondPersisted?.id).not.toBe(firstReloaded?.id);
  });

  it("completing the second attempt never mutates the first attempt's already-COMPLETED row", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);

    const firstAttemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "balance");
    const firstCreated = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: firstAttemptId,
      state: advanceStage(DEFINITION, advanceStage(DEFINITION, advanceStage(DEFINITION, initializeSequence(DEFINITION, randomUUID())))),
    });
    expect(firstCreated.state.sequenceCompletionState).toBe("COMPLETED");

    const secondAttemptId = await insertAttempt(fx.tenantId, fx.studentProfileId, fx.enrollmentId, fx.classId, "balance");
    const secondCreated = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      learningAttemptId: secondAttemptId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });
    const secondCompleted = advanceStage(DEFINITION, advanceStage(DEFINITION, advanceStage(DEFINITION, secondCreated.state)));
    await repo.save(fx.tenantId, secondAttemptId, secondCreated.version, secondCompleted);

    const firstUnchanged = await repo.findByAttempt(fx.tenantId, firstAttemptId);
    expect(firstUnchanged?.version).toBe(1);
    expect(firstUnchanged?.state).toEqual(firstCreated.state);
  });
});
