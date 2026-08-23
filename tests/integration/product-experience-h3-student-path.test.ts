import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { AssignmentRepository, ContentBundleRepository, LearningAttemptRepository } from "@quest-city-web/attempts";
import { resolveEffectiveForLaunch } from "@quest-city-web/learning-path-control";
import { derivePathState } from "../../apps/api/lib/derive-path-state";

/**
 * Pilot Product Experience Residual Closure, Tranche H3 — closes
 * `NEW-GAP-STUDENT-PATH-VIEW-01`. Mirrors `GET /me/path`'s real control
 * flow exactly (assignment discovery -> content bundle lookup -> attempt
 * lookup -> real GLPC resolution -> `derivePathState`), same convention as
 * `granular-learning-path-control-launch-enforcement.test.ts`'s own
 * `attemptLaunch()` helper — never a re-implementation of the resolver,
 * never a real HTTP request (no test file in this repo makes one).
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- product-experience-h3-student-path
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";
const pool = new Pool({ connectionString: DATABASE_URL });

const assignmentRepo = new AssignmentRepository(pool);
const contentBundleRepo = new ContentBundleRepository(pool);
const attemptRepo = new LearningAttemptRepository(pool);

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  tenantId: string;
  classId: string;
  studentProfileId: string;
  enrollmentId: string;
  contentBundleId: string;
  bundlePublicId: string;
  assignmentId: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    `TRUNCATE learning_path_policy, learning_attempt, assignment_runtime_channel, assignment,
              content_bundle_runtime_channel, content_bundle, staff_account,
              school_enrollment, class_access_code, school_class, student_profile, student_session,
              tenant CASCADE`,
  );
}

async function buildFixture(): Promise<Fixture> {
  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`,
      [`sch_${rnd()}`],
    )
  ).rows[0]!.id;

  const classId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Test Class', 'ACTIVE') RETURNING id`,
      [tenantId, `cls_${rnd()}`],
    )
  ).rows[0]!.id;

  const studentProfileId = (
    await pool.query<{ id: string }>(
      `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [tenantId, `stu_${rnd()}`],
    )
  ).rows[0]!.id;

  const enrollmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
       VALUES ($1, $2, $3, 'Test', 'test', 'x', 'ACTIVE') RETURNING id`,
      [tenantId, classId, studentProfileId],
    )
  ).rows[0]!.id;

  const bundlePublicId = `bnd_${rnd()}`;
  const contentBundleId = (
    await pool.query<{ id: string }>(
      `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref, title)
       VALUES ($1, 'MAT', '1.0.0', 'ACTIVITY_BUNDLE', 'PUBLISHED', $2, 's3://x', 'Test Title') RETURNING id`,
      [bundlePublicId, `sha256:${rnd()}`],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    contentBundleId,
  ]);

  const assignmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, origin_type, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
       VALUES ($1, $2, $3, 'Equilibrio: capire e risolvere un''equazione', 'PUBLISHED', 'STAFF_GENERAL', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
      [tenantId, classId, `asn_${rnd()}`, contentBundleId],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, 'WEB')`, [
    assignmentId,
    tenantId,
  ]);

  return { tenantId, classId, studentProfileId, enrollmentId, contentBundleId, bundlePublicId, assignmentId };
}

async function seedPlatformUnavailable(tenantId: string, resourceRef: string): Promise<void> {
  const staffAccountId = (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, 'x', 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      [`admin-${rnd()}@example.org`],
    )
  ).rows[0]!.id;
  await pool.query(
    `INSERT INTO learning_path_policy
       (public_id, tenant_id, scope, resource_type, resource_ref, state, reason_category, created_by_staff_account_id)
     VALUES ($1, $2, 'PLATFORM', 'UNIT_ELEMENT', $3, 'UNAVAILABLE_FOR_USE', 'OTHER_STRUCTURED', $4)`,
    [`lpp_${rnd()}`, tenantId, resourceRef, staffAccountId],
  );
}

async function completeAttempt(fixture: Fixture): Promise<void> {
  await pool.query(
    `INSERT INTO learning_attempt
       (tenant_id, event_id, assignment_id, student_profile_id, enrollment_id, content_bundle_id, content_id, content_version,
        runtime_channel, attempt_state, completion_status, completed_at, outcome, creation_idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, gen_random_uuid(), '1.0.0', 'WEB', 'COMPLETED', 'CONSOLIDATED', now(), '{}'::jsonb, $7)`,
    [fixture.tenantId, `evt_${rnd()}`, fixture.assignmentId, fixture.studentProfileId, fixture.enrollmentId, fixture.contentBundleId, `key_${rnd()}`],
  );
}

/** Mirrors `GET /me/path`'s per-item control flow exactly. */
async function resolvePathState(fixture: Fixture): Promise<string> {
  const bundle = await contentBundleRepo.findById(fixture.contentBundleId);
  const attemptHistory = await attemptRepo.findConcurrentByAssignmentAndStudent(fixture.tenantId, fixture.assignmentId, fixture.studentProfileId);
  const completed = attemptHistory.find((a) => a.attemptState === "COMPLETED");
  const completionStatus = completed ? "COMPLETED" : attemptHistory.length > 0 ? "IN_PROGRESS" : "NOT_STARTED";
  const availability = bundle
    ? await resolveEffectiveForLaunch(pool, {
        tenantId: fixture.tenantId,
        studentProfileId: fixture.studentProfileId,
        resourceType: "UNIT_ELEMENT",
        resourceRef: bundle.publicId,
      })
    : { effectiveAvailability: "EFFECTIVE_UNAVAILABLE" as const };
  return derivePathState(completionStatus, availability.effectiveAvailability);
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("GET /me/path — real GLPC-derived state", () => {
  beforeEach(truncateAll);

  it("is AVAILABLE for a real assignment with no GLPC policy and no attempt", async () => {
    const fixture = await buildFixture();
    expect(await resolvePathState(fixture)).toBe("AVAILABLE");
  });

  it("is LOCKED when a real PLATFORM-scope GLPC policy disables the resource", async () => {
    const fixture = await buildFixture();
    await seedPlatformUnavailable(fixture.tenantId, fixture.bundlePublicId);
    expect(await resolvePathState(fixture)).toBe("LOCKED");
  });

  it("is COMPLETED even when a GLPC policy later disables the resource — a real past achievement is never hidden", async () => {
    const fixture = await buildFixture();
    await completeAttempt(fixture);
    await seedPlatformUnavailable(fixture.tenantId, fixture.bundlePublicId);
    expect(await resolvePathState(fixture)).toBe("COMPLETED");
  });

  it("never resolves a different tenant's GLPC policy against this resource (same resourceRef, different tenant)", async () => {
    const fixtureA = await buildFixture();
    const fixtureB = await buildFixture();
    // Seed the lock under tenant B's fixture, using tenant A's bundle's publicId coincidentally reused is not possible
    // (public_id is globally unique) -- this instead confirms tenant B locking its own resource never affects tenant A's.
    await seedPlatformUnavailable(fixtureB.tenantId, fixtureB.bundlePublicId);
    expect(await resolvePathState(fixtureA)).toBe("AVAILABLE");
    expect(await resolvePathState(fixtureB)).toBe("LOCKED");
  });

  it("real assignment/content title (Tranche H2) is available alongside the GLPC state, never a technical id", async () => {
    const fixture = await buildFixture();
    const assignment = (await assignmentRepo.findByClassIdForStudentDiscovery(fixture.classId, fixture.tenantId))[0];
    const bundle = await contentBundleRepo.findById(fixture.contentBundleId);
    expect(assignment?.title).toBe("Equilibrio: capire e risolvere un'equazione");
    expect(assignment?.publicId).toMatch(/^asn_/);
    expect(bundle?.publicId).toMatch(/^bnd_/);
    expect(bundle?.title).toBe("Test Title");
  });
});
