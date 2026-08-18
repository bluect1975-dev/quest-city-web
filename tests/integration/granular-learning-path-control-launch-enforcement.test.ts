import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { StaffInternalIdentity, StaffRole } from "@quest-city-web/staff-identity";
import { LearningAttemptRepository } from "@quest-city-web/attempts";
import {
  LearningPathPolicyService,
  LearningPathAlternativeService,
  LearningPathSnapshotRepository,
  resolveEffectiveForLaunch,
} from "@quest-city-web/learning-path-control";

/**
 * GLPC launch-time enforcement suite (02_41 v1.2 §41-bis, 07_15_01 v1.4
 * §15.2-ter, contracts v1.16.0) -- closes BLOCKED_CANONICAL_CONTRACT.
 * Structural template is `granular-learning-path-control-security.test.ts`
 * (real dockerized Postgres, direct service/repository calls, never HTTP --
 * no test file in this repo makes real HTTP requests against a live server,
 * see `attempt-lifecycle.test.ts`/`web-m4-activity-flow.test.ts`, which
 * mirror route logic the same way).
 *
 * `attemptLaunch()` below mirrors
 * `apps/api/app/assignments/[assignmentId]/launch-context/route.ts`'s real
 * control flow exactly (existing-attempt lookup -> GLPC gate -> create ->
 * snapshot capture), so these tests exercise the same sequence the route
 * itself runs, not a re-implementation of the resolver alone.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- granular-learning-path-control-launch-enforcement
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";
const pool = new Pool({ connectionString: DATABASE_URL });

const policies = new LearningPathPolicyService(pool);
const alternatives = new LearningPathAlternativeService(pool);
const attempts = new LearningAttemptRepository(pool);
const snapshots = new LearningPathSnapshotRepository(pool);

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}
function idempotencyKey(): string {
  return `key_${rnd()}_${rnd()}`;
}

interface Fixture {
  tenantId: string;
  classId: string;
  studentProfileId: string;
  studentPublicId: string;
  enrollmentId: string;
  contentBundleId: string;
  bundlePublicId: string;
  assignmentId: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    `TRUNCATE learning_path_snapshot, learning_path_alternative, learning_path_policy,
              staff_class_assignment, staff_tenant_membership, staff_account,
              idempotency_record, semantic_action_log, attempt_response, learning_attempt,
              assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle,
              school_enrollment, class_access_code, school_class, student_profile, student_session,
              rate_limit_bucket, audit_event, tenant CASCADE`,
  );
}

async function buildFixture(): Promise<Fixture> {
  const tenantResult = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`,
    [`sch_${rnd()}`],
  );
  const tenantId = tenantResult.rows[0]!.id;

  const classResult = await pool.query<{ id: string }>(
    `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Test Class', 'ACTIVE') RETURNING id`,
    [tenantId, `cls_${rnd()}`],
  );
  const classId = classResult.rows[0]!.id;

  const studentPublicId = `stu_${rnd()}`;
  const profileResult = await pool.query<{ id: string }>(
    `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [tenantId, studentPublicId],
  );
  const studentProfileId = profileResult.rows[0]!.id;

  const enrollmentResult = await pool.query<{ id: string }>(
    `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
     VALUES ($1, $2, $3, 'Test', 'test', 'x', 'ACTIVE') RETURNING id`,
    [tenantId, classId, studentProfileId],
  );
  const enrollmentId = enrollmentResult.rows[0]!.id;

  const bundlePublicId = `bnd_${rnd()}`;
  const bundleResult = await pool.query<{ id: string }>(
    `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref)
     VALUES ($1, 'MAT', '1.0.0', 'RUNTIME_FIXTURE_BUNDLE', 'PUBLISHED', 'sha256:abc', 's3://x') RETURNING id`,
    [bundlePublicId],
  );
  const contentBundleId = bundleResult.rows[0]!.id;
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    contentBundleId,
  ]);

  const assignmentResult = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Test assignment', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
    [tenantId, classId, `asn_${rnd()}`, contentBundleId],
  );
  const assignmentId = assignmentResult.rows[0]!.id;
  await pool.query(`INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, 'WEB')`, [
    assignmentId,
    tenantId,
  ]);

  return { tenantId, classId, studentProfileId, studentPublicId, enrollmentId, contentBundleId, bundlePublicId, assignmentId };
}

async function createStaffAccount(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
     VALUES ($1, 'x', 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
    [email],
  );
  return result.rows[0]!.id;
}

async function createMembership(staffAccountId: string, tenantId: string, role: StaffRole): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [staffAccountId, tenantId, role],
  );
  return result.rows[0]!.id;
}

function identity(overrides: {
  staffAccountId: string;
  tenantId: string;
  staffTenantMembershipId: string;
  role: StaffRole;
  classScope: string[] | null;
}): StaffInternalIdentity {
  return { ...overrides, csrfTokenHash: "unused-in-these-tests", sessionId: "session-unused-in-these-tests" };
}

async function buildSchoolAdmin(tenantId: string): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`admin-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, tenantId, "SCHOOL_ADMIN");
  return identity({ staffAccountId: accountId, tenantId, staffTenantMembershipId: membershipId, role: "SCHOOL_ADMIN", classScope: null });
}

async function buildTeacher(tenantId: string, classScope: string[]): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`teacher-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, tenantId, "TEACHER");
  for (const classId of classScope) {
    await pool.query(`INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`, [
      membershipId,
      tenantId,
      classId,
    ]);
  }
  return identity({ staffAccountId: accountId, tenantId, staffTenantMembershipId: membershipId, role: "TEACHER", classScope });
}

/**
 * No PLATFORM-scope write path exists in `LearningPathPolicyService` (it is
 * deliberately out of this Web milestone's scope, gated separately by
 * `@quest-city-web/platform-admin` -- see the service's own header comment).
 * The resolver still fully honors an existing PLATFORM-scope row however it
 * got there, so this seeds it directly, exactly as the resolver reads it.
 */
async function seedPlatformUnavailable(tenantId: string, resourceRef: string, createdByStaffAccountId: string): Promise<void> {
  await pool.query(
    `INSERT INTO learning_path_policy
       (public_id, tenant_id, scope, resource_type, resource_ref, state, reason_category, created_by_staff_account_id)
     VALUES ($1, $2, 'PLATFORM', 'UNIT_ELEMENT', $3, 'UNAVAILABLE_FOR_USE', 'OTHER_STRUCTURED', $4)`,
    [`lpp_${rnd()}`, tenantId, resourceRef, createdByStaffAccountId],
  );
}

type LaunchResult =
  | { outcome: "resumed"; attemptId: string }
  | { outcome: "denied"; resolved: Awaited<ReturnType<typeof resolveEffectiveForLaunch>> }
  | { outcome: "created"; attemptId: string; resolved: Awaited<ReturnType<typeof resolveEffectiveForLaunch>> };

/**
 * Mirrors `launch-context/route.ts`'s real control flow exactly: existing
 * (resume) short-circuits before the GLPC gate is ever evaluated -- an
 * attempt already ACTIVE under its own immutable snapshot is never
 * retroactively re-gated (finish-current-attempt, 02_41 §34) -- only a
 * genuinely new creation-idempotency key reaches the gate.
 */
async function attemptLaunch(fx: Fixture, key: string): Promise<LaunchResult> {
  const existing = await attempts.findByCreationKey(fx.tenantId, fx.assignmentId, fx.studentProfileId, key);
  if (existing) {
    return { outcome: "resumed", attemptId: existing.id };
  }

  const resolved = await resolveEffectiveForLaunch(pool, {
    tenantId: fx.tenantId,
    studentProfileId: fx.studentProfileId,
    resourceType: "UNIT_ELEMENT",
    resourceRef: fx.bundlePublicId,
  });

  if (resolved.effectiveAvailability === "EFFECTIVE_UNAVAILABLE") {
    return { outcome: "denied", resolved };
  }

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
    creationIdempotencyKey: key,
  });
  await snapshots.capture({ tenantId: fx.tenantId, learningAttemptId: attempt.id, resolvedAvailability: resolved });
  return { outcome: "created", attemptId: attempt.id, resolved };
}

async function countAttempts(fx: Fixture): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM learning_attempt WHERE tenant_id = $1 AND assignment_id = $2 AND student_profile_id = $3`,
    [fx.tenantId, fx.assignmentId, fx.studentProfileId],
  );
  return Number(result.rows[0]!.count);
}

async function countSnapshots(): Promise<number> {
  const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM learning_path_snapshot`);
  return Number(result.rows[0]!.count);
}

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("GLPC launch gate — availability matrix (02_41 v1.2 §41-bis)", () => {
  it("A. ENABLED (no policy, INHERIT default): launch succeeds", async () => {
    const fx = await buildFixture();
    const result = await attemptLaunch(fx, idempotencyKey());
    expect(result.outcome).toBe("created");
    expect(await countAttempts(fx)).toBe(1);
    expect(await countSnapshots()).toBe(1);
  });

  it("B. SCHOOL DISABLED: 409-equivalent deny, sourceScope SCHOOL, no attempt/snapshot", async () => {
    const fx = await buildFixture();
    const admin = await buildSchoolAdmin(fx.tenantId);
    await policies.create({
      identity: admin,
      scope: "SCHOOL",
      resourceType: "UNIT_ELEMENT",
      resourceRef: fx.bundlePublicId,
      state: "DISABLED",
      reasonCategory: "SCHOOL_POLICY",
      idempotencyKey: idempotencyKey(),
    });

    const result = await attemptLaunch(fx, idempotencyKey());
    expect(result.outcome).toBe("denied");
    if (result.outcome === "denied") {
      expect(result.resolved.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
      expect(result.resolved.sourceScope).toBe("SCHOOL");
    }
    expect(await countAttempts(fx)).toBe(0);
    expect(await countSnapshots()).toBe(0);
  });

  it("C. CLASS DISABLED: 409-equivalent deny, sourceScope CLASS, no attempt/snapshot", async () => {
    const fx = await buildFixture();
    const teacher = await buildTeacher(fx.tenantId, [fx.classId]);
    await policies.create({
      identity: teacher,
      scope: "CLASS",
      scopeClassId: fx.classId,
      resourceType: "UNIT_ELEMENT",
      resourceRef: fx.bundlePublicId,
      state: "DISABLED",
      reasonCategory: "TEACHER_DECISION",
      idempotencyKey: idempotencyKey(),
    });

    const result = await attemptLaunch(fx, idempotencyKey());
    expect(result.outcome).toBe("denied");
    if (result.outcome === "denied") {
      expect(result.resolved.sourceScope).toBe("CLASS");
    }
    expect(await countAttempts(fx)).toBe(0);
    expect(await countSnapshots()).toBe(0);
  });

  it("D. STUDENT DISABLED: 409-equivalent deny, sourceScope STUDENT, no attempt/snapshot", async () => {
    const fx = await buildFixture();
    const teacher = await buildTeacher(fx.tenantId, [fx.classId]);
    await policies.create({
      identity: teacher,
      scope: "STUDENT",
      scopeStudentPublicId: fx.studentPublicId,
      resourceType: "UNIT_ELEMENT",
      resourceRef: fx.bundlePublicId,
      state: "DISABLED",
      reasonCategory: "TEACHER_DECISION",
      idempotencyKey: idempotencyKey(),
    });

    const result = await attemptLaunch(fx, idempotencyKey());
    expect(result.outcome).toBe("denied");
    if (result.outcome === "denied") {
      expect(result.resolved.sourceScope).toBe("STUDENT");
    }
    expect(await countAttempts(fx)).toBe(0);
    expect(await countSnapshots()).toBe(0);
  });

  it("E. PLATFORM UNAVAILABLE_FOR_USE: hard lock deny, no lower-scope bypass, no attempt/snapshot", async () => {
    const fx = await buildFixture();
    const admin = await buildSchoolAdmin(fx.tenantId);
    await seedPlatformUnavailable(fx.tenantId, fx.bundlePublicId, admin.staffAccountId);

    // A lower-scope ENABLED attempt does not override the Platform hard lock.
    await pool.query(
      `INSERT INTO learning_path_policy
         (public_id, tenant_id, scope, scope_class_id, resource_type, resource_ref, state, reason_category, created_by_staff_account_id)
       VALUES ($1, $2, 'CLASS', $3, 'UNIT_ELEMENT', $4, 'ENABLED', 'TEACHER_DECISION', $5)`,
      [`lpp_${rnd()}`, fx.tenantId, fx.classId, fx.bundlePublicId, admin.staffAccountId],
    );

    const result = await attemptLaunch(fx, idempotencyKey());
    expect(result.outcome).toBe("denied");
    if (result.outcome === "denied") {
      expect(result.resolved.sourceScope).toBe("PLATFORM");
    }
    expect(await countAttempts(fx)).toBe(0);
    expect(await countSnapshots()).toBe(0);
  });

  it("F. DISABLED_AND_WAIVED: original activity still denied at launch (waiver affects completion requirement only, never launchability)", async () => {
    const fx = await buildFixture();
    const teacher = await buildTeacher(fx.tenantId, [fx.classId]);
    await policies.create({
      identity: teacher,
      scope: "CLASS",
      scopeClassId: fx.classId,
      resourceType: "UNIT_ELEMENT",
      resourceRef: fx.bundlePublicId,
      state: "DISABLED_AND_WAIVED",
      reasonCategory: "ACCESSIBILITY",
      idempotencyKey: idempotencyKey(),
    });

    const result = await attemptLaunch(fx, idempotencyKey());
    expect(result.outcome).toBe("denied");
    if (result.outcome === "denied") {
      expect(result.resolved.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
      expect(result.resolved.waiverState).toBe(true);
    }
    expect(await countAttempts(fx)).toBe(0);
    expect(await countSnapshots()).toBe(0);
  });

  it("G. DISABLED_WITH_ALTERNATIVE: original resource still denied at launch; the resolution carries the alternative reference (redirect/UI wiring is out of scope of this correction, 02_41 §27/§39)", async () => {
    const fx = await buildFixture();
    const teacher = await buildTeacher(fx.tenantId, [fx.classId]);
    await alternatives.create({
      identity: teacher,
      originalResourceType: "UNIT_ELEMENT",
      originalResourceRef: fx.bundlePublicId,
      alternativeContentRef: "bnd_alt_content",
      idempotencyKey: idempotencyKey(),
    });
    await policies.create({
      identity: teacher,
      scope: "CLASS",
      scopeClassId: fx.classId,
      resourceType: "UNIT_ELEMENT",
      resourceRef: fx.bundlePublicId,
      state: "DISABLED_WITH_ALTERNATIVE",
      reasonCategory: "ALTERNATIVE_ACTIVITY",
      alternativeContentRef: "bnd_alt_content",
      idempotencyKey: idempotencyKey(),
    });

    const result = await attemptLaunch(fx, idempotencyKey());
    expect(result.outcome).toBe("denied");
    if (result.outcome === "denied") {
      expect(result.resolved.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
      expect(result.resolved.alternativeContentRef).toBe("bnd_alt_content");
    }
    expect(await countAttempts(fx)).toBe(0);
    expect(await countSnapshots()).toBe(0);
  });

  it("H. assignment exists and is otherwise fully valid, but the resource it targets is effectively unavailable: still denied (assignment existence never overrides GLPC, 02_41 §41)", async () => {
    const fx = await buildFixture();
    const admin = await buildSchoolAdmin(fx.tenantId);
    // Assignment is real, PUBLISHED, and readable -- confirm that directly.
    const assignmentRow = await pool.query(`SELECT status FROM assignment WHERE id = $1`, [fx.assignmentId]);
    expect(assignmentRow.rows[0]?.status).toBe("PUBLISHED");

    await policies.create({
      identity: admin,
      scope: "SCHOOL",
      resourceType: "UNIT_ELEMENT",
      resourceRef: fx.bundlePublicId,
      state: "DISABLED",
      reasonCategory: "SCHOOL_POLICY",
      idempotencyKey: idempotencyKey(),
    });

    const result = await attemptLaunch(fx, idempotencyKey());
    expect(result.outcome).toBe("denied");
  });

  it("I. knowing the real assignmentId/resourceRef does not bypass GLPC: the exact same real identifiers used by a successful launch above are denied once policy disables them (server resolution is authoritative, 02_41 §51)", async () => {
    const fx = await buildFixture();
    const firstKey = idempotencyKey();
    const before = await attemptLaunch(fx, firstKey);
    expect(before.outcome).toBe("created"); // same fx.assignmentId/bundlePublicId, currently available

    const admin = await buildSchoolAdmin(fx.tenantId);
    await policies.create({
      identity: admin,
      scope: "SCHOOL",
      resourceType: "UNIT_ELEMENT",
      resourceRef: fx.bundlePublicId,
      state: "DISABLED",
      reasonCategory: "SCHOOL_POLICY",
      idempotencyKey: idempotencyKey(),
    });

    // A fresh launch (new idempotency key) against the identical, real,
    // still-existing assignmentId is now denied -- no bypass via knowledge
    // of a valid identifier.
    const after = await attemptLaunch(fx, idempotencyKey());
    expect(after.outcome).toBe("denied");
  });
});

describe("GLPC launch gate — active attempt preserved (finish-current-attempt, 02_41 §34)", () => {
  it("an attempt already ACTIVE keeps resuming after policy changes to DISABLED; a subsequent fresh launch is denied", async () => {
    const fx = await buildFixture();
    const key = idempotencyKey();

    const launched = await attemptLaunch(fx, key);
    expect(launched.outcome).toBe("created");
    const originalAttemptId = launched.outcome === "created" ? launched.attemptId : "";
    await attempts.transitionToInProgress(originalAttemptId, fx.tenantId);

    const teacher = await buildTeacher(fx.tenantId, [fx.classId]);
    await policies.create({
      identity: teacher,
      scope: "CLASS",
      scopeClassId: fx.classId,
      resourceType: "UNIT_ELEMENT",
      resourceRef: fx.bundlePublicId,
      state: "DISABLED",
      reasonCategory: "TEACHER_DECISION",
      idempotencyKey: idempotencyKey(),
    });

    // Resume (same key, e.g. a page reload mid-session): the existing
    // ACTIVE attempt is returned unchanged, never re-gated or terminated.
    const resumed = await attemptLaunch(fx, key);
    expect(resumed.outcome).toBe("resumed");
    if (resumed.outcome === "resumed") {
      expect(resumed.attemptId).toBe(originalAttemptId);
    }
    const stillInProgress = await attempts.findByIdAndTenant(originalAttemptId, fx.tenantId);
    expect(stillInProgress?.attemptState).toBe("IN_PROGRESS");

    // A genuinely fresh launch (new key) is denied.
    const fresh = await attemptLaunch(fx, idempotencyKey());
    expect(fresh.outcome).toBe("denied");

    // Exactly the one original attempt exists -- the denied fresh launch
    // created nothing.
    expect(await countAttempts(fx)).toBe(1);
    expect(await countSnapshots()).toBe(1);
  });
});

describe("GLPC launch gate — idempotency (no orphan/poisoned state)", () => {
  it("a denied launch does not consume its idempotency key -- the same key succeeds later once policy allows it", async () => {
    const fx = await buildFixture();
    const key = idempotencyKey();
    const admin = await buildSchoolAdmin(fx.tenantId);

    const policy = await policies.create({
      identity: admin,
      scope: "SCHOOL",
      resourceType: "UNIT_ELEMENT",
      resourceRef: fx.bundlePublicId,
      state: "DISABLED",
      reasonCategory: "SCHOOL_POLICY",
      idempotencyKey: idempotencyKey(),
    });

    const denied = await attemptLaunch(fx, key);
    expect(denied.outcome).toBe("denied");
    expect(await countAttempts(fx)).toBe(0);

    await policies.delete(admin, policy.publicId, idempotencyKey());

    // Same idempotency key, retried after the policy is removed: succeeds,
    // exactly once -- the earlier denial never poisoned the key.
    const retried = await attemptLaunch(fx, key);
    expect(retried.outcome).toBe("created");
    expect(await countAttempts(fx)).toBe(1);
  });
});
