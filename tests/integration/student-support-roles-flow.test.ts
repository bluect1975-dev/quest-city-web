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
 * Student Support Roles (SUPPORT_TEACHER + ASACOM) functional integration
 * suite (02_25 v1.12 §6.16, 02_35 v1.7 §11quinquies/§11sexies, 02_39 v1.2,
 * migration 0012) against a real, dockerized PostgreSQL instance.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- student-support-roles-flow
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
  classId: string;
  studentProfileId: string;
  studentPublicId: string;
  contentBundleId: string;
  assignmentId: string;
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
  const studentPublicId = `stu_${rnd()}`;
  const studentProfileId = (
    await pool.query<{ id: string }>(
      `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [tenantId, studentPublicId],
    )
  ).rows[0]!.id;
  const contentBundleId = (
    await pool.query<{ id: string }>(
      `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref)
       VALUES ($1, 'MAT', '1.0.0', 'RUNTIME_FIXTURE_BUNDLE', 'PUBLISHED', 'sha256:abc', 's3://x') RETURNING id`,
      [`bnd_${rnd()}`],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [contentBundleId]);
  const assignmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
       VALUES ($1, $2, $3, 'Test Assignment', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
      [tenantId, classId, `asn_${rnd()}`, contentBundleId],
    )
  ).rows[0]!.id;

  return { tenantId, classId, studentProfileId, studentPublicId, contentBundleId, assignmentId };
}

async function enrollStudent(fixture: Fixture): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
       VALUES ($1, $2, $3, $4, $4, 'x', 'ACTIVE') RETURNING id`,
      [fixture.tenantId, fixture.classId, fixture.studentProfileId, `alias_${rnd()}`],
    )
  ).rows[0]!.id;
}

async function createLearningAttempt(fixture: Fixture, state: "IN_PROGRESS" | "COMPLETED" = "IN_PROGRESS"): Promise<string> {
  const enrollmentId = await enrollStudent(fixture);
  const contentId = (
    await pool.query<{ content_id: string; content_version: string }>(
      `SELECT gen_random_uuid() AS content_id, '1.0.0' AS content_version`,
    )
  ).rows[0]!;
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO learning_attempt
         (tenant_id, event_id, assignment_id, student_profile_id, enrollment_id, content_bundle_id, content_id, content_version,
          attempt_state, runtime_channel, creation_idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'WEB', $10) RETURNING id`,
      [
        fixture.tenantId,
        `evt_${rnd()}`,
        fixture.assignmentId,
        fixture.studentProfileId,
        enrollmentId,
        fixture.contentBundleId,
        contentId.content_id,
        contentId.content_version,
        state,
        `ck_${rnd()}`,
      ],
    )
  ).rows[0]!.id;
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

async function buildSchoolAdmin(fixture: Fixture): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`admin-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");
  return identity({ staffAccountId: accountId, tenantId: fixture.tenantId, staffTenantMembershipId: membershipId, role: "SCHOOL_ADMIN", classScope: null });
}

async function buildAsacom(fixture: Fixture): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`asacom-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, fixture.tenantId, "ASACOM");
  return identity({ staffAccountId: accountId, tenantId: fixture.tenantId, staffTenantMembershipId: membershipId, role: "ASACOM", classScope: null });
}

async function buildSupportTeacher(fixture: Fixture, classScope: string[] = []): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`support-teacher-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, fixture.tenantId, "SUPPORT_TEACHER");
  for (const classId of classScope) {
    await pool.query(`INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`, [
      membershipId,
      fixture.tenantId,
      classId,
    ]);
  }
  return identity({ staffAccountId: accountId, tenantId: fixture.tenantId, staffTenantMembershipId: membershipId, role: "SUPPORT_TEACHER", classScope });
}

async function buildTeacher(fixture: Fixture, classScope: string[]): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`teacher-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, fixture.tenantId, "TEACHER");
  for (const classId of classScope) {
    await pool.query(`INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`, [
      membershipId,
      fixture.tenantId,
      classId,
    ]);
  }
  return identity({ staffAccountId: accountId, tenantId: fixture.tenantId, staffTenantMembershipId: membershipId, role: "TEACHER", classScope });
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("Student Support Roles -- functional flows (02_39 v1.2)", () => {
  beforeEach(truncateAll);

  it("SCHOOL_ADMIN creates a support_student_assignment for an ASACOM membership", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const asacom = await buildAsacom(fixture);
    const service = new SupportAssignmentService(pool);

    const created = await service.create({
      identity: admin,
      staffTenantMembershipId: asacom.staffTenantMembershipId,
      studentPublicId: fixture.studentPublicId,
      idempotencyKey: idempotencyKey(),
    });

    expect(created.status).toBe("ACTIVE");
    expect(created.studentProfileId).toBe(fixture.studentProfileId);
  });

  it("ASACOM login -> assigned students only (GET /me/asacom-assigned-students equivalent)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const asacom = await buildAsacom(fixture);
    const assignmentService = new SupportAssignmentService(pool);
    await assignmentService.create({
      identity: admin,
      staffTenantMembershipId: asacom.staffTenantMembershipId,
      studentPublicId: fixture.studentPublicId,
      idempotencyKey: idempotencyKey(),
    });

    const mine = await assignmentService.listMine(asacom);
    expect(mine).toHaveLength(1);
    // listMine() resolves studentProfileId to the client-facing
    // studentPublicId -- never the raw internal UUID (never leaked to a caller).
    expect(mine[0]!.studentProfileId).toBe(fixture.studentPublicId);
  });

  it("SUPPORT_TEACHER login -> classes + supported students as contracted", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const supportTeacher = await buildSupportTeacher(fixture, [fixture.classId]);
    expect(supportTeacher.classScope).toEqual([fixture.classId]);

    const assignmentService = new SupportAssignmentService(pool);
    await assignmentService.create({
      identity: admin,
      staffTenantMembershipId: supportTeacher.staffTenantMembershipId,
      studentPublicId: fixture.studentPublicId,
      idempotencyKey: idempotencyKey(),
    });
    const mine = await assignmentService.listMine(supportTeacher);
    expect(mine).toHaveLength(1);
  });

  it("Support event creation/read (ASACOM, own assigned student)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const asacom = await buildAsacom(fixture);
    await new SupportAssignmentService(pool).create({
      identity: admin,
      staffTenantMembershipId: asacom.staffTenantMembershipId,
      studentPublicId: fixture.studentPublicId,
      idempotencyKey: idempotencyKey(),
    });
    const attemptId = await createLearningAttempt(fixture);
    const eventService = new SupportEventService(pool);

    const created = await eventService.create({
      identity: asacom,
      studentPublicId: fixture.studentPublicId,
      learningAttemptId: attemptId,
      supportType: "COMMUNICATION_SUPPORT",
      intensity: "MODERATE",
      idempotencyKey: idempotencyKey(),
    });
    expect(created.actorRole).toBe("ASACOM");

    const list = await eventService.listByStudent(asacom, fixture.studentPublicId, { limit: 50, offset: 0 });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);
  });

  it("Observation create/read/supersede (SUPPORT_TEACHER)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const supportTeacher = await buildSupportTeacher(fixture);
    await new SupportAssignmentService(pool).create({
      identity: admin,
      staffTenantMembershipId: supportTeacher.staffTenantMembershipId,
      studentPublicId: fixture.studentPublicId,
      idempotencyKey: idempotencyKey(),
    });
    const observationService = new ObservationService(pool);

    const original = await observationService.create({
      identity: supportTeacher,
      studentPublicId: fixture.studentPublicId,
      category: "ATTENTION_SUPPORT",
      idempotencyKey: idempotencyKey(),
    });

    const superseding = await observationService.supersede({
      identity: supportTeacher,
      // Realistic API-shape: a caller only ever knows the public_id (the
      // route param), never the raw internal UUID -- this is exactly the
      // parameter this test caught passing wrong before the fix.
      originalId: original.publicId,
      category: "ATTENTION_SUPPORT",
      idempotencyKey: idempotencyKey(),
    });

    const history = await observationService.listByStudent(supportTeacher, fixture.studentPublicId, { includeSuperseded: true }, { limit: 50, offset: 0 });
    expect(history).toHaveLength(2);
    const originalEntry = history.find((h) => h.id === original.id)!;
    const supersedingEntry = history.find((h) => h.id === superseding.id)!;
    expect(originalEntry.historyStatus).toBe("SUPERSEDED");
    expect(originalEntry.supersededById).toBe(superseding.id);
    expect(supersedingEntry.historyStatus).toBe("CURRENT");
    expect(supersedingEntry.supersedesId).toBe(original.id);

    const currentOnly = await observationService.listByStudent(supportTeacher, fixture.studentPublicId, { includeSuperseded: false }, { limit: 50, offset: 0 });
    expect(currentOnly).toHaveLength(1);
    expect(currentOnly[0]!.id).toBe(superseding.id);
  });

  it("Facilitation temporary apply (ASACOM, TOOLS/SESSION_ONLY) and persistent apply (SUPPORT_TEACHER, PROFILE_LEVEL) authority", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const asacom = await buildAsacom(fixture);
    const supportTeacher = await buildSupportTeacher(fixture);
    const assignmentService = new SupportAssignmentService(pool);
    await assignmentService.create({ identity: admin, staffTenantMembershipId: asacom.staffTenantMembershipId, studentPublicId: fixture.studentPublicId, idempotencyKey: idempotencyKey() });
    await assignmentService.create({ identity: admin, staffTenantMembershipId: supportTeacher.staffTenantMembershipId, studentPublicId: fixture.studentPublicId, idempotencyKey: idempotencyKey() });
    const facilitationService = new FacilitationService(pool);

    const temp = await facilitationService.asacomApplyTemporary({ identity: asacom, studentPublicId: fixture.studentPublicId, category: "TOOLS", configJson: {} });
    expect(temp.level).toBe("SESSION_ONLY");
    expect(temp.expiresAt).not.toBeNull();

    const persistent = await facilitationService.supportTeacherApply({
      identity: supportTeacher,
      studentPublicId: fixture.studentPublicId,
      category: "PRESENTATION",
      level: "PROFILE_LEVEL",
      configJson: {},
      idempotencyKey: idempotencyKey(),
    });
    expect(persistent.level).toBe("PROFILE_LEVEL");
    expect(persistent.expiresAt).toBeNull();

    const active = await facilitationService.readByStudent(supportTeacher, fixture.studentPublicId);
    expect(active.some((e) => e.category === "PRESENTATION" && e.level === "PROFILE_LEVEL")).toBe(true);
    expect(active.some((e) => e.category === "TOOLS" && e.level === "SESSION_ONLY")).toBe(true);
  });

  it("Difficulty override authority (SUPPORT_TEACHER, own assigned student)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const supportTeacher = await buildSupportTeacher(fixture);
    await new SupportAssignmentService(pool).create({ identity: admin, staffTenantMembershipId: supportTeacher.staffTenantMembershipId, studentPublicId: fixture.studentPublicId, idempotencyKey: idempotencyKey() });
    const facilitationService = new FacilitationService(pool);

    const created = await facilitationService.supportTeacherCreateDifficultyOverride({
      identity: supportTeacher,
      studentPublicId: fixture.studentPublicId,
      targetRef: "mathematics",
      reason: "Adattamento motivato per lo studente assegnato.",
      idempotencyKey: idempotencyKey(),
    });
    expect(created.status).toBe("ACTIVE");
    expect(created.reason.length).toBeGreaterThan(0);
  });

  it("Facilitation proposal creation, review queue discovery, and ACCEPT review by class TEACHER", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const asacom = await buildAsacom(fixture);
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    await enrollStudent(fixture);
    await new SupportAssignmentService(pool).create({ identity: admin, staffTenantMembershipId: asacom.staffTenantMembershipId, studentPublicId: fixture.studentPublicId, idempotencyKey: idempotencyKey() });
    const proposalService = new FacilitationProposalService(pool);

    const proposal = await proposalService.create({
      identity: asacom,
      studentPublicId: fixture.studentPublicId,
      proposalType: "FACILITATION",
      targetCategory: "TOOLS",
      idempotencyKey: idempotencyKey(),
    });
    expect(proposal.status).toBe("SUBMITTED");

    const queue = await proposalService.myReviewQueue(teacher, "SUBMITTED", { limit: 50, offset: 0 });
    expect(queue.some((p) => p.id === proposal.id)).toBe(true);

    const reviewed = await proposalService.review({
      identity: teacher,
      id: proposal.publicId,
      decision: "ACCEPT",
      ifMatchVersion: proposal.version,
      idempotencyKey: idempotencyKey(),
    });
    expect(reviewed.status).toBe("ACCEPTED");
    expect(reviewed.reviewedByStaffAccountId).toBe(teacher.staffAccountId);

    const facilitationService = new FacilitationService(pool);
    const active = await facilitationService.readByStudent(teacher.role === "TEACHER" ? asacom : teacher, fixture.studentPublicId);
    expect(active.some((e) => e.category === "TOOLS" && e.level === "PROFILE_LEVEL")).toBe(true);
  });

  it("DIFFICULTY proposal ACCEPT by fallback class TEACHER (no SUPPORT_TEACHER assigned) writes a per-student difficulty_override (02_39 v1.3 §11bis, REVIEW_DERIVED_STUDENT_DIFFICULTY_AUTHORITY)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const asacom = await buildAsacom(fixture);
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    await enrollStudent(fixture);
    await new SupportAssignmentService(pool).create({
      identity: admin,
      staffTenantMembershipId: asacom.staffTenantMembershipId,
      studentPublicId: fixture.studentPublicId,
      idempotencyKey: idempotencyKey(),
    });
    const proposalService = new FacilitationProposalService(pool);

    const proposal = await proposalService.create({
      identity: asacom,
      studentPublicId: fixture.studentPublicId,
      proposalType: "DIFFICULTY",
      targetCategory: "mathematics",
      idempotencyKey: idempotencyKey(),
    });
    expect(proposal.status).toBe("SUBMITTED");

    // No SUPPORT_TEACHER assigned to this student -- TEACHER is the
    // resolved (fallback) reviewer, per §6ter.
    const queue = await proposalService.myReviewQueue(teacher, "SUBMITTED", { limit: 50, offset: 0 });
    expect(queue.some((p) => p.id === proposal.id)).toBe(true);

    const reviewed = await proposalService.review({
      identity: teacher,
      id: proposal.publicId,
      decision: "ACCEPT",
      ifMatchVersion: proposal.version,
      idempotencyKey: idempotencyKey(),
    });
    expect(reviewed.status).toBe("ACCEPTED");
    expect(reviewed.reviewedByStaffAccountId).toBe(teacher.staffAccountId);

    const overrideRows = await pool.query<{
      created_by_role: string;
      created_by_staff_account_id: string;
      student_profile_id: string;
      class_id: string | null;
      tenant_id: string;
      reason: string;
      status: string;
    }>(
      `SELECT created_by_role, created_by_staff_account_id, student_profile_id, class_id, tenant_id, reason, status
       FROM difficulty_override WHERE student_profile_id = $1`,
      [fixture.studentProfileId],
    );
    expect(overrideRows.rows).toHaveLength(1);
    const row = overrideRows.rows[0]!;
    expect(row.created_by_role).toBe("TEACHER");
    expect(row.created_by_staff_account_id).toBe(teacher.staffAccountId);
    expect(row.class_id).toBeNull();
    expect(row.tenant_id).toBe(fixture.tenantId);
    expect(row.status).toBe("ACTIVE");
    // Provenance: reason references the source proposal's public_id (02_39 v1.3 §11bis).
    expect(row.reason).toContain(proposal.publicId);

    // Audit chain reconstructable: proposal -> proposer -> reviewer ->
    // decision (the override row itself carries student/tenant/reviewer;
    // the audit_event carries the review decision).
    const auditRows = await pool.query<{ actor_id: string; action: string; target_id: string; result: string }>(
      `SELECT actor_id, action, target_id, result FROM audit_event WHERE action = 'support.proposal_reviewed' AND target_id = $1`,
      [reviewed.id],
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0]!.actor_id).toBe(teacher.staffAccountId);
    expect(auditRows.rows[0]!.result).toBe("SUCCESS");
  });

  it("DIFFICULTY proposal ACCEPT by assigned SUPPORT_TEACHER via the review workflow writes a per-student difficulty_override (regression, distinct from the direct-apply endpoint)", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const asacom = await buildAsacom(fixture);
    const supportTeacher = await buildSupportTeacher(fixture);
    await enrollStudent(fixture);
    // ASACOM proposes for a student it does NOT itself have direct apply
    // authority for (it never does, §11) -- SUPPORT_TEACHER is assigned
    // and becomes the resolved reviewer.
    await new SupportAssignmentService(pool).create({
      identity: admin,
      staffTenantMembershipId: supportTeacher.staffTenantMembershipId,
      studentPublicId: fixture.studentPublicId,
      idempotencyKey: idempotencyKey(),
    });
    const proposalService = new FacilitationProposalService(pool);

    const proposal = await proposalService.create({
      identity: asacom,
      studentPublicId: fixture.studentPublicId,
      proposalType: "DIFFICULTY",
      targetCategory: "reading",
      idempotencyKey: idempotencyKey(),
    });

    const reviewed = await proposalService.review({
      identity: supportTeacher,
      id: proposal.publicId,
      decision: "ACCEPT",
      ifMatchVersion: proposal.version,
      idempotencyKey: idempotencyKey(),
    });
    expect(reviewed.status).toBe("ACCEPTED");

    const overrideRows = await pool.query<{ created_by_role: string; student_profile_id: string; class_id: string | null }>(
      `SELECT created_by_role, student_profile_id, class_id FROM difficulty_override WHERE student_profile_id = $1`,
      [fixture.studentProfileId],
    );
    expect(overrideRows.rows).toHaveLength(1);
    expect(overrideRows.rows[0]!.created_by_role).toBe("SUPPORT_TEACHER");
    expect(overrideRows.rows[0]!.class_id).toBeNull();
  });

  it("DIFFICULTY proposal ACCEPT is idempotent: retrying with the same Idempotency-Key never creates a second difficulty_override", async () => {
    const fixture = await buildFixture();
    const admin = await buildSchoolAdmin(fixture);
    const asacom = await buildAsacom(fixture);
    const teacher = await buildTeacher(fixture, [fixture.classId]);
    await enrollStudent(fixture);
    await new SupportAssignmentService(pool).create({
      identity: admin,
      staffTenantMembershipId: asacom.staffTenantMembershipId,
      studentPublicId: fixture.studentPublicId,
      idempotencyKey: idempotencyKey(),
    });
    const proposalService = new FacilitationProposalService(pool);
    const proposal = await proposalService.create({
      identity: asacom,
      studentPublicId: fixture.studentPublicId,
      proposalType: "DIFFICULTY",
      targetCategory: "mathematics",
      idempotencyKey: idempotencyKey(),
    });

    const sharedKey = idempotencyKey();
    const first = await proposalService.review({ identity: teacher, id: proposal.publicId, decision: "ACCEPT", ifMatchVersion: proposal.version, idempotencyKey: sharedKey });
    const second = await proposalService.review({ identity: teacher, id: proposal.publicId, decision: "ACCEPT", ifMatchVersion: proposal.version, idempotencyKey: sharedKey });

    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("ACCEPTED");
    expect(second.version).toBe(first.version);

    const overrideRows = await pool.query(`SELECT id FROM difficulty_override WHERE student_profile_id = $1`, [fixture.studentProfileId]);
    expect(overrideRows.rows).toHaveLength(1);
  });

  it("Same-tenant multi-role: one human as TEACHER + SUPPORT_TEACHER on the same tenant, explicit switch", async () => {
    const fixture = await buildFixture();
    const accountId = await createStaffAccount(`multi-${rnd()}@example.org`);
    const teacherMembershipId = await createMembership(accountId, fixture.tenantId, "TEACHER");
    const supportTeacherMembershipId = await createMembership(accountId, fixture.tenantId, "SUPPORT_TEACHER");
    expect(teacherMembershipId).not.toBe(supportTeacherMembershipId);

    const teacherIdentity = identity({ staffAccountId: accountId, tenantId: fixture.tenantId, staffTenantMembershipId: teacherMembershipId, role: "TEACHER", classScope: [] });
    const tenantContextService = new TenantContextService(pool);
    const memberships = await tenantContextService.listMyMemberships(teacherIdentity);
    const rolesOnTenant = memberships.filter((m) => m.tenantId === fixture.tenantId).map((m) => m.role);
    expect(rolesOnTenant.sort()).toEqual(["SUPPORT_TEACHER", "TEACHER"]);
  });
});
