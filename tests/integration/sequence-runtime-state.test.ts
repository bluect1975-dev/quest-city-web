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
 * with migrations 0001-0005 applied — same pattern/connection convention
 * as `attempt-lifecycle.test.ts`.
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
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE sequence_runtime_state, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function insertTenantStudentEnrollment(): Promise<{ tenantId: string; studentProfileId: string; enrollmentId: string }> {
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

  return { tenantId, studentProfileId, enrollmentId };
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
  };
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

describe("SequenceRuntimeStateRepository — ownership and CRUD", () => {
  it("create() then findByStudentAndSequence() round-trips the exact contract shape", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const initial = initializeSequence(DEFINITION, randomUUID());

    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initial,
    });
    expect(created.version).toBe(1);
    expect(created.state).toEqual(initial);

    const found = await repo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId);
    expect(found?.state).toEqual(initial);
    expect(found?.version).toBe(1);
  });

  it("findByStudentAndSequence() returns null for a student/sequence pair with no row", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const found = await repo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, "NO-SUCH-SEQUENCE");
    expect(found).toBeNull();
  });

  it("a second create() for the same (tenant, student, sequence) throws SequenceRuntimeStateAlreadyExistsError", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const state = initializeSequence(DEFINITION, randomUUID());
    await repo.create({ tenantId: fx.tenantId, studentProfileId: fx.studentProfileId, enrollmentId: fx.enrollmentId, state });
    await expect(
      repo.create({
        tenantId: fx.tenantId,
        studentProfileId: fx.studentProfileId,
        enrollmentId: fx.enrollmentId,
        state: initializeSequence(DEFINITION, randomUUID()),
      }),
    ).rejects.toThrow(SequenceRuntimeStateAlreadyExistsError);
  });

  it("create() rejects a state that fails contract validation (defense in depth, never persisted)", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const malformed = { contractType: "SEQUENCE_RUNTIME_STATE", runtimeStateId: "x" } as unknown as SequenceRuntimeState;
    await expect(
      repo.create({ tenantId: fx.tenantId, studentProfileId: fx.studentProfileId, enrollmentId: fx.enrollmentId, state: malformed }),
    ).rejects.toThrow();
    const found = await repo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId);
    expect(found).toBeNull();
  });

  it("ownership: another student's row is never returned, even within the same tenant", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    // Give the "other" student a real enrollment in fx.tenantId (own tenant), not fx.otherTenantId.
    const sameTenantOther = await pool.query<{ id: string }>(
      `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [fx.tenantId, `std_${Math.random().toString(36).slice(2, 10)}`],
    );
    const otherStudentInSameTenant = sameTenantOther.rows[0]!.id;

    await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });

    const foundByOtherStudent = await repo.findByStudentAndSequence(fx.tenantId, otherStudentInSameTenant, DEFINITION.sequenceId);
    expect(foundByOtherStudent).toBeNull();
  });

  it("ownership: another tenant's identical studentProfileId collision is impossible (FK-scoped) and cross-tenant lookup returns null", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });
    const crossTenant = await repo.findByStudentAndSequence(fx.otherTenantId, fx.studentProfileId, DEFINITION.sequenceId);
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
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initialStateAtQuickStage(),
    });
    const mutated = requestHint(DEFINITION, created.state);
    const saved = await repo.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, created.version, mutated);
    expect(saved).not.toBeNull();
    expect(saved?.version).toBe(2);
    expect(saved?.state.stageStates.find((s) => s.stageId === "quick")?.hintCount).toBe(1);
  });

  it("save() with a stale expectedVersion returns null (conflict) and never overwrites the row", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initialStateAtQuickStage(),
    });
    // First write succeeds and bumps the row to version 2.
    await repo.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, created.version, requestHint(DEFINITION, created.state));

    // A second write still carrying the ORIGINAL (now-stale) version
    // simulates a retried/duplicate request — must be rejected, not applied.
    const conflictResult = await repo.save(
      fx.tenantId,
      fx.studentProfileId,
      DEFINITION.sequenceId,
      created.version,
      requestHint(DEFINITION, requestHint(DEFINITION, created.state)),
    );
    expect(conflictResult).toBeNull();

    const current = await repo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId);
    expect(current?.version).toBe(2);
    // hintCount reflects exactly the one write that actually landed, never the rejected retry's double-hint.
    expect(current?.state.stageStates.find((s) => s.stageId === "quick")?.hintCount).toBe(1);
  });

  it("two concurrent hint requests from the same stale base: exactly one succeeds, hintCount increments exactly once", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initialStateAtQuickStage(),
    });
    const mutatedA = requestHint(DEFINITION, created.state);
    const mutatedB = requestHint(DEFINITION, created.state);

    const [resultA, resultB] = await Promise.all([
      repo.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, created.version, mutatedA),
      repo.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, created.version, mutatedB),
    ]);
    const outcomes = [resultA, resultB];
    expect(outcomes.filter((r) => r !== null)).toHaveLength(1);
    expect(outcomes.filter((r) => r === null)).toHaveLength(1);

    const final = await repo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId);
    expect(final?.state.stageStates.find((s) => s.stageId === "quick")?.hintCount).toBe(1);
  });
});

describe("addAttemptReference dedup (domain-level, §12)", () => {
  it("adding the same {stageId, attemptId} twice never duplicates the reference, even across a persisted round-trip", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });
    const attemptId = randomUUID();
    const withRef = addAttemptReference(created.state, "quick", attemptId);
    const saved1 = await repo.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, created.version, withRef);
    expect(saved1?.state.attemptReferences).toHaveLength(1);

    // Retry of the exact same reference add against the freshly persisted state.
    const withRefAgain = addAttemptReference(saved1!.state, "quick", attemptId);
    expect(withRefAgain).toBe(saved1!.state); // same reference, addAttemptReference is a no-op here
    const saved2 = await repo.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, saved1!.version, withRefAgain);
    expect(saved2?.state.attemptReferences).toHaveLength(1);
  });
});

describe("DurableSequenceRuntimeStateStore — SequenceRuntimeStateStore conformance and parity with InMemory (§17)", () => {
  it("get()/save() drive the same M06-style mutation sequence to the same resulting state as InMemorySequenceRuntimeStateStore", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const durable = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, DEFINITION.sequenceId);
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

  it("get() throws if the requested runtimeStateId does not match the stored one for this (tenant, student, sequence)", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const durable = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, DEFINITION.sequenceId);
    await durable.save(initializeSequence(DEFINITION, "the-real-runtime-state-id"));
    await expect(durable.get("a-different-guessed-runtime-state-id")).rejects.toThrow();
  });

  it("save() after a stale get() throws SequenceRuntimeStateVersionConflictError instead of silently overwriting", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const runtimeStateId = randomUUID();
    const storeA = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, DEFINITION.sequenceId);
    await storeA.save(initializeSequence(DEFINITION, runtimeStateId));

    // Two independent request-scoped store instances both read the same base version...
    const storeB = new DurableSequenceRuntimeStateStore(repo, fx.tenantId, fx.studentProfileId, fx.enrollmentId, DEFINITION.sequenceId);
    const stateForA = (await storeA.get(runtimeStateId))!;
    const stateForB = (await storeB.get(runtimeStateId))!;

    // ...A writes first and succeeds...
    await storeA.save(requestHint(DEFINITION, stateForA));
    // ...B's write, still based on the now-stale version, must be rejected.
    await expect(storeB.save(requestHint(DEFINITION, stateForB))).rejects.toThrow(SequenceRuntimeStateVersionConflictError);
  });
});

describe("Durability: restart/resume simulation (§16, §21)", () => {
  it("hint/stage progress survives a simulated process restart (fresh repository instance over a fresh pool connection)", async () => {
    const fx = await buildFixture();
    const repoBeforeRestart = new SequenceRuntimeStateRepository(pool);
    const runtimeStateId = randomUUID();

    const created = await repoBeforeRestart.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initializeSequence(DEFINITION, runtimeStateId),
    });
    const withHint = requestHint(DEFINITION, created.state);
    const afterHint = await repoBeforeRestart.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, created.version, withHint);
    const advanced = advanceStage(DEFINITION, afterHint!.state); // intro -> quick
    await repoBeforeRestart.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, afterHint!.version, advanced);

    // Simulate a process restart: a brand-new Pool/repository, no shared in-process state whatsoever.
    const restartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const repoAfterRestart = new SequenceRuntimeStateRepository(restartPool);
      const resumed = await repoAfterRestart.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId);
      expect(resumed).not.toBeNull();
      expect(resumed?.state.currentStageId).toBe("quick");
      expect(resumed?.state.stageStates.find((s) => s.stageId === "intro")?.hintCount).toBe(1);
      expect(resumed?.state.sequenceCompletionState).toBe("IN_PROGRESS");

      // Continue to completion after "resume", then simulate a SECOND restart and verify COMPLETED sticks.
      const completed = advanceStage(DEFINITION, advanceStage(DEFINITION, resumed!.state)); // quick -> result -> COMPLETED
      await repoAfterRestart.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, resumed!.version, completed);
    } finally {
      await restartPool.end();
    }

    const secondRestartPool = new Pool({ connectionString: DATABASE_URL });
    try {
      const repoAfterSecondRestart = new SequenceRuntimeStateRepository(secondRestartPool);
      const finalState = await repoAfterSecondRestart.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId);
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
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });
    // Directly corrupt the row's JSON below the repository, simulating a
    // hand-edited/incompatible row — never something the repository itself would write.
    await pool.query(`UPDATE sequence_runtime_state SET state_json = '{"not":"a valid contract"}'::jsonb WHERE id = $1`, [created.id]);
    await expect(repo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId)).rejects.toThrow();
  });

  it("an unknown sequenceId simply returns null — not an error, not a fabricated NOT_STARTED row", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const found = await repo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, "TOTALLY-UNKNOWN-SEQUENCE-ID");
    expect(found).toBeNull();
  });

  it("reloading an already-COMPLETED sequence returns the COMPLETED state unchanged, never resets it", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const created = await repo.create({
      tenantId: fx.tenantId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      state: initializeSequence(DEFINITION, randomUUID()),
    });
    const completed = advanceStage(DEFINITION, advanceStage(DEFINITION, advanceStage(DEFINITION, created.state)));
    await repo.save(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId, created.version, completed);

    const reloaded = await repo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, DEFINITION.sequenceId);
    expect(reloaded?.state.sequenceCompletionState).toBe("COMPLETED");
    expect(reloaded?.state.currentStageId).toBe(completed.currentStageId);
  });

  it("save() against a nonexistent (tenant, student, sequence) row returns null rather than creating one", async () => {
    const fx = await buildFixture();
    const repo = new SequenceRuntimeStateRepository(pool);
    const never = await repo.save(fx.tenantId, fx.studentProfileId, "NEVER-CREATED-SEQUENCE", 1, initializeSequence(DEFINITION, randomUUID()));
    expect(never).toBeNull();
    const found = await repo.findByStudentAndSequence(fx.tenantId, fx.studentProfileId, "NEVER-CREATED-SEQUENCE");
    expect(found).toBeNull();
  });
});
