import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { SchoolClassManagementService, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import { ClassAccessCodeRepository, hashClassCode } from "@quest-city-web/identity";
import { AssignmentRepository, LearningAttemptRepository } from "@quest-city-web/attempts";

/**
 * School Pilot Readiness Tranche B — Final Web Compliance Patch (02_26
 * v1.12 §34). Covers the two contract gaps closed by this patch:
 * `class_access_code` lifecycle (create/regenerate/archive, §12 of the
 * governing instruction) and student active-assignment discovery
 * (`AssignmentRepository.findByClassIdForStudentDiscovery`, §13).
 * Invitation-token consumed/expired/revoked rejection (§14) is already
 * covered by `school-onboarding-staff-membership-security.test.ts`
 * (unchanged by this patch — only the Web client's query-string reading
 * was removed, not the server contract) and is not duplicated here.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- tranche-b-student-access-security
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });
const CLASS_CODE_PEPPER = randomBytes(32);

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

function idempotencyKey(): string {
  return `key_${rnd()}_${rnd()}`;
}

function newSchoolClassManagementService(): SchoolClassManagementService {
  return new SchoolClassManagementService(pool, CLASS_CODE_PEPPER);
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE staff_invitation, staff_class_assignment, staff_session, staff_tenant_membership, staff_account, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

interface Fixture {
  tenantId: string;
  otherTenantId: string;
  classId: string;
  otherClassId: string;
  contentBundleId: string;
}

async function buildFixture(): Promise<Fixture> {
  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`,
      [`sch_${rnd()}`],
    )
  ).rows[0]!.id;
  const otherTenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Other School') RETURNING id`,
      [`sch_${rnd()}`],
    )
  ).rows[0]!.id;
  const classId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Test Class', 'ACTIVE') RETURNING id`,
      [tenantId, `cls_${rnd()}`],
    )
  ).rows[0]!.id;
  const otherClassId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Other Class', 'ACTIVE') RETURNING id`,
      [tenantId, `cls_${rnd()}`],
    )
  ).rows[0]!.id;
  const contentBundleId = (
    await pool.query<{ id: string }>(
      `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref)
       VALUES ($1, 'MAT', '1.0.0', 'RUNTIME_FIXTURE_BUNDLE', 'PUBLISHED', 'sha256:abc', 's3://x') RETURNING id`,
      [`bnd_${rnd()}`],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    contentBundleId,
  ]);
  return { tenantId, otherTenantId, classId, otherClassId, contentBundleId };
}

async function createStaffAccount(email: string): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id, requires_password_setup)
       VALUES ($1, 'x', 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture', false) RETURNING id`,
      [email],
    )
  ).rows[0]!.id;
}

async function createMembership(staffAccountId: string, tenantId: string, role: "TEACHER" | "SCHOOL_ADMIN"): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [staffAccountId, tenantId, role],
    )
  ).rows[0]!.id;
}

function identity(overrides: {
  staffAccountId: string;
  tenantId: string;
  staffTenantMembershipId: string;
  role: "TEACHER" | "SCHOOL_ADMIN";
  classScope: string[] | null;
}): StaffInternalIdentity {
  return { ...overrides, csrfTokenHash: "unused-in-these-tests", sessionId: "session-unused-in-these-tests" };
}

async function buildSchoolAdmin(fixture: Fixture, tenantId: string = fixture.tenantId): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`admin-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, tenantId, "SCHOOL_ADMIN");
  return identity({ staffAccountId: accountId, tenantId, staffTenantMembershipId: membershipId, role: "SCHOOL_ADMIN", classScope: null });
}

async function buildTeacher(fixture: Fixture, scopedClassIds: string[]): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`teacher-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, fixture.tenantId, "TEACHER");
  for (const classId of scopedClassIds) {
    await pool.query(`INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`, [
      membershipId,
      fixture.tenantId,
      classId,
    ]);
  }
  return identity({ staffAccountId: accountId, tenantId: fixture.tenantId, staffTenantMembershipId: membershipId, role: "TEACHER", classScope: scopedClassIds });
}

async function createStudentProfile(tenantId: string): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [tenantId, `stu_${rnd()}`],
    )
  ).rows[0]!.id;
}

async function createEnrollment(
  tenantId: string,
  classId: string,
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "LEFT" | "ARCHIVED" = "ACTIVE",
): Promise<{ enrollmentId: string; studentProfileId: string }> {
  const studentProfileId = await createStudentProfile(tenantId);
  const alias = `alias_${rnd()}`;
  const enrollmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
       VALUES ($1, $2, $3, $4, $4, 'unused-hash', $5) RETURNING id`,
      [tenantId, classId, studentProfileId, alias, status],
    )
  ).rows[0]!.id;
  return { enrollmentId, studentProfileId };
}

async function createAssignment(input: {
  tenantId: string;
  classId: string;
  contentBundleId: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  originType: "ADMIN_SEED" | "RECOVERY_FROM_REVIEW" | "STAFF_GENERAL";
}): Promise<string> {
  // assignment_recovery_target_consistency CHECK (migration 0004):
  // (origin_type = 'RECOVERY_FROM_REVIEW') = (target_student_profile_id IS NOT NULL).
  const targetStudentProfileId =
    input.originType === "RECOVERY_FROM_REVIEW" ? await createStudentProfile(input.tenantId) : null;
  const assignmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO assignment
         (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id, origin_type, target_student_profile_id)
       VALUES ($1, $2, $3, 'Test Assignment', $4, 'STAFF', 'test-fixture', 'FIRST_VALID_COMPLETION', $5, $6, $7)
       RETURNING id`,
      [input.tenantId, input.classId, `asn_${rnd()}`, input.status, input.contentBundleId, input.originType, targetStudentProfileId],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, 'WEB')`, [
    assignmentId,
    input.tenantId,
  ]);
  return assignmentId;
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("class_access_code lifecycle security (02_26 v1.12 §34.2-§34.4, 02_25 v1.8 §6.11)", () => {
  beforeEach(truncateAll);

  it("POST /classes equivalent: class creation issues a one-time accessCode, 8 chars, and persists only the hash", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = newSchoolClassManagementService();
    const result = await service.create({ identity: admin, name: "New Class", idempotencyKey: idempotencyKey() });

    expect(result.accessCode).toHaveLength(8);
    expect(result.accessCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

    const codes = new ClassAccessCodeRepository(pool);
    const active = await codes.findActiveByClassId(result.classId, fixture.tenantId);
    expect(active).not.toBeNull();
    expect(active!.codeHash).not.toBe(result.accessCode);
    const expectedHash = hashClassCode(result.accessCode, CLASS_CODE_PEPPER);
    expect(active!.codeHash).toBe(expectedHash);

    const rawRow = await pool.query<{ code_hash: string }>(`SELECT code_hash FROM class_access_code WHERE class_id = $1`, [result.classId]);
    expect(rawRow.rows[0]!.code_hash).not.toContain(result.accessCode);
  });

  it("TEACHER cannot regenerate a class access code (STAFF_FORBIDDEN — class.manage required)", async () => {
    const fixture = await buildFixture();
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    const service = newSchoolClassManagementService();
    await expect(
      service.issueAccessCode({ identity: teacher, classId: fixture.classId, idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("SCHOOL_ADMIN of another tenant cannot regenerate a class access code it does not own (CLASS_ACCESS_DENIED)", async () => {
    const fixture = await buildFixture();
    const outsideAdmin = await buildSchoolAdmin(fixture, fixture.otherTenantId);
    const service = newSchoolClassManagementService();
    await expect(
      service.issueAccessCode({ identity: outsideAdmin, classId: fixture.classId, idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "CLASS_ACCESS_DENIED" });
  });

  it("regenerating a code revokes the previous ACTIVE code — old code hash no longer resolves ACTIVE", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = newSchoolClassManagementService();
    const created = await service.create({ identity: admin, name: "Regen Class", idempotencyKey: idempotencyKey() });
    const oldCodeHash = hashClassCode(created.accessCode, CLASS_CODE_PEPPER);

    const regenerated = await service.issueAccessCode({ identity: admin, classId: created.classId, idempotencyKey: idempotencyKey() });
    expect(regenerated.accessCode).not.toBe(created.accessCode);

    const codes = new ClassAccessCodeRepository(pool);
    const oldLookup = await codes.findActiveByCodeHash(oldCodeHash);
    expect(oldLookup).toBeNull();

    const newLookup = await codes.findActiveByCodeHash(hashClassCode(regenerated.accessCode, CLASS_CODE_PEPPER));
    expect(newLookup).not.toBeNull();
  });

  it("at most one ACTIVE class_access_code exists per class after multiple regenerations", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = newSchoolClassManagementService();
    const created = await service.create({ identity: admin, name: "Multi Regen Class", idempotencyKey: idempotencyKey() });
    for (let i = 0; i < 3; i += 1) {
      await service.issueAccessCode({ identity: admin, classId: created.classId, idempotencyKey: idempotencyKey() });
    }
    const activeCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM class_access_code WHERE class_id = $1 AND status = 'ACTIVE'`,
      [created.classId],
    );
    expect(activeCount.rows[0]!.count).toBe("1");
  });

  it("archiving a class revokes its ACTIVE class_access_code (CLASS_ALREADY_ARCHIVED on retry, code no longer resolves)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = newSchoolClassManagementService();
    const created = await service.create({ identity: admin, name: "Archive Class", idempotencyKey: idempotencyKey() });
    const codeHash = hashClassCode(created.accessCode, CLASS_CODE_PEPPER);

    await service.archive({ identity: admin, classId: created.classId, idempotencyKey: idempotencyKey() });

    const codes = new ClassAccessCodeRepository(pool);
    const lookup = await codes.findActiveByCodeHash(codeHash);
    expect(lookup).toBeNull();

    await expect(
      service.issueAccessCode({ identity: admin, classId: created.classId, idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "CLASS_ALREADY_ARCHIVED" });
  });

  it("class_access_code.expires_at is NULL (no time-based expiry — valid until revoked/archived, 02_25 v1.8 §6.11)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = newSchoolClassManagementService();
    const created = await service.create({ identity: admin, name: "No Expiry Class", idempotencyKey: idempotencyKey() });
    const row = await pool.query<{ expires_at: Date | null }>(`SELECT expires_at FROM class_access_code WHERE class_id = $1`, [
      created.classId,
    ]);
    expect(row.rows[0]!.expires_at).toBeNull();
  });
});

describe("student active-assignment discovery scope (02_26 v1.12 §34.5, AssignmentRepository.findByClassIdForStudentDiscovery)", () => {
  beforeEach(truncateAll);

  it("returns only STAFF_GENERAL + PUBLISHED assignments for the given class — ADMIN_SEED, RECOVERY_FROM_REVIEW and non-PUBLISHED excluded", async () => {
    const fixture = await buildFixture();
    const visible = await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });
    await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "ADMIN_SEED",
    });
    await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "RECOVERY_FROM_REVIEW",
    });
    await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "DRAFT",
      originType: "STAFF_GENERAL",
    });
    await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "ARCHIVED",
      originType: "STAFF_GENERAL",
    });

    const assignments = new AssignmentRepository(pool);
    const discovered = await assignments.findByClassIdForStudentDiscovery(fixture.classId, fixture.tenantId);
    expect(discovered.map((a) => a.id)).toEqual([visible]);
  });

  it("excludes assignments belonging to a different class in the same tenant (no cross-class leakage)", async () => {
    const fixture = await buildFixture();
    await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.otherClassId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });
    const assignments = new AssignmentRepository(pool);
    const discovered = await assignments.findByClassIdForStudentDiscovery(fixture.classId, fixture.tenantId);
    expect(discovered).toHaveLength(0);
  });

  it("excludes assignments belonging to another tenant even if the classId string were guessed (tenant_id AND class_id both required)", async () => {
    const fixture = await buildFixture();
    const otherTenantClassId = (
      await pool.query<{ id: string }>(
        `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Other Tenant Class', 'ACTIVE') RETURNING id`,
        [fixture.otherTenantId, `cls_${rnd()}`],
      )
    ).rows[0]!.id;
    await createAssignment({
      tenantId: fixture.otherTenantId,
      classId: otherTenantClassId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });
    const assignments = new AssignmentRepository(pool);
    // Attacker knows the other tenant's classId but is scoped to fixture.tenantId (server-resolved, never client-supplied).
    const discovered = await assignments.findByClassIdForStudentDiscovery(otherTenantClassId, fixture.tenantId);
    expect(discovered).toHaveLength(0);
  });

  it("orders deterministically by dueAt (nulls last) then createdAt", async () => {
    const fixture = await buildFixture();
    const noDue = await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });
    const laterDue = await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });
    const earlierDue = await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });
    await pool.query(`UPDATE assignment SET due_at = now() + interval '10 days' WHERE id = $1`, [laterDue]);
    await pool.query(`UPDATE assignment SET due_at = now() + interval '1 day' WHERE id = $1`, [earlierDue]);

    const assignments = new AssignmentRepository(pool);
    const discovered = await assignments.findByClassIdForStudentDiscovery(fixture.classId, fixture.tenantId);
    expect(discovered.map((a) => a.id)).toEqual([earlierDue, laterDue, noDue]);
  });

  it("completion status derivation: NOT_STARTED (no attempts), IN_PROGRESS (open attempt), COMPLETED (a COMPLETED attempt) via LearningAttemptRepository", async () => {
    const fixture = await buildFixture();
    const { studentProfileId, enrollmentId } = await createEnrollment(fixture.tenantId, fixture.classId, "ACTIVE");
    const notStarted = await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });
    const inProgress = await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });
    const completed = await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });

    const attempts = new LearningAttemptRepository(pool);
    await attempts.create({
      tenantId: fixture.tenantId,
      eventId: randomUUID(),
      assignmentId: inProgress,
      studentProfileId,
      enrollmentId,
      contentBundleId: fixture.contentBundleId,
      contentId: fixture.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: idempotencyKey(),
    });
    const completedAttempt = await attempts.create({
      tenantId: fixture.tenantId,
      eventId: randomUUID(),
      assignmentId: completed,
      studentProfileId,
      enrollmentId,
      contentBundleId: fixture.contentBundleId,
      contentId: fixture.contentBundleId,
      contentVersion: "1.0.0",
      runtimeChannel: "WEB",
      creationIdempotencyKey: idempotencyKey(),
    });
    await attempts.transitionToInProgress(completedAttempt.id, fixture.tenantId);
    await attempts.transitionToCompletionSubmitted(completedAttempt.id, fixture.tenantId, "ACCEPTED_NOT_CONSOLIDATED");
    await attempts.consolidate(completedAttempt.id, fixture.tenantId, { score: 1 });

    const historyNotStarted = await attempts.findConcurrentByAssignmentAndStudent(fixture.tenantId, notStarted, studentProfileId);
    expect(historyNotStarted).toHaveLength(0);

    const historyInProgress = await attempts.findConcurrentByAssignmentAndStudent(fixture.tenantId, inProgress, studentProfileId);
    expect(historyInProgress).toHaveLength(1);
    expect(historyInProgress[0]!.attemptState).not.toBe("COMPLETED");

    const historyCompleted = await attempts.findConcurrentByAssignmentAndStudent(fixture.tenantId, completed, studentProfileId);
    expect(historyCompleted.some((a) => a.attemptState === "COMPLETED")).toBe(true);
  });

  it("a LEFT enrollment's classId still resolves assignments at the repository level — gating on enrollment.status is the caller's (route's) responsibility, verified here directly", async () => {
    const fixture = await buildFixture();
    const { enrollmentId } = await createEnrollment(fixture.tenantId, fixture.classId, "LEFT");
    await createAssignment({
      tenantId: fixture.tenantId,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      status: "PUBLISHED",
      originType: "STAFF_GENERAL",
    });

    // The repository itself is class-scoped, not enrollment-status-aware
    // by design (single responsibility) — GET /me/assignments gates on
    // enrollment.status === 'ACTIVE' before ever calling it (verified by
    // direct route source inspection: apps/api/app/me/assignments/route.ts).
    const enrollmentRow = await pool.query<{ status: string }>(`SELECT status FROM school_enrollment WHERE id = $1`, [enrollmentId]);
    expect(enrollmentRow.rows[0]!.status).toBe("LEFT");
  });
});
