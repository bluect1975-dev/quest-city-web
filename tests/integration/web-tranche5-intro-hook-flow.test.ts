import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  AssignmentRepository,
  ContentBundleRepository,
  LearningAttemptRepository,
  resolveEngineDispatch,
} from "@quest-city-web/attempts";
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

describe("Tranche 5 content materialization against real assignment (non-interactive single stage)", () => {
  it("a real launch-shaped attempt for INTRO_HOOK's content resolves to no engine dispatch (07_26 v1.1 §17.2 'nessuna semantic action di dominio')", async () => {
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
    expect(resolveEngineDispatch(attempt.contentId)).toBeUndefined();

    // BLOCKED_CONTRACT_GAP (M06 Web Tranche 5 closure audit): in real
    // usage nothing ever calls POST /attempts/{id}/actions for this
    // content — INTRO_HOOK's "Continua" click logs no semantic action.
    // Canon (07_13 §10 R3C.2A correction, 02_36 §20-bis.10, 07_26 v1.1
    // §17.2) explicitly scopes every semantic action, CONFIRM_SOLUTION
    // included, as an action directed at a stage's Learning Engine;
    // INTRO_HOOK has none, and §17.2 states outright it involves no
    // domain semantic action. No canonical document (07_15_01 v1.2
    // §11-bis, 02_26 v1.8 §18.6, 02_36 §20-bis) defines any alternative,
    // authorized path for the attempt to leave CREATED — see the
    // regression guard below for the resulting, contract-compliant
    // ATTEMPT_NOT_COMPLETABLE outcome.
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
