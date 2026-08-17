import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { StaffInternalIdentity, StaffRole } from "@quest-city-web/staff-identity";
import { TenantContextService } from "@quest-city-web/convergence";
import {
  SupportAssignmentService,
  SupportEventService,
  ObservationService,
  FacilitationService,
  FacilitationProposalService,
  DifficultyOverrideRepository,
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

/** Class-roster enrollment -- required for a TEACHER's reviewable-student resolution (resolveReviewableStudentProfileIds iterates school_enrollment, not support_student_assignment). */
async function enrollStudent(tenantId: string, classId: string, studentProfileId: string): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
       VALUES ($1, $2, $3, $4, $4, 'x', 'ACTIVE') RETURNING id`,
      [tenantId, classId, studentProfileId, `alias_${rnd()}`],
    )
  ).rows[0]!.id;
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

  describe("REVIEW_DERIVED_STUDENT_DIFFICULTY_AUTHORITY (02_39 v1.3 §11bis) -- negative and boundary cases", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("Reviewer priority: when an assigned SUPPORT_TEACHER exists, the class TEACHER never becomes reviewer for that student's DIFFICULTY proposal (DENY)", async () => {
      const fixture = await buildFixture();
      const admin = await buildSchoolAdmin(fixture.tenantId);
      const asacom = await buildAsacom(fixture.tenantId);
      const supportTeacher = await buildSupportTeacher(fixture.tenantId);
      const teacher = await buildTeacher(fixture.tenantId, [fixture.classId]);
      await enrollStudent(fixture.tenantId, fixture.classId, fixture.studentProfileId);
      await assignSupport(admin, asacom.staffTenantMembershipId, fixture.studentPublicId);
      await assignSupport(admin, supportTeacher.staffTenantMembershipId, fixture.studentPublicId);
      const proposalService = new FacilitationProposalService(pool);

      const proposal = await proposalService.create({
        identity: asacom,
        studentPublicId: fixture.studentPublicId,
        proposalType: "DIFFICULTY",
        targetCategory: "mathematics",
        idempotencyKey: idempotencyKey(),
      });

      // The student IS on the TEACHER's class roster (enrolled above) --
      // absent from their queue specifically because of SUPPORT_TEACHER
      // priority, not merely because they were never on the roster.
      const teacherQueue = await proposalService.myReviewQueue(teacher, "SUBMITTED", { limit: 50, offset: 0 });
      expect(teacherQueue.some((p) => p.id === proposal.id)).toBe(false);

      await expect(
        proposalService.review({ identity: teacher, id: proposal.publicId, decision: "ACCEPT", ifMatchVersion: proposal.version, idempotencyKey: idempotencyKey() }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      const overrideRows = await pool.query(`SELECT id FROM difficulty_override WHERE student_profile_id = $1`, [fixture.studentProfileId]);
      expect(overrideRows.rows).toHaveLength(0);

      // The assigned SUPPORT_TEACHER remains the correct reviewer.
      const supportTeacherQueue = await proposalService.myReviewQueue(supportTeacher, "SUBMITTED", { limit: 50, offset: 0 });
      expect(supportTeacherQueue.some((p) => p.id === proposal.id)).toBe(true);
    });

    it("TEACHER cannot create a per-student difficulty override via the direct-apply endpoint (role gate unaffected by the relaxed DB CHECK): DENY", async () => {
      const fixture = await buildFixture();
      const teacher = await buildTeacher(fixture.tenantId, [fixture.classId]);
      await expect(
        new FacilitationService(pool).supportTeacherCreateDifficultyOverride({
          identity: teacher,
          studentPublicId: fixture.studentPublicId,
          targetRef: "mathematics",
          reason: "attempted direct bypass outside the review workflow",
          idempotencyKey: idempotencyKey(),
        }),
      ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });

      const overrideRows = await pool.query(`SELECT id FROM difficulty_override WHERE student_profile_id = $1`, [fixture.studentProfileId]);
      expect(overrideRows.rows).toHaveLength(0);
    });

    it("ASACOM can never review a DIFFICULTY proposal, even one it did not author itself (DENY, never a reviewer)", async () => {
      const fixture = await buildFixture();
      const admin = await buildSchoolAdmin(fixture.tenantId);
      const asacom = await buildAsacom(fixture.tenantId);
      const supportTeacher = await buildSupportTeacher(fixture.tenantId);
      // SUPPORT_TEACHER proposes for a student it is NOT itself assigned
      // to (own-assigned students get direct apply instead, §11).
      await assignSupport(admin, asacom.staffTenantMembershipId, fixture.unassignedStudentPublicId);
      const proposalService = new FacilitationProposalService(pool);
      const proposal = await proposalService.create({
        identity: supportTeacher,
        studentPublicId: fixture.unassignedStudentPublicId,
        proposalType: "DIFFICULTY",
        targetCategory: "mathematics",
        idempotencyKey: idempotencyKey(),
      });

      await expect(
        proposalService.review({ identity: asacom, id: proposal.publicId, decision: "ACCEPT", ifMatchVersion: proposal.version, idempotencyKey: idempotencyKey() }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      const overrideRows = await pool.query(`SELECT id FROM difficulty_override WHERE student_profile_id = $1`, [fixture.unassignedStudentProfileId]);
      expect(overrideRows.rows).toHaveLength(0);
    });

    it("TEACHER outside the proposal's class scope cannot become its reviewer (DENY, no override created)", async () => {
      const fixture = await buildFixture();
      const admin = await buildSchoolAdmin(fixture.tenantId);
      const asacom = await buildAsacom(fixture.tenantId);
      // The student is enrolled in fixture.classId -- this TEACHER is
      // scoped to otherClassId instead, NOT the class the student is
      // actually in.
      const outOfScopeTeacher = await buildTeacher(fixture.tenantId, [fixture.otherClassId]);
      await enrollStudent(fixture.tenantId, fixture.classId, fixture.studentProfileId);
      await assignSupport(admin, asacom.staffTenantMembershipId, fixture.studentPublicId);
      const proposalService = new FacilitationProposalService(pool);
      const proposal = await proposalService.create({
        identity: asacom,
        studentPublicId: fixture.studentPublicId,
        proposalType: "DIFFICULTY",
        targetCategory: "mathematics",
        idempotencyKey: idempotencyKey(),
      });

      await expect(
        proposalService.review({
          identity: outOfScopeTeacher,
          id: proposal.publicId,
          decision: "ACCEPT",
          ifMatchVersion: proposal.version,
          idempotencyKey: idempotencyKey(),
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      const overrideRows = await pool.query(`SELECT id FROM difficulty_override WHERE student_profile_id = $1`, [fixture.studentProfileId]);
      expect(overrideRows.rows).toHaveLength(0);
    });

    it("Stale version (concurrent modification): ACCEPT with an outdated ifMatchVersion is rejected and creates no difficulty_override", async () => {
      const fixture = await buildFixture();
      const admin = await buildSchoolAdmin(fixture.tenantId);
      const asacom = await buildAsacom(fixture.tenantId);
      const teacher = await buildTeacher(fixture.tenantId, [fixture.classId]);
      await enrollStudent(fixture.tenantId, fixture.classId, fixture.studentProfileId);
      await assignSupport(admin, asacom.staffTenantMembershipId, fixture.studentPublicId);
      const proposalService = new FacilitationProposalService(pool);
      const proposal = await proposalService.create({
        identity: asacom,
        studentPublicId: fixture.studentPublicId,
        proposalType: "DIFFICULTY",
        targetCategory: "mathematics",
        idempotencyKey: idempotencyKey(),
      });

      await expect(
        proposalService.review({
          identity: teacher,
          id: proposal.publicId,
          decision: "ACCEPT",
          ifMatchVersion: proposal.version + 999,
          idempotencyKey: idempotencyKey(),
        }),
      ).rejects.toMatchObject({ code: "ETAG_MISMATCH" });

      const overrideRows = await pool.query(`SELECT id FROM difficulty_override WHERE student_profile_id = $1`, [fixture.studentProfileId]);
      expect(overrideRows.rows).toHaveLength(0);
      const current = await proposalService.myReviewQueue(teacher, "SUBMITTED", { limit: 50, offset: 0 });
      expect(current.some((p) => p.id === proposal.id)).toBe(true);
    });

    it("Atomicity: if the difficulty_override write fails, the proposal stays SUBMITTED and no override row is created (transaction rollback, 02_26 v1.18 §37.7bis)", async () => {
      const fixture = await buildFixture();
      const admin = await buildSchoolAdmin(fixture.tenantId);
      const asacom = await buildAsacom(fixture.tenantId);
      const teacher = await buildTeacher(fixture.tenantId, [fixture.classId]);
      await enrollStudent(fixture.tenantId, fixture.classId, fixture.studentProfileId);
      await assignSupport(admin, asacom.staffTenantMembershipId, fixture.studentPublicId);
      const proposalService = new FacilitationProposalService(pool);
      const proposal = await proposalService.create({
        identity: asacom,
        studentPublicId: fixture.studentPublicId,
        proposalType: "DIFFICULTY",
        targetCategory: "mathematics",
        idempotencyKey: idempotencyKey(),
      });

      const injectedFailure = new Error("SIMULATED_DIFFICULTY_OVERRIDE_WRITE_FAILURE");
      vi.spyOn(DifficultyOverrideRepository.prototype, "createForStudent").mockRejectedValueOnce(injectedFailure);

      await expect(
        proposalService.review({ identity: teacher, id: proposal.publicId, decision: "ACCEPT", ifMatchVersion: proposal.version, idempotencyKey: idempotencyKey() }),
      ).rejects.toThrow(injectedFailure.message);

      // The state transition rolled back along with the failed write --
      // never a silently ACCEPTED proposal without its effect.
      const persisted = await pool.query<{ status: string; version: number }>(`SELECT status, version FROM facilitation_proposal WHERE id = $1`, [proposal.id]);
      expect(persisted.rows[0]!.status).toBe("SUBMITTED");
      expect(persisted.rows[0]!.version).toBe(proposal.version);

      const overrideRows = await pool.query(`SELECT id FROM difficulty_override WHERE student_profile_id = $1`, [fixture.studentProfileId]);
      expect(overrideRows.rows).toHaveLength(0);

      // A subsequent legitimate retry (new Idempotency-Key, mock cleared)
      // succeeds normally -- the earlier failure left no permanent
      // corruption.
      const retried = await proposalService.review({
        identity: teacher,
        id: proposal.publicId,
        decision: "ACCEPT",
        ifMatchVersion: proposal.version,
        idempotencyKey: idempotencyKey(),
      });
      expect(retried.status).toBe("ACCEPTED");
      const overrideRowsAfterRetry = await pool.query(`SELECT id FROM difficulty_override WHERE student_profile_id = $1`, [fixture.studentProfileId]);
      expect(overrideRowsAfterRetry.rows).toHaveLength(1);
    });
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
