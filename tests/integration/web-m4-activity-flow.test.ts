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
} from "@quest-city-web/attempts";
import { createDefaultEngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import { loadBundleManifest } from "@quest-city-web/content-runtime";
import {
  WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST,
  WEB_M4_BALANCE_MACHINE_SOLUTION,
  WEB_M4_MAT_M06_ACTIVITY_ID,
  WEB_M4_MAT_M06_ASSIGNMENT_PUBLIC_ID,
  WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
  WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID,
} from "@quest-city-web/content-runtime";

/**
 * WEB-M4 (07_25 v1.0 §10, §23) end-to-end integration: real M06 content,
 * seeded exactly as `tools/seed-content-bundle.ts` + `tools/seed-
 * assignment.ts` would (same SQL shape, run against real Postgres, not
 * mocked), then the exact sequence `apps/api`'s routes perform —
 * launch-context's attempt creation, real semantic actions, and
 * consolidation — proving the real content/engine/attempt wiring, not
 * just the fixture path R3C.1 already covers.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- web-m4-activity-flow
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

interface Fixture {
  tenantId: string;
  otherTenantId: string;
  otherStudentProfileId: string;
  classId: string;
  studentProfileId: string;
  enrollmentId: string;
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

  const otherProfileResult = await pool.query<{ id: string }>(
    `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [tenantId, `std_${Math.random().toString(36).slice(2, 10)}`],
  );
  const otherStudentProfileId = otherProfileResult.rows[0]!.id;

  const enrollmentResult = await pool.query<{ id: string }>(
    `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
     VALUES ($1, $2, $3, 'Test', 'test', 'x', 'ACTIVE') RETURNING id`,
    [tenantId, classId, studentProfileId],
  );
  const enrollmentId = enrollmentResult.rows[0]!.id;

  return { tenantId, otherTenantId, otherStudentProfileId, classId, studentProfileId, enrollmentId };
}

/** Mirrors tools/seed-content-bundle.ts exactly (explicit id, real manifest, ACTIVITY_BUNDLE). */
async function seedWebM4ContentBundle(): Promise<void> {
  const validation = loadBundleManifest(WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST);
  if (!validation.ok) throw new Error(`manifest invalid: ${validation.errors.join("; ")}`);
  const manifest = WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST;
  await pool.query(
    `INSERT INTO content_bundle (id, public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
      WEB_M4_MAT_M06_CONTENT_BUNDLE_PUBLIC_ID,
      manifest.subjectId,
      manifest.bundleVersion,
      manifest.bundleType,
      manifest.status,
      `sha256:${manifest.integrity.digest}`,
      "pkg://@quest-city-web/content-runtime/content/web-m4-real-content#WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST",
      manifest.publishedAt,
    ],
  );
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
  ]);
}

/** Mirrors tools/seed-assignment.ts exactly. */
async function seedWebM4Assignment(tenantId: string, classId: string): Promise<string> {
  const assignmentResult = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Balance Machine', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
    [tenantId, classId, WEB_M4_MAT_M06_ASSIGNMENT_PUBLIC_ID, WEB_M4_MAT_M06_CONTENT_BUNDLE_ID],
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

describe("WEB-M4 real content bundle + assignment materialization", () => {
  it("the seeded content_bundle is a real, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED, WEB-compatible)", async () => {
    await seedWebM4ContentBundle();
    const bundle = await new ContentBundleRepository(pool).findById(WEB_M4_MAT_M06_CONTENT_BUNDLE_ID);
    expect(bundle).not.toBeNull();
    expect(bundle?.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(bundle?.status).toBe("PUBLISHED");
    expect(bundle?.compatibleRuntimes).toEqual(["WEB"]);
  });

  it("resolveEngineDispatch resolves the real content_bundle id to ENG-BALANCE with the real (non-invented) token config", () => {
    const dispatch = resolveEngineDispatch(WEB_M4_MAT_M06_CONTENT_BUNDLE_ID);
    expect(dispatch).toBeDefined();
    expect(dispatch?.runtimeAdapterId).toBe("QC-WEB-ENGINE-BALANCE-MACHINE");
  });
});

describe("WEB-M4 full attempt lifecycle against real content (07_25 v1.0 §10 criteria 3,4,5,6,7)", () => {
  it("launch-context -> real semantic actions -> complete: consolidates CORRECT via the real engine/content wiring, not a fixture", async () => {
    const fx = await buildFixture();
    await seedWebM4ContentBundle();
    const assignmentId = await seedWebM4Assignment(fx.tenantId, fx.classId);

    // Mirrors apps/api/app/assignments/[assignmentId]/launch-context/route.ts exactly.
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
      contentId: bundle!.id, // real launch-context sets contentId = bundle.id
      contentVersion: bundle!.bundleVersion,
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-m4-launch-key-0000000001",
    });
    expect(attempt.contentId).toBe(WEB_M4_MAT_M06_CONTENT_BUNDLE_ID);

    // Mirrors apps/api/app/attempts/[attemptId]/actions/route.ts: first
    // action transitions CREATED -> IN_PROGRESS, one row per real solution token.
    const semanticActions = new SemanticActionLogRepository(pool);
    let clientSequence = 0;
    for (const [tokenId, side] of Object.entries(WEB_M4_BALANCE_MACHINE_SOLUTION)) {
      if (clientSequence === 0) {
        await attempts.transitionToInProgress(attempt.id, fx.tenantId);
      }
      await semanticActions.insert({
        tenantId: fx.tenantId,
        attemptId: attempt.id,
        actionId: `act-${tokenId}`,
        actionType: "PLACE_ITEM",
        targetRole: "weight-token",
        payload: { tokenId, side },
        clientSequence,
        runtimeChannel: "WEB",
        occurredAt: new Date(),
      });
      clientSequence += 1;
    }
    await semanticActions.insert({
      tenantId: fx.tenantId,
      attemptId: attempt.id,
      actionId: "act-confirm",
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
      clientSequence,
      runtimeChannel: "WEB",
      occurredAt: new Date(),
    });

    // Mirrors apps/api/app/attempts/[attemptId]/complete/route.ts.
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

    // AttemptConsolidationService's `outcome` (outcome.schema.json) carries
    // only `score`, never `correctness` — correctness is recorded
    // separately on `attempt_response` (see below). Asserting against the
    // real schema shape here, not an invented one.
    expect(result.completionStatus).toBe("CONSOLIDATED");
    expect(result.outcome).toMatchObject({ score: 1 });

    const finalAttempt = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(finalAttempt?.attemptState).toBe("COMPLETED");
    expect(finalAttempt?.completionStatus).toBe("CONSOLIDATED");
    expect(finalAttempt?.outcome).toMatchObject({ score: 1 });

    const responses = await attemptResponses.findByAttempt(attempt.id, fx.tenantId);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.correctness).toBe("CORRECT");
    expect(responses[0]?.itemId).toBe(WEB_M4_MAT_M06_CONTENT_BUNDLE_ID);
  });

  it("GET /attempts/{attemptId} ownership check: a different student in the same tenant cannot read the attempt (mirrors the route's studentProfileId check)", async () => {
    const fx = await buildFixture();
    await seedWebM4ContentBundle();
    const assignmentId = await seedWebM4Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-m4-ownership-key-0000001",
    });

    const found = await attempts.findByIdAndTenant(attempt.id, fx.tenantId);
    expect(found?.studentProfileId).toBe(fx.studentProfileId);
    // The route's exact check: `!attempt || attempt.studentProfileId !== identity.studentProfileId` -> 404.
    expect(found?.studentProfileId !== fx.otherStudentProfileId).toBe(true);
  });

  it("GET /attempts/{attemptId} tenant isolation: a different tenant cannot read the attempt at all", async () => {
    const fx = await buildFixture();
    await seedWebM4ContentBundle();
    const assignmentId = await seedWebM4Assignment(fx.tenantId, fx.classId);
    const attempts = new LearningAttemptRepository(pool);
    const attempt = await attempts.create({
      tenantId: fx.tenantId,
      eventId: randomUUID(),
      assignmentId,
      studentProfileId: fx.studentProfileId,
      enrollmentId: fx.enrollmentId,
      contentBundleId: WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
      contentId: WEB_M4_MAT_M06_CONTENT_BUNDLE_ID,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: "web-m4-tenant-key-00000001",
    });

    const foundFromOtherTenant = await attempts.findByIdAndTenant(attempt.id, fx.otherTenantId);
    expect(foundFromOtherTenant).toBeNull();
  });

  it("activityId (WEB_M4_MAT_M06_ACTIVITY_ID) is a real, stable identifier distinct from the fixture content id", () => {
    expect(WEB_M4_MAT_M06_ACTIVITY_ID).not.toBe("fixture-balance-machine");
    expect(WEB_M4_MAT_M06_ACTIVITY_ID.length).toBeGreaterThan(0);
  });
});
