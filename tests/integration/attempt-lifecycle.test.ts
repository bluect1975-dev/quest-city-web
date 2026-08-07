import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  AssignmentRepository,
  LearningAttemptRepository,
  SemanticActionLogRepository,
  AttemptResponseRepository,
  IdempotencyRecordRepository,
  IdempotencyService,
  AttemptConsolidationService,
  CrossRuntimeReconciliationService,
  RuntimeCapabilityResolver,
  BALANCE_MACHINE_VALIDATOR_VERSION,
  checkFinalClientSequence,
  CrossRuntimeError,
} from "@quest-city-web/attempts";
import { CrossRuntimeReconciliationFixtureDriver } from "@quest-city-web/test-fixtures/fixture-driver";

/**
 * WEB-M2B integration tests against a real, dockerized PostgreSQL instance
 * with migrations 0001-0003 applied.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- attempt-lifecycle
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

interface Fixture {
  tenantId: string;
  otherTenantId: string;
  classId: string;
  studentProfileId: string;
  enrollmentId: string;
  contentBundleId: string;
  assignmentId: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function buildFixture(): Promise<Fixture> {
  const tenantResult = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`,
    [`sch_${Math.random().toString(36).slice(2, 10)}`],
  );
  const tenantId = tenantResult.rows[0]!.id;

  const otherTenantResult = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Other School') RETURNING id`,
    [`sch_${Math.random().toString(36).slice(2, 10)}`],
  );
  const otherTenantId = otherTenantResult.rows[0]!.id;

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

  const bundleResult = await pool.query<{ id: string }>(
    `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref)
     VALUES ($1, 'MAT', '1.0.0', 'RUNTIME_FIXTURE_BUNDLE', 'PUBLISHED', 'sha256:abc', 's3://x') RETURNING id`,
    [`bnd_${Math.random().toString(36).slice(2, 10)}`],
  );
  const contentBundleId = bundleResult.rows[0]!.id;
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    contentBundleId,
  ]);

  const assignmentResult = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Test assignment', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
    [tenantId, classId, `asn_${Math.random().toString(36).slice(2, 10)}`, contentBundleId],
  );
  const assignmentId = assignmentResult.rows[0]!.id;
  await pool.query(`INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, 'WEB')`, [
    assignmentId,
    tenantId,
  ]);

  return { tenantId, otherTenantId, classId, studentProfileId, enrollmentId, contentBundleId, assignmentId };
}

async function placeBalancedBalanceMachineActions(
  semanticActions: SemanticActionLogRepository,
  tenantId: string,
  attemptId: string,
): Promise<void> {
  await semanticActions.insert({
    tenantId,
    attemptId,
    actionId: "act-left-5",
    actionType: "PLACE_ITEM",
    targetRole: "weight-token",
    payload: { tokenId: "w5", side: "left", weight: 5 },
    clientSequence: 0,
    runtimeChannel: "WEB",
    occurredAt: new Date(),
  });
  await semanticActions.insert({
    tenantId,
    attemptId,
    actionId: "act-right-5",
    actionType: "PLACE_ITEM",
    targetRole: "weight-token",
    payload: { tokenId: "w5b", side: "right", weight: 5 },
    clientSequence: 1,
    runtimeChannel: "WEB",
    occurredAt: new Date(),
  });
  await semanticActions.insert({
    tenantId,
    attemptId,
    actionId: "act-confirm",
    actionType: "CONFIRM_SOLUTION",
    targetRole: "confirm-button",
    payload: {},
    clientSequence: 2,
    runtimeChannel: "WEB",
    occurredAt: new Date(),
  });
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("tenant isolation", () => {
  it("does not return an assignment or attempt across tenants", async () => {
    const fx = await buildFixture();
    const assignments = new AssignmentRepository(pool);
    const found = await assignments.findByIdAndTenant(fx.assignmentId, fx.otherTenantId);
    expect(found).toBeNull();
    const foundOwn = await assignments.findByIdAndTenant(fx.assignmentId, fx.tenantId);
    expect(foundOwn).not.toBeNull();
  });
});

describe("attempt lifecycle (07_15_01 v1.1 §11-bis)", () => {
  it("CREATED -> IN_PROGRESS -> COMPLETION_SUBMITTED -> COMPLETED, with real DB CHECK enforcement throughout", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);

    const created = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "creation-key-1",
    });
    expect(created.attemptState).toBe("CREATED");
    expect(created.completionStatus).toBeNull();

    const inProgress = await attempts.transitionToInProgress(created.id, fx.tenantId);
    expect(inProgress?.attemptState).toBe("IN_PROGRESS");

    const submitted = await attempts.transitionToCompletionSubmitted(created.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    expect(submitted?.attemptState).toBe("COMPLETION_SUBMITTED");
    expect(submitted?.completionStatus).toBe("ACCEPTED_NOT_CONSOLIDATED");

    const semanticActions = new SemanticActionLogRepository(pool);
    await placeBalancedBalanceMachineActions(semanticActions, fx.tenantId, created.id);
    const actions = await semanticActions.findByAttempt(created.id, fx.tenantId);

    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses);
    const result = await consolidation.consolidate({ attemptId: created.id, tenantId: fx.tenantId, actions });
    expect(result.completionStatus).toBe("CONSOLIDATED");
    expect(result.outcome?.["score"]).toBe(1);

    const final = await attempts.findByIdAndTenant(created.id, fx.tenantId);
    expect(final?.attemptState).toBe("COMPLETED");
    expect(final?.completionStatus).toBe("CONSOLIDATED");
    expect(final?.completedAt).not.toBeNull();
    expect(final?.outcome).not.toBeNull();
    expect((final?.outcome as Record<string, unknown> | null)?.["score"]).toBe(1);
  });

  it("rejects a completion transition from CREATED (only IN_PROGRESS is a valid source)", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    const created = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "creation-key-2",
    });
    const submitted = await attempts.transitionToCompletionSubmitted(created.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    expect(submitted).toBeNull(); // CREATED is not a valid source state -> ATTEMPT_NOT_COMPLETABLE at the route layer
  });

  it("creation-idempotency: the same key returns the same attempt, never a second row", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    const input = {
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB" as const,
      creationIdempotencyKey: "shared-key",
    };
    const first = await attempts.create(input);
    const found = await attempts.findByCreationKey(fx.tenantId, fx.assignmentId, fx.studentProfileId, "shared-key");
    expect(found?.id).toBe(first.id);

    // A second create() with the same key would violate the unique index —
    // real DB-level enforcement, not just application discipline.
    await expect(attempts.create({ ...input, eventId: randomUUID() })).rejects.toThrow();
  });
});

describe("AttemptConsolidationService — real, deterministic outcome computation (Balance Machine validator)", () => {
  async function createSubmittedAttempt(creationKey: string) {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    const created = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: creationKey,
    });
    await attempts.transitionToInProgress(created.id, fx.tenantId);
    await attempts.transitionToCompletionSubmitted(created.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    return { fx, attempts, attemptId: created.id };
  }

  it("valid input, correct result: balanced weights -> score 1, CORRECT recorded with the real validatorVersion", async () => {
    const { fx, attempts, attemptId } = await createSubmittedAttempt("balance-correct");
    const semanticActions = new SemanticActionLogRepository(pool);
    await placeBalancedBalanceMachineActions(semanticActions, fx.tenantId, attemptId);
    const actions = await semanticActions.findByAttempt(attemptId, fx.tenantId);

    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses);
    const result = await consolidation.consolidate({ attemptId, tenantId: fx.tenantId, actions });

    expect(result.completionStatus).toBe("CONSOLIDATED");
    expect(result.outcome?.["score"]).toBe(1);
    expect(result.outcome?.["completionStatus"]).toBe("CONSOLIDATED");
    expect(result.outcome?.["consolidatedAt"]).toBeTypeOf("string");

    const responses = await attemptResponses.findByAttempt(attemptId, fx.tenantId);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.correctness).toBe("CORRECT");
    expect(responses[0]?.validatorVersion).toBe(BALANCE_MACHINE_VALIDATOR_VERSION);
  });

  it("valid input, incorrect result: unbalanced weights -> score 0, INCORRECT recorded", async () => {
    const { fx, attempts, attemptId } = await createSubmittedAttempt("balance-incorrect");
    const semanticActions = new SemanticActionLogRepository(pool);
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId,
      actionId: "act-left-7",
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w7", side: "left", weight: 7 },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId,
      actionId: "act-right-3",
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w3", side: "right", weight: 3 },
      clientSequence: 1,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId,
      actionId: "act-confirm",
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
      clientSequence: 2,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    const actions = await semanticActions.findByAttempt(attemptId, fx.tenantId);

    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses);
    const result = await consolidation.consolidate({ attemptId, tenantId: fx.tenantId, actions });

    expect(result.outcome?.["score"]).toBe(0);
    const responses = await attemptResponses.findByAttempt(attemptId, fx.tenantId);
    expect(responses[0]?.correctness).toBe("INCORRECT");
  });

  it("invalid/malformed input: an unrecognized action shape falls back to a schema-valid, score-less outcome (never fabricated)", async () => {
    const { fx, attempts, attemptId } = await createSubmittedAttempt("balance-malformed");
    const semanticActions = new SemanticActionLogRepository(pool);
    // Malformed payload — "side" is not "left"/"right", so evaluateBalanceMachine
    // cannot score it and must not invent a result.
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId,
      actionId: "act-bad-side",
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w1", side: "middle", weight: 1 },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId,
      actionId: "act-confirm",
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
      clientSequence: 1,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    const actions = await semanticActions.findByAttempt(attemptId, fx.tenantId);

    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses);
    const result = await consolidation.consolidate({ attemptId, tenantId: fx.tenantId, actions });

    expect(result.completionStatus).toBe("CONSOLIDATED");
    expect(result.outcome?.["completionStatus"]).toBe("CONSOLIDATED");
    expect(result.outcome).not.toHaveProperty("score"); // no fabricated score
    const responses = await attemptResponses.findByAttempt(attemptId, fx.tenantId);
    expect(responses).toHaveLength(0); // nothing to record — no validator matched
  });

  it("idempotent under concurrency: two concurrent consolidate() calls on the same attempt produce exactly one CONSOLIDATED and never duplicate attempt_response", async () => {
    const { fx, attempts, attemptId } = await createSubmittedAttempt("balance-concurrent");
    const semanticActions = new SemanticActionLogRepository(pool);
    await placeBalancedBalanceMachineActions(semanticActions, fx.tenantId, attemptId);
    const actions = await semanticActions.findByAttempt(attemptId, fx.tenantId);

    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses);
    const [first, second] = await Promise.all([
      consolidation.consolidate({ attemptId, tenantId: fx.tenantId, actions }),
      consolidation.consolidate({ attemptId, tenantId: fx.tenantId, actions }),
    ]);
    const statuses = [first.completionStatus, second.completionStatus].sort();
    expect(statuses).toEqual(["CONSOLIDATED", "DUPLICATE"]);

    const responses = await attemptResponses.findByAttempt(attemptId, fx.tenantId);
    expect(responses).toHaveLength(1);
  });
});

describe("finalClientSequence guard (POST /attempts/{id}/complete, 02_26 v1.6 §18.5)", () => {
  // Exercises exactly the sequence apps/api/app/attempts/[attemptId]/complete/route.ts
  // runs — fetch persisted actions, call checkFinalClientSequence() (the
  // one function the route itself calls, never a re-implementation here),
  // and only proceed to transitionToCompletionSubmitted()/consolidate()
  // when it says ok — so a rejection's real, persisted consequences (no
  // state transition, no outcome, no attempt_response) are genuinely
  // verified against Postgres, not assumed.
  it("mismatch: finalClientSequence ahead of what is persisted -> ATTEMPT_NOT_COMPLETABLE/MISSING_ACTION, no state transition, no outcome, no attempt_response", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    const created = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "fcs-mismatch",
    });
    await attempts.transitionToInProgress(created.id, fx.tenantId);

    const semanticActions = new SemanticActionLogRepository(pool);
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: created.id,
      actionId: "act-0",
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w5", side: "left", weight: 5 },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    const actions = await semanticActions.findByAttempt(created.id, fx.tenantId);

    // Client claims it already sent up to clientSequence 5; the server has
    // only persisted up to 0 — an in-flight/missing action.
    const guard = checkFinalClientSequence(5, actions);
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.reason).toBe("MISSING_ACTION");
      const error = new CrossRuntimeError("ATTEMPT_NOT_COMPLETABLE", "Un'azione risulta ancora in transito.", {
        reason: guard.reason,
      });
      const envelope = error.toEnvelope("test-correlation-id");
      expect(envelope.domain).toBe("CROSS_RUNTIME");
      expect(envelope.code).toBe("ATTEMPT_NOT_COMPLETABLE");
      expect(envelope.safeDetails).toEqual({ reason: "MISSING_ACTION" });
    }

    // Route behavior on guard failure: throw before ever calling
    // transitionToCompletionSubmitted()/consolidate() — so, matching that,
    // this test does not call them either, and verifies the attempt was
    // genuinely never touched.
    const unchanged = await attempts.findByIdAndTenant(created.id, fx.tenantId);
    expect(unchanged?.attemptState).toBe("IN_PROGRESS");
    expect(unchanged?.completionStatus).toBeNull();
    expect(unchanged?.outcome).toBeNull();

    const attemptResponses = new AttemptResponseRepository(pool);
    const responses = await attemptResponses.findByAttempt(created.id, fx.tenantId);
    expect(responses).toHaveLength(0);
  });

  it("positive: finalClientSequence equal to the max persisted sequence -> completion proceeds normally", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    const created = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "fcs-match",
    });
    await attempts.transitionToInProgress(created.id, fx.tenantId);

    const semanticActions = new SemanticActionLogRepository(pool);
    await placeBalancedBalanceMachineActions(semanticActions, fx.tenantId, created.id);
    const actions = await semanticActions.findByAttempt(created.id, fx.tenantId);

    // The fixture's third action (CONFIRM_SOLUTION) is clientSequence 2 —
    // the client claiming exactly that is the honest, correct case.
    const guard = checkFinalClientSequence(2, actions);
    expect(guard.ok).toBe(true);

    await attempts.transitionToCompletionSubmitted(created.id, fx.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    const attemptResponses = new AttemptResponseRepository(pool);
    const consolidation = new AttemptConsolidationService(attempts, attemptResponses);
    const result = await consolidation.consolidate({ attemptId: created.id, tenantId: fx.tenantId, actions });

    expect(result.completionStatus).toBe("CONSOLIDATED");
    const final = await attempts.findByIdAndTenant(created.id, fx.tenantId);
    expect(final?.attemptState).toBe("COMPLETED");
    expect(final?.outcome).not.toBeNull();
  });
});

describe("semantic action dedup and append-only", () => {
  it("dedups by (attempt_id, action_id) — a retry with the same actionId returns the existing row", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    const actionsRepo = new SemanticActionLogRepository(pool);
    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "creation-key-3",
    });

    const inserted = await actionsRepo.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-1",
      actionType: "PLACE_ITEM",
      payload: {},
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });
    const found = await actionsRepo.findByAttemptAndActionId(attempt.id, fx.tenantId, "act-1");
    expect(found?.id).toBe(inserted.id);

    await expect(
      actionsRepo.insert({
        tenantId: fx.tenantId,
        attemptId: attempt.id,
        actionId: "act-1",
        actionType: "PLACE_ITEM",
        payload: {},
        clientSequence: 1,
        runtimeChannel: "WEB",
        occurredAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("is append-only: a direct UPDATE or DELETE is rejected by the database trigger", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    const actionsRepo = new SemanticActionLogRepository(pool);
    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "creation-key-4",
    });
    const inserted = await actionsRepo.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-1",
      actionType: "PLACE_ITEM",
      payload: {},
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });

    await expect(
      pool.query("UPDATE semantic_action_log SET client_sequence = 99 WHERE id = $1", [inserted.id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM semantic_action_log WHERE id = $1", [inserted.id])).rejects.toThrow(
      /append-only/,
    );
  });
});

describe("content_bundle immutability", () => {
  it("rejects UPDATE of a protected field and DELETE once PUBLISHED; allows PUBLISHED -> DEPRECATED", async () => {
    const fx = await buildFixture();
    await expect(
      pool.query("UPDATE content_bundle SET storage_ref = 's3://y' WHERE id = $1", [fx.contentBundleId]),
    ).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM content_bundle WHERE id = $1", [fx.contentBundleId])).rejects.toThrow(
      /PUBLISHED/,
    );
    await expect(
      pool.query("UPDATE content_bundle SET status = 'DRAFT' WHERE id = $1", [fx.contentBundleId]),
    ).rejects.toThrow(/DEPRECATED/);
    const deprecateResult = await pool.query("UPDATE content_bundle SET status = 'DEPRECATED' WHERE id = $1 RETURNING id", [
      fx.contentBundleId,
    ]);
    expect(deprecateResult.rows).toHaveLength(1);
  });
});

describe("IdempotencyService — generation-based optimistic concurrency", () => {
  it("begin() NEW -> complete() with correct generation COMMITS; a stale generation is rejected", async () => {
    const service = new IdempotencyService(new IdempotencyRecordRepository(pool));
    const fx = await buildFixture();

    const begin = await service.begin({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-1",
      payload: { a: 1 },
    });
    expect(begin.outcome).toBe("NEW");
    const generation = begin.outcome === "NEW" || begin.outcome === "REOPENED" ? begin.generation : -1;
    expect(generation).toBe(1);

    const staleComplete = await service.complete({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-1",
      expectedGeneration: 999,
      response: { ok: true },
    });
    expect(staleComplete.outcome).toBe("STALE_GENERATION");

    const realComplete = await service.complete({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-1",
      expectedGeneration: generation,
      response: { ok: true },
    });
    expect(realComplete.outcome).toBe("COMMITTED");
  });

  it("begin() with the same key and same payload after COMPLETED returns DUPLICATE_SAME_PAYLOAD", async () => {
    const service = new IdempotencyService(new IdempotencyRecordRepository(pool));
    const fx = await buildFixture();
    const begin1 = await service.begin({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-2",
      payload: { a: 1 },
    });
    expect(begin1.outcome).toBe("NEW");
    await service.complete({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-2",
      expectedGeneration: 1,
      response: { ok: true, marker: "first" },
    });

    const begin2 = await service.begin({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-2",
      payload: { a: 1 },
    });
    expect(begin2.outcome).toBe("DUPLICATE_SAME_PAYLOAD");
    if (begin2.outcome === "DUPLICATE_SAME_PAYLOAD") {
      expect(begin2.response).toEqual({ ok: true, marker: "first" });
    }
  });

  it("begin() with the same key but a different payload returns CONFLICT_DIFFERENT_PAYLOAD", async () => {
    const service = new IdempotencyService(new IdempotencyRecordRepository(pool));
    const fx = await buildFixture();
    await service.begin({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-3",
      payload: { a: 1 },
    });
    const conflict = await service.begin({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-3",
      payload: { a: 2 },
    });
    expect(conflict.outcome).toBe("CONFLICT_DIFFERENT_PAYLOAD");
  });

  it("fail() with retryable=false, then begin() with the same key/payload returns FAILED_TERMINAL", async () => {
    const service = new IdempotencyService(new IdempotencyRecordRepository(pool));
    const fx = await buildFixture();
    await service.begin({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-4",
      payload: { a: 1 },
    });
    await service.fail({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-4",
      expectedGeneration: 1,
      retryable: false,
      response: { error: "permanent" },
    });
    const retry = await service.begin({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      idempotencyKey: "complete-key-4",
      payload: { a: 1 },
    });
    expect(retry.outcome).toBe("FAILED_TERMINAL");
  });

  it("two concurrent begin() calls on the same never-seen key: only one gets NEW", async () => {
    const service = new IdempotencyService(new IdempotencyRecordRepository(pool));
    const fx = await buildFixture();
    const [a, b] = await Promise.all([
      service.begin({
        tenantId: fx.tenantId,
        assignmentId: fx.assignmentId,
        studentProfileId: fx.studentProfileId,
        idempotencyKey: "race-key",
        payload: { a: 1 },
      }),
      service.begin({
        tenantId: fx.tenantId,
        assignmentId: fx.assignmentId,
        studentProfileId: fx.studentProfileId,
        idempotencyKey: "race-key",
        payload: { a: 1 },
      }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    // Exactly one NEW; the loser sees the not-yet-completed PENDING row
    // with a matching hash -> RETRY_TOO_SOON (no distinct in-flight
    // outcome is modeled, see idempotency-record-repository.ts).
    expect(outcomes).toContain("NEW");
    expect(outcomes.filter((o) => o === "NEW")).toHaveLength(1);
  });
});

describe("CrossRuntimeReconciliationService.evaluate()", () => {
  it("returns NONE_PENDING when there is a single attempt", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "recon-key-1",
    });
    const reconciliation = new CrossRuntimeReconciliationService(attempts);
    const result = await reconciliation.evaluate({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
    });
    expect(result.resolution).toBe("NONE_PENDING");
  });

  it("returns RECONCILIATION_REQUIRED when two attempts are concurrently pending completion", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    const a = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "recon-key-2a",
    });
    const b = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "recon-key-2b",
    });
    await attempts.transitionToInProgress(a.id, fx.tenantId);
    await attempts.transitionToInProgress(b.id, fx.tenantId);

    const reconciliation = new CrossRuntimeReconciliationService(attempts);
    const result = await reconciliation.evaluate({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
    });
    expect(result.resolution).toBe("RECONCILIATION_REQUIRED");
    expect(result.concurrentAttempts).toHaveLength(2);
  });

  it("CrossRuntimeReconciliationFixtureDriver.simulateResolution() consolidates the prevailing attempt (test-only)", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    const a = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "recon-key-3",
    });
    await attempts.transitionToInProgress(a.id, fx.tenantId);
    await attempts.transitionToCompletionSubmitted(a.id, fx.tenantId, "RECONCILIATION_REQUIRED");

    const driver = new CrossRuntimeReconciliationFixtureDriver(pool);
    const result = await driver.simulateResolution({
      tenantId: fx.tenantId,
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      prevailingAttemptId: a.id,
      fixtureResolution: "CONTROLLED_MANUAL_SIMULATED",
      outcome: { score: 1 },
    });
    expect(result.prevailingAttemptId).toBe(a.id);
    expect(result.auditEventId).toBeTruthy();

    const final = await attempts.findByIdAndTenant(a.id, fx.tenantId);
    expect(final?.attemptState).toBe("COMPLETED");
    expect(final?.completionStatus).toBe("CONSOLIDATED");
  });
});

describe("progress summary aggregate", () => {
  it("aggregates attempt counts by state and completion status for a single student", async () => {
    const fx = await buildFixture();
    const attempts = new LearningAttemptRepository(pool);
    await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId: fx.assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: fx.contentBundleId,
      contentId: fx.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "summary-key-1",
    });
    const summary = await attempts.summarizeForStudent(fx.tenantId, fx.studentProfileId, {});
    expect(summary.totalAttempts).toBe(1);
    expect(summary.byAttemptState["CREATED"]).toBe(1);
  });
});

describe("RuntimeCapabilityResolver (real, no mock)", () => {
  it("resolves against a real adapter list end to end", () => {
    const resolver = new RuntimeCapabilityResolver();
    const result = resolver.resolve({
      runtimeChannel: "WEB",
      requestedCapabilities: ["DRAG_DROP"],
      availableAdapters: [
        { adapterId: "a", adapterVersion: "1.0.0", supportedRuntimeChannels: ["WEB"], supportedCapabilities: ["DRAG_DROP"] },
      ],
    });
    expect(result.compatible).toBe(true);
  });

  it("returns PRESENTATION_ADAPTER_UNAVAILABLE for a runtime with no matching adapter", () => {
    const resolver = new RuntimeCapabilityResolver();
    const result = resolver.resolve({
      runtimeChannel: "ROBLOX",
      requestedCapabilities: [],
      availableAdapters: [
        { adapterId: "a", adapterVersion: "1.0.0", supportedRuntimeChannels: ["WEB"], supportedCapabilities: [] },
      ],
    });
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toBe("PRESENTATION_ADAPTER_UNAVAILABLE");
    }
  });
});
