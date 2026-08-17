import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { StaffInternalIdentity, StaffRole } from "@quest-city-web/staff-identity";
import { TenantContextService } from "@quest-city-web/convergence";
import {
  SupportAssignmentService,
  SupportEventService,
  ObservationService,
  FacilitationService,
  FacilitationProposalService,
} from "@quest-city-web/student-support";

/**
 * Student Support Roles security suite (02_39 v1.2 §6bis/§11quinquies.4/
 * §11sexies.4/§25-27, migration 0012) -- every DENY scenario named
 * explicitly in the governing instruction §38, against a real,
 * dockerized PostgreSQL instance.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- student-support-roles-security
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";
const pool = new Pool({ connectionString: DATABASE_URL });

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
  studentProfileId: string;
  studentPublicId: string;
  otherTenantStudentProfileId: string;
  otherTenantStudentPublicId: string;
  unassignedStudentProfileId: string;
  unassignedStudentPublicId: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    `TRUNCATE facilitation_proposal, difficulty_override, support_profile, learning_support_observation,
              learning_support_event, support_student_assignment,
              staff_invitation, staff_class_assignment, staff_session, staff_tenant_membership, staff_account,
              idempotency_record, semantic_action_log, attempt_response, learning_attempt,
              assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle,
              school_enrollment, class_access_code, school_class, student_profile, student_session,
              rate_limit_bucket, audit_event, tenant CASCADE`,
  );
}

async function insertStudent(tenantId: string): Promise<{ id: string; publicId: string }> {
  const publicId = `stu_${rnd()}`;
  const id = (
    await pool.query<{ id: string }>(`INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [
      tenantId,
      publicId,
    ])
  ).rows[0]!.id;
  return { id, publicId };
}

async function buildFixture(): Promise<Fixture> {
  const tenantId = (
    await pool.query<{ id: string }>(`INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`, [
      `sch_${rnd()}`,
    ])
  ).rows[0]!.id;
  const otherTenantId = (
    await pool.query<{ id: string }>(`INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Other School') RETURNING id`, [
      `sch_${rnd()}`,
    ])
  ).rows[0]!.id;
  const classId = (
    await pool.query<{ id: string }>(`INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Test Class', 'ACTIVE') RETURNING id`, [
      tenantId,
      `cls_${rnd()}`,
    ])
  ).rows[0]!.id;
  const otherClassId = (
    await pool.query<{ id: string }>(`INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Other Class', 'ACTIVE') RETURNING id`, [
      tenantId,
      `cls_${rnd()}`,
    ])
  ).rows[0]!.id;

  const student = await insertStudent(tenantId);
  const otherTenantStudent = await insertStudent(otherTenantId);
  const unassignedStudent = await insertStudent(tenantId);

  return {
    tenantId,
    otherTenantId,
    classId,
    otherClassId,
    studentProfileId: student.id,
    studentPublicId: student.publicId,
    otherTenantStudentProfileId: otherTenantStudent.id,
    otherTenantStudentPublicId: otherTenantStudent.publicId,
    unassignedStudentProfileId: unassignedStudent.id,
    unassignedStudentPublicId: unassignedStudent.publicId,
  };
}

async function createStaffAccount(email: string): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, 'x', 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      [email],
    )
  ).rows[0]!.id;
}

async function createMembership(staffAccountId: string, tenantId: string, role: StaffRole): Promise<string> {
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
  role: StaffRole;
  classScope: string[] | null;
}): StaffInternalIdentity {
  return { ...overrides, csrfTokenHash: "unused-in-these-tests", sessionId: "session-unused-in-these-tests" };
}

async function buildAsacom(tenantId: string): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`asacom-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, tenantId, "ASACOM");
  return identity({ staffAccountId: accountId, tenantId, staffTenantMembershipId: membershipId, role: "ASACOM", classScope: null });
}

async function buildSupportTeacher(tenantId: string, classScope: string[] = []): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`support-teacher-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, tenantId, "SUPPORT_TEACHER");
  for (const classId of classScope) {
    await pool.query(`INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`, [
      membershipId,
      tenantId,
      classId,
    ]);
  }
  return identity({ staffAccountId: accountId, tenantId, staffTenantMembershipId: membershipId, role: "SUPPORT_TEACHER", classScope });
}

async function buildSchoolAdmin(tenantId: string): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`admin-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, tenantId, "SCHOOL_ADMIN");
  return identity({ staffAccountId: accountId, tenantId, staffTenantMembershipId: membershipId, role: "SCHOOL_ADMIN", classScope: null });
}

async function assignSupport(admin: StaffInternalIdentity, targetMembershipId: string, studentPublicId: string): Promise<void> {
  await new SupportAssignmentService(pool).create({
    identity: admin,
    staffTenantMembershipId: targetMembershipId,
    studentPublicId,
    idempotencyKey: idempotencyKey(),
  });
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("Student Support Roles -- security (02_39 v1.2 §38)", () => {
  beforeEach(truncateAll);

  it("ASACOM -> unrelated (unassigned) student: DENY (SUPPORT_STUDENT_NOT_ASSIGNED)", async () => {
    const fixture = await buildFixture();
    const asacom = await buildAsacom(fixture.tenantId);
    await expect(new ObservationService(pool).listByStudent(asacom, fixture.unassignedStudentPublicId, { includeSuperseded: false }, { limit: 50, offset: 0 })).rejects.toMatchObject({
      code: "SUPPORT_STUDENT_NOT_ASSIGNED",
    });
  });

  it("SUPPORT_TEACHER -> unrelated student (no assignment, no class access): DENY (SUPPORT_STUDENT_NOT_ASSIGNED)", async () => {
    const fixture = await buildFixture();
    const supportTeacher = await buildSupportTeacher(fixture.tenantId, []);
    await expect(
      new SupportEventService(pool).listByStudent(supportTeacher, fixture.unassignedStudentPublicId, { limit: 50, offset: 0 }),
    ).rejects.toMatchObject({ code: "SUPPORT_STUDENT_NOT_ASSIGNED" });
  });

  it("SUPPORT_TEACHER class-wide access does not extend to a student outside supported/class scope (observation requires the per-student assignment specifically)", async () => {
    const fixture = await buildFixture();
    const supportTeacher = await buildSupportTeacher(fixture.tenantId, [fixture.classId]);
    // Even with class access, observations require the per-student support_student_assignment (02_39 §10) -- class access alone is not sufficient.
    await expect(
      new ObservationService(pool).create({ identity: supportTeacher, studentPublicId: fixture.studentPublicId, idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "SUPPORT_STUDENT_NOT_ASSIGNED" });
  });

  it("ASACOM -> permanent (PROFILE_LEVEL) facilitation: DENY", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture.tenantId);
    const asacom = await buildAsacom(fixture.tenantId);
    await assignSupport(admin, asacom.staffTenantMembershipId, fixture.studentPublicId);
    const facilitationService = new FacilitationService(pool);
    // ASACOM has no supportTeacherApply-equivalent method reachable -- the
    // service itself rejects any non-SUPPORT_TEACHER identity outright.
    await expect(
      facilitationService.supportTeacherApply({
        identity: asacom,
        studentPublicId: fixture.studentPublicId,
        category: "PRESENTATION",
        level: "PROFILE_LEVEL",
        configJson: {},
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("ASACOM -> persistent facilitation via apply-temporary path with a non-TOOLS category: DENY (FACILITATION_NOT_ALLOWED)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture.tenantId);
    const asacom = await buildAsacom(fixture.tenantId);
    await assignSupport(admin, asacom.staffTenantMembershipId, fixture.studentPublicId);
    await expect(
      new FacilitationService(pool).asacomApplyTemporary({ identity: asacom, studentPublicId: fixture.studentPublicId, category: "PRESENTATION", configJson: {} }),
    ).rejects.toMatchObject({ code: "FACILITATION_NOT_ALLOWED" });
  });

  it("ASACOM cannot create a per-student difficulty override (role gate): DENY", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture.tenantId);
    const asacom = await buildAsacom(fixture.tenantId);
    await assignSupport(admin, asacom.staffTenantMembershipId, fixture.studentPublicId);
    await expect(
      new FacilitationService(pool).supportTeacherCreateDifficultyOverride({
        identity: asacom,
        studentPublicId: fixture.studentPublicId,
        targetRef: "mathematics",
        reason: "attempted bypass",
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("Self-approval: the proposer cannot review their own facilitation_proposal (DENY, STAFF_FORBIDDEN)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture.tenantId);
    const asacom = await buildAsacom(fixture.tenantId);
    await assignSupport(admin, asacom.staffTenantMembershipId, fixture.studentPublicId);
    const proposalService = new FacilitationProposalService(pool);
    const proposal = await proposalService.create({
      identity: asacom,
      studentPublicId: fixture.studentPublicId,
      proposalType: "FACILITATION",
      targetCategory: "TOOLS",
      idempotencyKey: idempotencyKey(),
    });

    await expect(
      proposalService.review({ identity: asacom, id: proposal.publicId, decision: "ACCEPT", ifMatchVersion: proposal.version, idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("Self-authored proposal never appears in the author's own review queue (anti-self-approval applied at read time too)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture.tenantId);
    // ASACOM is the proposer (never has direct apply authority, always
    // proposes -- unlike SUPPORT_TEACHER, which would be rejected by
    // create() itself for a student it's already directly assigned to,
    // 02_39 §11). A SUPPORT_TEACHER assigned to the same student is the
    // reviewer.
    const asacom = await buildAsacom(fixture.tenantId);
    const supportTeacher = await buildSupportTeacher(fixture.tenantId);
    await assignSupport(admin, asacom.staffTenantMembershipId, fixture.unassignedStudentPublicId);
    await assignSupport(admin, supportTeacher.staffTenantMembershipId, fixture.unassignedStudentPublicId);
    const proposalService = new FacilitationProposalService(pool);

    const proposal = await proposalService.create({
      identity: asacom,
      studentPublicId: fixture.unassignedStudentPublicId,
      proposalType: "FACILITATION",
      targetCategory: "TOOLS",
      idempotencyKey: idempotencyKey(),
    });

    // ASACOM never reviews at all (DENY, §39) -- myReviewQueue resolves
    // an empty reviewable-student set for ASACOM, so the proposal is
    // absent from its own "queue" for that reason too, not only
    // anti-self-approval; both invariants hold simultaneously here.
    const ownQueue = await proposalService.myReviewQueue(asacom, "SUBMITTED", { limit: 50, offset: 0 });
    expect(ownQueue.some((p) => p.id === proposal.id)).toBe(false);

    const reviewerQueue = await proposalService.myReviewQueue(supportTeacher, "SUBMITTED", { limit: 50, offset: 0 });
    expect(reviewerQueue.some((p) => p.id === proposal.id)).toBe(true);
  });

  it("Cross-tenant: ASACOM of tenant A cannot access a student of tenant B, even with the correct studentPublicId (DENY, anti-enumeration)", async () => {
    const fixture = await buildFixture();
    const asacom = await buildAsacom(fixture.tenantId);
    await expect(
      new SupportEventService(pool).listByStudent(asacom, fixture.otherTenantStudentPublicId, { limit: 50, offset: 0 }),
    ).rejects.toMatchObject({ code: "SUPPORT_STUDENT_NOT_ASSIGNED" });
  });

  it("Inactive (ENDED) support_student_assignment: DENY (SUPPORT_STUDENT_NOT_ASSIGNED, not a stale grant)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture.tenantId);
    const asacom = await buildAsacom(fixture.tenantId);
    const assignmentService = new SupportAssignmentService(pool);
    const created = await assignSupportReturning(assignmentService, admin, asacom.staffTenantMembershipId, fixture.studentPublicId);
    await assignmentService.transitionStatus({ identity: admin, id: created.publicId, targetStatus: "ENDED" });

    await expect(
      new SupportEventService(pool).listByStudent(asacom, fixture.studentPublicId, { limit: 50, offset: 0 }),
    ).rejects.toMatchObject({ code: "SUPPORT_STUDENT_NOT_ASSIGNED" });
  });

  it("Ambiguous same-tenant membership: switch-tenant with only tenantId when two ACTIVE memberships exist -> 409 AMBIGUOUS_TENANT_MEMBERSHIP", async () => {
    const fixture = await buildFixture();
    const accountId = await createStaffAccount(`multi-${rnd()}@example.org`);
    const teacherMembershipId = await createMembership(accountId, fixture.tenantId, "TEACHER");
    await createMembership(accountId, fixture.tenantId, "SUPPORT_TEACHER");
    const teacherIdentity = identity({ staffAccountId: accountId, tenantId: fixture.tenantId, staffTenantMembershipId: teacherMembershipId, role: "TEACHER", classScope: [] });

    await expect(new TenantContextService(pool).switchTenant(teacherIdentity, fixture.tenantId)).rejects.toMatchObject({
      code: "AMBIGUOUS_TENANT_MEMBERSHIP",
    });
  });

  it("No existence leak: a non-existent studentPublicId and an existing-but-unassigned studentPublicId produce the identical error code", async () => {
    const fixture = await buildFixture();
    const asacom = await buildAsacom(fixture.tenantId);
    const service = new SupportEventService(pool);

    const nonExistentResult = await service.listByStudent(asacom, `stu_${rnd()}_never_created`, { limit: 50, offset: 0 }).catch((e) => e);
    const unassignedResult = await service.listByStudent(asacom, fixture.unassignedStudentPublicId, { limit: 50, offset: 0 }).catch((e) => e);

    expect(nonExistentResult.code).toBe("SUPPORT_STUDENT_NOT_ASSIGNED");
    expect(unassignedResult.code).toBe("SUPPORT_STUDENT_NOT_ASSIGNED");
    expect(nonExistentResult.code).toBe(unassignedResult.code);
  });
});

async function assignSupportReturning(
  service: SupportAssignmentService,
  admin: StaffInternalIdentity,
  targetMembershipId: string,
  studentPublicId: string,
) {
  return service.create({ identity: admin, staffTenantMembershipId: targetMembershipId, studentPublicId, idempotencyKey: idempotencyKey() });
}
