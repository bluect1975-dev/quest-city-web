import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  StaffInvitationService,
  StaffMembershipService,
  SchoolClassManagementService,
  RosterManagementService,
  GeneralAssignmentService,
  StaffIdentityError,
  type StaffInternalIdentity,
} from "@quest-city-web/staff-identity";

/**
 * School Pilot Readiness Tranche B security test suite (02_35 v1.2
 * §11bis, migration 0008) against a real, dockerized PostgreSQL instance.
 * Complements the functional coverage already exercised implicitly by
 * the service implementations: cross-tenant isolation, capability
 * enforcement (9 capabilities, role-static + classScope), anti-
 * enumeration invitation lifecycle, membership-lifecycle guards,
 * idempotency (replay/conflict), and secret-redaction in the
 * idempotency-record replay cache.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- school-onboarding-staff-membership-security
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

/** School Pilot Readiness Tranche B final Web compliance patch (02_26 v1.12 §34): fixture pepper for `SchoolClassManagementService`'s class-code hashing (same mechanism as `ClassCodeService`). */
const CLASS_CODE_PEPPER = randomBytes(32);

function newSchoolClassManagementService(): SchoolClassManagementService {
  return new SchoolClassManagementService(pool, CLASS_CODE_PEPPER);
}

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

function idempotencyKey(): string {
  return `key_${rnd()}_${rnd()}`;
}

interface Fixture {
  tenantId: string;
  otherTenantId: string;
  classId: string;
  otherClassId: string;
  otherTenantClassId: string;
  contentBundleId: string;
  draftContentBundleId: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE staff_invitation, staff_class_assignment, staff_session, staff_tenant_membership, staff_account, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
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
  const otherTenantClassId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Other Tenant Class', 'ACTIVE') RETURNING id`,
      [otherTenantId, `cls_${rnd()}`],
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
  const draftContentBundleId = (
    await pool.query<{ id: string }>(
      `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref)
       VALUES ($1, 'MAT', '1.0.0', 'RUNTIME_FIXTURE_BUNDLE', 'DRAFT', 'sha256:def', 's3://y') RETURNING id`,
      [`bnd_${rnd()}`],
    )
  ).rows[0]!.id;

  return { tenantId, otherTenantId, classId, otherClassId, otherTenantClassId, contentBundleId, draftContentBundleId };
}

async function createStaffAccount(
  email: string,
  overrides: Partial<{ status: "ACTIVE" | "SUSPENDED"; requiresPasswordSetup: boolean }> = {},
): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id, requires_password_setup)
       VALUES ($1, 'x', 'scrypt', $2, 'ADMIN_SEED_SCRIPT', 'test-fixture', $3) RETURNING id`,
      [email, overrides.status ?? "ACTIVE", overrides.requiresPasswordSetup ?? false],
    )
  ).rows[0]!.id;
}

async function createMembership(
  staffAccountId: string,
  tenantId: string,
  role: "TEACHER" | "SCHOOL_ADMIN",
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED" = "ACTIVE",
): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [staffAccountId, tenantId, role, status],
    )
  ).rows[0]!.id;
}

async function assignTeacherToClassRaw(membershipId: string, tenantId: string, classId: string): Promise<void> {
  await pool.query(`INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`, [
    membershipId,
    tenantId,
    classId,
  ]);
}

function identity(overrides: {
  staffAccountId: string;
  tenantId: string;
  staffTenantMembershipId: string;
  role: "TEACHER" | "SCHOOL_ADMIN";
  classScope: string[] | null;
}): StaffInternalIdentity {
  return { ...overrides, csrfTokenHash: "unused-in-these-tests" };
}

async function buildSchoolAdmin(fixture: Fixture): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`admin-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");
  return identity({ staffAccountId: accountId, tenantId: fixture.tenantId, staffTenantMembershipId: membershipId, role: "SCHOOL_ADMIN", classScope: null });
}

async function buildTeacher(fixture: Fixture, scopedClassIds: string[]): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`teacher-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, fixture.tenantId, "TEACHER");
  for (const classId of scopedClassIds) {
    await assignTeacherToClassRaw(membershipId, fixture.tenantId, classId);
  }
  return identity({
    staffAccountId: accountId,
    tenantId: fixture.tenantId,
    staffTenantMembershipId: membershipId,
    role: "TEACHER",
    classScope: scopedClassIds,
  });
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("Cross-tenant isolation (02_35 §5, §13)", () => {
  beforeEach(truncateAll);

  it("SCHOOL_ADMIN cannot rename a class belonging to another tenant (CLASS_ACCESS_DENIED)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = newSchoolClassManagementService();
    await expect(
      service.update({ identity: admin, classId: fixture.otherTenantClassId, name: "Hijacked", idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "CLASS_ACCESS_DENIED" });
  });

  it("SCHOOL_ADMIN cannot update the status of a membership belonging to another tenant (MEMBERSHIP_NOT_FOUND)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const otherAdminAccountId = await createStaffAccount(`other-admin-${rnd()}@example.org`);
    const otherMembershipId = await createMembership(otherAdminAccountId, fixture.otherTenantId, "SCHOOL_ADMIN");
    const service = new StaffMembershipService(pool);
    await expect(
      service.updateStatus({ identity: admin, staffTenantMembershipId: otherMembershipId, action: "SUSPEND", idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_NOT_FOUND" });
  });

  it("SCHOOL_ADMIN cannot add a roster student to another tenant's class (CLASS_ACCESS_DENIED)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = new RosterManagementService(pool);
    await expect(
      service.addStudent({
        identity: admin,
        classId: fixture.otherTenantClassId,
        mode: "NEW",
        studentPublicId: undefined,
        accessAlias: "Intruder",
        pin: undefined,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "CLASS_ACCESS_DENIED" });
  });
});

describe("Capability enforcement (9 capabilities, 02_35 v1.2 §11bis.10)", () => {
  beforeEach(truncateAll);

  it("TEACHER lacks staff.invite -> STAFF_FORBIDDEN", async () => {
    const fixture = await buildFixture();
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    const service = new StaffInvitationService(pool);
    await expect(
      service.createInvitation({ identity: teacher, email: "new-teacher@example.org", idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("TEACHER lacks class.create -> STAFF_FORBIDDEN", async () => {
    const fixture = await buildFixture();
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    const service = newSchoolClassManagementService();
    await expect(service.create({ identity: teacher, name: "New Class", idempotencyKey: idempotencyKey() })).rejects.toMatchObject({
      code: "STAFF_FORBIDDEN",
    });
  });

  it("TEACHER lacks class.manage -> STAFF_FORBIDDEN even for a class in its own scope", async () => {
    const fixture = await buildFixture();
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    const service = newSchoolClassManagementService();
    await expect(
      service.update({ identity: teacher, classId: fixture.classId, name: "Renamed", idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("TEACHER lacks class.teacher.assign -> STAFF_FORBIDDEN", async () => {
    const fixture = await buildFixture();
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    const otherTeacherAccountId = await createStaffAccount(`other-teacher-${rnd()}@example.org`);
    const otherMembershipId = await createMembership(otherTeacherAccountId, fixture.tenantId, "TEACHER");
    const service = newSchoolClassManagementService();
    await expect(
      service.assignTeacher({
        identity: teacher,
        classId: fixture.classId,
        staffTenantMembershipId: otherMembershipId,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("TEACHER lacks staff.membership.suspend/revoke -> STAFF_FORBIDDEN", async () => {
    const fixture = await buildFixture();
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    const service = new StaffMembershipService(pool);
    await expect(
      service.updateStatus({
        identity: teacher,
        staffTenantMembershipId: teacher.staffTenantMembershipId,
        action: "SUSPEND",
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("TEACHER out-of-scope class denied for roster.manage (CLASS_ACCESS_DENIED, not STAFF_FORBIDDEN — capability held, scope denied)", async () => {
    const fixture = await buildFixture();
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    const service = new RosterManagementService(pool);
    await expect(
      service.addStudent({
        identity: teacher,
        classId: fixture.otherClassId,
        mode: "NEW",
        studentPublicId: undefined,
        accessAlias: "OutOfScope",
        pin: undefined,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "CLASS_ACCESS_DENIED" });
  });

  it("TEACHER out-of-scope class denied for assignment.create (CLASS_ACCESS_DENIED)", async () => {
    const fixture = await buildFixture();
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    const service = new GeneralAssignmentService(pool);
    await expect(
      service.create({
        identity: teacher,
        classId: fixture.otherClassId,
        contentBundleId: fixture.contentBundleId,
        title: "Out of scope assignment",
        allowedRuntimeChannels: ["WEB"],
        opensAt: null,
        dueAt: null,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "CLASS_ACCESS_DENIED" });
  });

  it("TEACHER in-scope class succeeds for roster.manage and assignment.create (positive capability check)", async () => {
    const fixture = await buildFixture();
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    const roster = new RosterManagementService(pool);
    const rosterResult = await roster.addStudent({
      identity: teacher,
      classId: fixture.classId,
      mode: "NEW",
      studentPublicId: undefined,
      accessAlias: "InScope",
      pin: undefined,
      idempotencyKey: idempotencyKey(),
    });
    expect(rosterResult.classId).toBe(fixture.classId);

    const assignments = new GeneralAssignmentService(pool);
    const assignmentResult = await assignments.create({
      identity: teacher,
      classId: fixture.classId,
      contentBundleId: fixture.contentBundleId,
      title: "In-scope assignment",
      allowedRuntimeChannels: ["WEB"],
      opensAt: null,
      dueAt: null,
      idempotencyKey: idempotencyKey(),
    });
    expect(assignmentResult.classId).toBe(fixture.classId);
  });

  it("SCHOOL_ADMIN implicit whole-tenant scope: can manage a class it was never explicitly assigned to", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = newSchoolClassManagementService();
    const result = await service.update({ identity: admin, classId: fixture.otherClassId, name: "Renamed by admin", idempotencyKey: idempotencyKey() });
    expect(result.name).toBe("Renamed by admin");
  });
});

describe("Invitation lifecycle & anti-enumeration (02_35 v1.2 §11bis.3, §13)", () => {
  beforeEach(truncateAll);

  it("an unknown token and a revoked invitation's token both resolve to the identical INVITATION_NOT_FOUND (anti-enumeration)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const invitations = new StaffInvitationService(pool);
    const created = await invitations.createInvitation({ identity: admin, email: "revoked@example.org", idempotencyKey: idempotencyKey() });

    // Revoke by transitioning the membership straight to REVOKED (simulates the membership service's REVOKE action).
    await pool.query(`UPDATE staff_tenant_membership SET status = 'REVOKED' WHERE id = $1`, [created.staffTenantMembershipId]);
    await pool.query(`UPDATE staff_invitation SET revoked_at = now() WHERE staff_tenant_membership_id = $1`, [created.staffTenantMembershipId]);

    const unknownTokenError = await invitations.acceptInvitation({ token: "totally-unknown-token", password: undefined }).catch((e: unknown) => e);
    const revokedTokenError = await invitations.acceptInvitation({ token: created.acceptanceToken, password: undefined }).catch((e: unknown) => e);

    expect(unknownTokenError).toBeInstanceOf(StaffIdentityError);
    expect(revokedTokenError).toBeInstanceOf(StaffIdentityError);
    expect((unknownTokenError as StaffIdentityError).code).toBe("INVITATION_NOT_FOUND");
    expect((revokedTokenError as StaffIdentityError).code).toBe("INVITATION_NOT_FOUND");
  });

  it("an expired invitation token is rejected with INVITATION_EXPIRED", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const invitations = new StaffInvitationService(pool);
    const created = await invitations.createInvitation({ identity: admin, email: "expired@example.org", idempotencyKey: idempotencyKey() });
    // Must also push created_at back — staff_invitation_check requires expires_at > created_at.
    await pool.query(
      `UPDATE staff_invitation SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE staff_tenant_membership_id = $1`,
      [created.staffTenantMembershipId],
    );

    await expect(invitations.acceptInvitation({ token: created.acceptanceToken, password: "a-strong-password-123" })).rejects.toMatchObject({
      code: "INVITATION_EXPIRED",
    });
  });

  it("an already-consumed invitation token is rejected with INVITATION_ALREADY_CONSUMED on a second accept", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const invitations = new StaffInvitationService(pool);
    const created = await invitations.createInvitation({ identity: admin, email: "double-accept@example.org", idempotencyKey: idempotencyKey() });
    await invitations.acceptInvitation({ token: created.acceptanceToken, password: "a-strong-password-123" });

    await expect(invitations.acceptInvitation({ token: created.acceptanceToken, password: undefined })).rejects.toMatchObject({
      code: "INVITATION_ALREADY_CONSUMED",
    });
  });

  it("inviting an email tied to a SUSPENDED existing staff_account is rejected with TEACHER_ACCOUNT_SUSPENDED", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    await createStaffAccount("suspended-teacher@example.org", { status: "SUSPENDED" });
    const invitations = new StaffInvitationService(pool);
    await expect(
      invitations.createInvitation({ identity: admin, email: "suspended-teacher@example.org", idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "TEACHER_ACCOUNT_SUSPENDED" });
  });
});

describe("Membership lifecycle guards (02_35 v1.2 §11bis.2)", () => {
  beforeEach(truncateAll);

  it("LAST_SCHOOL_ADMIN_PROTECTED: the sole ACTIVE SCHOOL_ADMIN cannot suspend or revoke its own membership", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = new StaffMembershipService(pool);
    await expect(
      service.updateStatus({ identity: admin, staffTenantMembershipId: admin.staffTenantMembershipId, action: "SUSPEND", idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "LAST_SCHOOL_ADMIN_PROTECTED" });
    await expect(
      service.updateStatus({ identity: admin, staffTenantMembershipId: admin.staffTenantMembershipId, action: "REVOKE", idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "LAST_SCHOOL_ADMIN_PROTECTED" });
  });

  it("a second ACTIVE SCHOOL_ADMIN CAN suspend the first (LAST_SCHOOL_ADMIN_PROTECTED only applies when count <= 1)", async () => {
    const fixture = await buildFixture();
    const firstAdmin = await buildSchoolAdmin(fixture);
    const secondAdmin = await buildSchoolAdmin(fixture);
    const service = new StaffMembershipService(pool);
    const result = await service.updateStatus({
      identity: secondAdmin,
      staffTenantMembershipId: firstAdmin.staffTenantMembershipId,
      action: "SUSPEND",
      idempotencyKey: idempotencyKey(),
    });
    expect(result.status).toBe("SUSPENDED");
  });

  it("SUSPEND on an already-SUSPENDED membership is rejected with MEMBERSHIP_STATUS_UNCHANGED (illegal source status)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const teacherAccountId = await createStaffAccount(`teacher-${rnd()}@example.org`);
    const teacherMembershipId = await createMembership(teacherAccountId, fixture.tenantId, "TEACHER", "SUSPENDED");
    const service = new StaffMembershipService(pool);
    await expect(
      service.updateStatus({ identity: admin, staffTenantMembershipId: teacherMembershipId, action: "SUSPEND", idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_STATUS_UNCHANGED" });
  });

  it("removing a student from the roster is a soft LEFT transition — student_profile and any prior enrollment row remain in the database", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const roster = new RosterManagementService(pool);
    const added = await roster.addStudent({
      identity: admin,
      classId: fixture.classId,
      mode: "NEW",
      studentPublicId: undefined,
      accessAlias: "Departing",
      pin: undefined,
      idempotencyKey: idempotencyKey(),
    });

    await roster.removeStudent({ identity: admin, classId: fixture.classId, studentProfileId: added.studentProfileId, idempotencyKey: idempotencyKey() });

    const profileRow = await pool.query(`SELECT status FROM student_profile WHERE id = $1`, [added.studentProfileId]);
    expect(profileRow.rows).toHaveLength(1);
    const enrollmentRow = await pool.query(`SELECT status FROM school_enrollment WHERE student_profile_id = $1`, [added.studentProfileId]);
    expect(enrollmentRow.rows[0]!.status).toBe("LEFT");

    // Removal is idempotent-in-effect for a repeat attempt: a second removeStudent on the now-LEFT enrollment is rejected, never a silent no-op that could mask a bug.
    await expect(
      roster.removeStudent({ identity: admin, classId: fixture.classId, studentProfileId: added.studentProfileId, idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "ENROLLMENT_NOT_ACTIVE" });
  });
});

describe("Idempotency (02_35 v1.2 §11bis.11, generation-based)", () => {
  beforeEach(truncateAll);

  it("replaying the same Idempotency-Key with the same payload returns the cached response without creating a second staff_invitation row", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = new StaffInvitationService(pool);
    const key = idempotencyKey();
    const first = await service.createInvitation({ identity: admin, email: "replay@example.org", idempotencyKey: key });
    const second = await service.createInvitation({ identity: admin, email: "replay@example.org", idempotencyKey: key });

    expect(second.staffTenantMembershipId).toBe(first.staffTenantMembershipId);
    const countRow = await pool.query(`SELECT count(*)::int AS n FROM staff_invitation WHERE staff_tenant_membership_id = $1`, [
      first.staffTenantMembershipId,
    ]);
    expect(countRow.rows[0]!.n).toBe(1);
  });

  it("reusing the same Idempotency-Key with a DIFFERENT payload is rejected with IDEMPOTENCY_CONFLICT", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = new StaffInvitationService(pool);
    const key = idempotencyKey();
    await service.createInvitation({ identity: admin, email: "first-payload@example.org", idempotencyKey: key });

    await expect(
      service.createInvitation({ identity: admin, email: "different-payload@example.org", idempotencyKey: key }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("a roster addStudent replay with the same Idempotency-Key does not create a second enrollment", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = new RosterManagementService(pool);
    const key = idempotencyKey();
    const first = await service.addStudent({
      identity: admin,
      classId: fixture.classId,
      mode: "NEW",
      studentPublicId: undefined,
      accessAlias: "ReplayStudent",
      pin: undefined,
      idempotencyKey: key,
    });
    const second = await service.addStudent({
      identity: admin,
      classId: fixture.classId,
      mode: "NEW",
      studentPublicId: undefined,
      accessAlias: "ReplayStudent",
      pin: undefined,
      idempotencyKey: key,
    });
    expect(second.studentProfileId).toBe(first.studentProfileId);
    const countRow = await pool.query(`SELECT count(*)::int AS n FROM school_enrollment WHERE student_profile_id = $1`, [first.studentProfileId]);
    expect(countRow.rows[0]!.n).toBe(1);
  });
});

describe("Secret redaction in the idempotency-record replay cache (02_35 §11bis.3/§11bis.7)", () => {
  beforeEach(truncateAll);

  it("the invitation acceptance token is never persisted in idempotency_record.response_json", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = new StaffInvitationService(pool);
    const created = await service.createInvitation({ identity: admin, email: "redacted-token@example.org", idempotencyKey: idempotencyKey() });

    const row = await pool.query<{ response_json: Record<string, unknown> }>(
      `SELECT response_json FROM idempotency_record WHERE scope = 'staff_invitation_create' AND tenant_id = $1`,
      [fixture.tenantId],
    );
    expect(row.rows).toHaveLength(1);
    const stored = JSON.stringify(row.rows[0]!.response_json);
    expect(stored).not.toContain(created.acceptanceToken);
    expect(row.rows[0]!.response_json["acceptanceToken"]).toBe("[REDACTED]");
  });

  it("the student PIN is never persisted in idempotency_record.response_json", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = new RosterManagementService(pool);
    const created = await service.addStudent({
      identity: admin,
      classId: fixture.classId,
      mode: "NEW",
      studentPublicId: undefined,
      accessAlias: "PinSecrecy",
      pin: undefined,
      idempotencyKey: idempotencyKey(),
    });

    const row = await pool.query<{ response_json: Record<string, unknown> }>(
      `SELECT response_json FROM idempotency_record WHERE scope = 'staff_roster_add' AND tenant_id = $1`,
      [fixture.tenantId],
    );
    expect(row.rows).toHaveLength(1);
    expect(created.pin).toBeTruthy();
    const stored = JSON.stringify(row.rows[0]!.response_json);
    expect(stored).not.toContain(created.pin as string);
    expect(row.rows[0]!.response_json["pin"]).toBe("[REDACTED]");
  });
});

describe("Content and enrollment integrity guards (02_35 v1.2 §11bis.7-9)", () => {
  beforeEach(truncateAll);

  it("assigning content from a non-PUBLISHED (DRAFT) content bundle is rejected with ASSIGNMENT_CONTENT_NOT_PUBLISHED", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = new GeneralAssignmentService(pool);
    await expect(
      service.create({
        identity: admin,
        classId: fixture.classId,
        contentBundleId: fixture.draftContentBundleId,
        title: "Unpublished assignment attempt",
        allowedRuntimeChannels: ["WEB"],
        opensAt: null,
        dueAt: null,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_CONTENT_NOT_PUBLISHED" });
  });

  it("enrolling the same access alias twice in the same class is rejected with STUDENT_ALREADY_ENROLLED", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const service = new RosterManagementService(pool);
    await service.addStudent({
      identity: admin,
      classId: fixture.classId,
      mode: "NEW",
      studentPublicId: undefined,
      accessAlias: "Duplicate",
      pin: undefined,
      idempotencyKey: idempotencyKey(),
    });
    await expect(
      service.addStudent({
        identity: admin,
        classId: fixture.classId,
        mode: "NEW",
        studentPublicId: undefined,
        accessAlias: "Duplicate",
        pin: undefined,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STUDENT_ALREADY_ENROLLED" });
  });

  it("assigning a TEACHER whose membership is not ACTIVE to a class is rejected with TEACHER_MEMBERSHIP_NOT_ACTIVE", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const suspendedTeacherAccountId = await createStaffAccount(`suspended-membership-${rnd()}@example.org`);
    const suspendedMembershipId = await createMembership(suspendedTeacherAccountId, fixture.tenantId, "TEACHER", "SUSPENDED");
    const service = newSchoolClassManagementService();
    await expect(
      service.assignTeacher({
        identity: admin,
        classId: fixture.classId,
        staffTenantMembershipId: suspendedMembershipId,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "TEACHER_MEMBERSHIP_NOT_ACTIVE" });
  });
});
