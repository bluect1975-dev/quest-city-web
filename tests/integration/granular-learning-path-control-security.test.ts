import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { StaffInternalIdentity, StaffRole } from "@quest-city-web/staff-identity";
import { FacilitationProposalService, type FacilitationProposal } from "@quest-city-web/student-support";
import {
  LearningPathPolicyService,
  LearningPathAlternativeService,
  applyLearningPathAdjustmentAcceptance,
} from "@quest-city-web/learning-path-control";

/**
 * Granular Learning Path Control (GLPC) security/integration suite (02_41
 * v1.1, migration 0013) -- every DENY scenario named explicitly in the
 * governing instruction §45-46, plus the core positive flows (§58-59:
 * hard lock, shadowing/reactivation, waiver, alternative, the atomic
 * LEARNING_PATH_ADJUSTMENT accept, idempotency), against a real,
 * dockerized PostgreSQL instance with migrations 0001-0013 applied.
 * Structural template is `account-tenant-convergence-security.test.ts`:
 * real `pg.Pool`, direct service-class calls (never HTTP), raw
 * `pool.query` fixture seeding, `.rejects.toMatchObject({ code: "..." })`.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- granular-learning-path-control-security
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";
const pool = new Pool({ connectionString: DATABASE_URL });

const policies = new LearningPathPolicyService(pool);
const alternatives = new LearningPathAlternativeService(pool);
const proposals = new FacilitationProposalService(pool, async (client: PoolClient, proposal: FacilitationProposal, reviewer: StaffInternalIdentity) => {
  if (!proposal.targetResourceType || !proposal.targetResourceRef || !proposal.targetRequestedState) {
    throw new Error("test hook: LEARNING_PATH_ADJUSTMENT proposal missing target fields");
  }
  await applyLearningPathAdjustmentAcceptance(client, {
    tenantId: proposal.tenantId,
    studentProfileId: proposal.studentProfileId,
    resourceType: proposal.targetResourceType,
    resourceRef: proposal.targetResourceRef,
    requestedState: proposal.targetRequestedState,
    requestedAlternativeContentRef: proposal.targetRequestedAlternativeContentRef,
    reviewerStaffAccountId: reviewer.staffAccountId,
    sourceProposalPublicId: proposal.publicId,
  });
});

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}
function idempotencyKey(): string {
  return `key_${rnd()}_${rnd()}`;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    `TRUNCATE learning_path_snapshot, learning_path_alternative, learning_path_policy,
              facilitation_proposal, difficulty_override, support_profile, learning_support_observation,
              learning_support_event, support_student_assignment,
              staff_invitation, staff_class_assignment, staff_session, staff_tenant_membership, staff_account,
              idempotency_record, semantic_action_log, attempt_response, learning_attempt,
              assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle,
              school_enrollment, class_access_code, school_class, student_profile, student_session,
              rate_limit_bucket, audit_event, tenant CASCADE`,
  );
}

async function createTenant(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', $2) RETURNING id`, [
    `sch_${rnd()}`,
    name,
  ]);
  return result.rows[0]!.id;
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

async function createClass(tenantId: string, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [tenantId, `cls_${rnd()}`, name],
  );
  return result.rows[0]!.id;
}

async function createStudent(tenantId: string): Promise<{ id: string; publicId: string }> {
  const publicId = `stu_${rnd()}`;
  const result = await pool.query<{ id: string }>(`INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [
    tenantId,
    publicId,
  ]);
  return { id: result.rows[0]!.id, publicId };
}

async function enrollStudent(tenantId: string, classId: string, studentProfileId: string): Promise<void> {
  const alias = `alias_${rnd()}`;
  await pool.query(
    `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
     VALUES ($1, $2, $3, $4, $5, 'x', 'ACTIVE')`,
    [tenantId, classId, studentProfileId, alias, alias.toLowerCase()],
  );
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

async function buildAsacom(tenantId: string): Promise<StaffInternalIdentity> {
  const accountId = await createStaffAccount(`asacom-${rnd()}@example.org`);
  const membershipId = await createMembership(accountId, tenantId, "ASACOM");
  return identity({ staffAccountId: accountId, tenantId, staffTenantMembershipId: membershipId, role: "ASACOM", classScope: null });
}

beforeEach(truncateAll);
afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("GLPC: SCHOOL-scope management (SCHOOL_ADMIN-only)", () => {
  it("SCHOOL_ADMIN creates a SCHOOL-scope policy", async () => {
    const tenantId = await createTenant("School A");
    const admin = await buildSchoolAdmin(tenantId);
    const created = await policies.create({
      identity: admin,
      scope: "SCHOOL",
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_algebra_1",
      state: "DISABLED",
      reasonCategory: "SCHOOL_POLICY",
      idempotencyKey: idempotencyKey(),
    });
    expect(created.scope).toBe("SCHOOL");
    expect(created.state).toBe("DISABLED");
  });

  it("TEACHER cannot create a SCHOOL-scope policy: DENY (STAFF_FORBIDDEN, lacks learning_path.school.manage)", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const teacher = await buildTeacher(tenantId, [classId]);
    await expect(
      policies.create({
        identity: teacher,
        scope: "SCHOOL",
        resourceType: "UNIT_ELEMENT",
        resourceRef: "ue_algebra_1",
        state: "DISABLED",
        reasonCategory: "SCHOOL_POLICY",
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });
});

describe("GLPC: hard lock (§10, mission §45 'Teacher overrides School DISABLED')", () => {
  it("Teacher attempting to re-ENABLE a School-DISABLED resource at CLASS scope: DENY (LEARNING_PATH_PARENT_DISABLED)", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const admin = await buildSchoolAdmin(tenantId);
    const teacher = await buildTeacher(tenantId, [classId]);

    await policies.create({
      identity: admin,
      scope: "SCHOOL",
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_algebra_1",
      state: "DISABLED",
      reasonCategory: "SCHOOL_POLICY",
      idempotencyKey: idempotencyKey(),
    });

    await expect(
      policies.create({
        identity: teacher,
        scope: "CLASS",
        scopeClassId: classId,
        resourceType: "UNIT_ELEMENT",
        resourceRef: "ue_algebra_1",
        state: "ENABLED",
        reasonCategory: "TEACHER_DECISION",
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "LEARNING_PATH_PARENT_DISABLED" });
  });
});

describe("GLPC: shadowing + reactivation (§11-12)", () => {
  it("a Class ENABLED policy is shadowed by a later School DISABLED, and reactivates once the School policy is removed", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const admin = await buildSchoolAdmin(tenantId);
    const teacher = await buildTeacher(tenantId, [classId]);

    await policies.create({
      identity: teacher,
      scope: "CLASS",
      scopeClassId: classId,
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_geometry_1",
      state: "ENABLED",
      reasonCategory: "TEACHER_DECISION",
      idempotencyKey: idempotencyKey(),
    });

    const schoolPolicy = await policies.create({
      identity: admin,
      scope: "SCHOOL",
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_geometry_1",
      state: "DISABLED",
      reasonCategory: "SCHOOL_POLICY",
      idempotencyKey: idempotencyKey(),
    });

    const shadowed = await policies.resolveEffective(admin, { resourceType: "UNIT_ELEMENT", resourceRef: "ue_geometry_1", classId });
    expect(shadowed.effectiveAvailability).toBe("EFFECTIVE_UNAVAILABLE");
    expect(shadowed.sourceScope).toBe("SCHOOL");

    const listed = await policies.list(admin, { scope: "CLASS", scopeRef: classId, resourceType: "UNIT_ELEMENT" }, { limit: 10, offset: 0 });
    const classRow = listed.find((p) => p.resourceRef === "ue_geometry_1");
    expect(classRow).toBeDefined();
    expect(classRow!.shadowed).toBe(true);

    await policies.delete(admin, schoolPolicy.publicId, idempotencyKey());

    const reactivated = await policies.resolveEffective(admin, { resourceType: "UNIT_ELEMENT", resourceRef: "ue_geometry_1", classId });
    expect(reactivated.effectiveAvailability).toBe("EFFECTIVE_AVAILABLE");
    expect(reactivated.sourceScope).toBe("CLASS");
  });
});

describe("GLPC: cross-tenant isolation", () => {
  it("a Teacher cannot manage a class in another tenant: DENY (CLASS_ACCESS_DENIED)", async () => {
    const tenantA = await createTenant("School A");
    const tenantB = await createTenant("School B");
    const classInB = await createClass(tenantB, "Class in B");
    const teacherInA = await buildTeacher(tenantA, []);

    await expect(
      policies.create({
        identity: teacherInA,
        scope: "CLASS",
        scopeClassId: classInB,
        resourceType: "UNIT_ELEMENT",
        resourceRef: "ue_x",
        state: "DISABLED",
        reasonCategory: "TEACHER_DECISION",
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "CLASS_ACCESS_DENIED" });
  });

  it("list() never returns another tenant's SCHOOL-scope policies", async () => {
    const tenantA = await createTenant("School A");
    const tenantB = await createTenant("School B");
    const adminA = await buildSchoolAdmin(tenantA);
    const adminB = await buildSchoolAdmin(tenantB);

    await policies.create({
      identity: adminB,
      scope: "SCHOOL",
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_shared_ref",
      state: "DISABLED",
      reasonCategory: "SCHOOL_POLICY",
      idempotencyKey: idempotencyKey(),
    });

    const seenByA = await policies.list(adminA, { scope: "SCHOOL" }, { limit: 50, offset: 0 });
    expect(seenByA.find((p) => p.resourceRef === "ue_shared_ref")).toBeUndefined();
  });
});

describe("GLPC: Support Teacher / ASACOM scope (mission §45)", () => {
  it("a Support Teacher with no assignment and no class access to the student: DENY (SUPPORT_STUDENT_NOT_ASSIGNED, reusing resolveStudentSupportScope's own anti-enumeration code)", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const student = await createStudent(tenantId);
    await enrollStudent(tenantId, classId, student.id);
    const supportTeacher = await buildSupportTeacher(tenantId, []);

    await expect(
      policies.create({
        identity: supportTeacher,
        scope: "STUDENT",
        scopeStudentPublicId: student.publicId,
        resourceType: "UNIT_ELEMENT",
        resourceRef: "ue_y",
        state: "DISABLED_AND_WAIVED",
        reasonCategory: "TEMPORARY_SUPPORT",
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "SUPPORT_STUDENT_NOT_ASSIGNED" });
  });

  it("ASACOM can never directly manage a policy (PROPOSE_ONLY, 02_41 §22): DENY (STAFF_FORBIDDEN, lacks learning_path.student.manage)", async () => {
    const tenantId = await createTenant("School A");
    const student = await createStudent(tenantId);
    const asacom = await buildAsacom(tenantId);

    await expect(
      policies.create({
        identity: asacom,
        scope: "STUDENT",
        scopeStudentPublicId: student.publicId,
        resourceType: "UNIT_ELEMENT",
        resourceRef: "ue_z",
        state: "DISABLED_AND_WAIVED",
        reasonCategory: "TEMPORARY_SUPPORT",
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });
});

describe("GLPC: waiver + alternative (§17-23)", () => {
  it("DISABLED_AND_WAIVED yields effectiveRequirement=waived", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const student = await createStudent(tenantId);
    await enrollStudent(tenantId, classId, student.id);
    const teacher = await buildTeacher(tenantId, [classId]);

    await policies.create({
      identity: teacher,
      scope: "STUDENT",
      scopeStudentPublicId: student.publicId,
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_waived_activity",
      state: "DISABLED_AND_WAIVED",
      reasonCategory: "TEMPORARY_SUPPORT",
      idempotencyKey: idempotencyKey(),
    });

    const resolution = await policies.resolveEffective(teacher, {
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_waived_activity",
      studentPublicId: student.publicId,
    });
    expect(resolution.effectiveRequirement).toBe("waived");
    expect(resolution.waiverState).toBe(true);
  });

  it("DISABLED_WITH_ALTERNATIVE referencing a non-existent alternative: DENY (LEARNING_PATH_ALTERNATIVE_INVALID)", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const student = await createStudent(tenantId);
    await enrollStudent(tenantId, classId, student.id);
    const teacher = await buildTeacher(tenantId, [classId]);

    await expect(
      policies.create({
        identity: teacher,
        scope: "STUDENT",
        scopeStudentPublicId: student.publicId,
        resourceType: "UNIT_ELEMENT",
        resourceRef: "ue_needs_alt",
        state: "DISABLED_WITH_ALTERNATIVE",
        reasonCategory: "ALTERNATIVE_ACTIVITY",
        alternativeContentRef: "bnd_does_not_exist",
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "LEARNING_PATH_ALTERNATIVE_INVALID" });
  });

  it("DISABLED_WITH_ALTERNATIVE succeeds once the alternative mapping exists, and the resolution surfaces it", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const student = await createStudent(tenantId);
    await enrollStudent(tenantId, classId, student.id);
    const teacher = await buildTeacher(tenantId, [classId]);

    await alternatives.create({
      identity: teacher,
      originalResourceType: "UNIT_ELEMENT",
      originalResourceRef: "ue_needs_alt_2",
      alternativeContentRef: "bnd_alt_content",
      idempotencyKey: idempotencyKey(),
    });

    await policies.create({
      identity: teacher,
      scope: "STUDENT",
      scopeStudentPublicId: student.publicId,
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_needs_alt_2",
      state: "DISABLED_WITH_ALTERNATIVE",
      reasonCategory: "ALTERNATIVE_ACTIVITY",
      alternativeContentRef: "bnd_alt_content",
      idempotencyKey: idempotencyKey(),
    });

    const resolution = await policies.resolveEffective(teacher, {
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_needs_alt_2",
      studentPublicId: student.publicId,
    });
    expect(resolution.effectiveRequirement).toBe("alternative");
    expect(resolution.alternativeContentRef).toBe("bnd_alt_content");
  });
});

describe("GLPC: LEARNING_PATH_ADJUSTMENT proposal (02_41 §22-23)", () => {
  it("ASACOM proposes, TEACHER ACCEPTs: the STUDENT-scope policy is created atomically with the review", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const student = await createStudent(tenantId);
    await enrollStudent(tenantId, classId, student.id);
    const asacom = await buildAsacom(tenantId);
    const teacher = await buildTeacher(tenantId, [classId]);

    const created = await proposals.create({
      identity: asacom,
      studentPublicId: student.publicId,
      proposalType: "LEARNING_PATH_ADJUSTMENT",
      targetLearningPath: {
        resourceType: "UNIT_ELEMENT",
        resourceRef: "ue_adjustment_target",
        requestedState: "DISABLED_AND_WAIVED",
      },
      idempotencyKey: idempotencyKey(),
    });
    expect(created.status).toBe("SUBMITTED");

    await proposals.review({
      identity: teacher,
      id: created.publicId,
      decision: "ACCEPT",
      ifMatchVersion: created.version,
      idempotencyKey: idempotencyKey(),
    });

    const resolution = await policies.resolveEffective(teacher, {
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_adjustment_target",
      studentPublicId: student.publicId,
    });
    expect(resolution.effectiveRequirement).toBe("waived");
    expect(resolution.sourceScope).toBe("STUDENT");
  });

  it("REJECT leaves no learning_path_policy row behind", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const student = await createStudent(tenantId);
    await enrollStudent(tenantId, classId, student.id);
    const asacom = await buildAsacom(tenantId);
    const teacher = await buildTeacher(tenantId, [classId]);

    const created = await proposals.create({
      identity: asacom,
      studentPublicId: student.publicId,
      proposalType: "LEARNING_PATH_ADJUSTMENT",
      targetLearningPath: {
        resourceType: "UNIT_ELEMENT",
        resourceRef: "ue_rejected_target",
        requestedState: "DISABLED",
      },
      idempotencyKey: idempotencyKey(),
    });

    await proposals.review({
      identity: teacher,
      id: created.publicId,
      decision: "REJECT",
      ifMatchVersion: created.version,
      idempotencyKey: idempotencyKey(),
    });

    const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM learning_path_policy WHERE resource_ref = 'ue_rejected_target'`);
    expect(count.rows[0]!.n).toBe("0");
  });

  it("ACCEPT that would re-ENABLE a School-DISABLED resource rolls back entirely: proposal stays SUBMITTED, no policy row", async () => {
    const tenantId = await createTenant("School A");
    const classId = await createClass(tenantId, "Class 1A");
    const student = await createStudent(tenantId);
    await enrollStudent(tenantId, classId, student.id);
    const admin = await buildSchoolAdmin(tenantId);
    const asacom = await buildAsacom(tenantId);
    const teacher = await buildTeacher(tenantId, [classId]);

    await policies.create({
      identity: admin,
      scope: "SCHOOL",
      resourceType: "UNIT_ELEMENT",
      resourceRef: "ue_blocked_reenable",
      state: "DISABLED",
      reasonCategory: "SCHOOL_POLICY",
      idempotencyKey: idempotencyKey(),
    });

    const created = await proposals.create({
      identity: asacom,
      studentPublicId: student.publicId,
      proposalType: "LEARNING_PATH_ADJUSTMENT",
      targetLearningPath: { resourceType: "UNIT_ELEMENT", resourceRef: "ue_blocked_reenable", requestedState: "ENABLED" },
      idempotencyKey: idempotencyKey(),
    });

    await expect(
      proposals.review({ identity: teacher, id: created.publicId, decision: "ACCEPT", ifMatchVersion: created.version, idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "LEARNING_PATH_PARENT_DISABLED" });

    const proposalRow = await pool.query<{ status: string }>(`SELECT status FROM facilitation_proposal WHERE public_id = $1`, [created.publicId]);
    expect(proposalRow.rows[0]!.status).toBe("SUBMITTED");
    const policyCount = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM learning_path_policy WHERE resource_ref = 'ue_blocked_reenable' AND scope = 'STUDENT'`);
    expect(policyCount.rows[0]!.n).toBe("0");
  });
});

describe("GLPC: idempotency (mission §41, no second mechanism)", () => {
  it("the same Idempotency-Key on create() returns the same policy, never a duplicate row", async () => {
    const tenantId = await createTenant("School A");
    const admin = await buildSchoolAdmin(tenantId);
    const key = idempotencyKey();
    const input = {
      identity: admin,
      scope: "SCHOOL" as const,
      resourceType: "UNIT_ELEMENT" as const,
      resourceRef: "ue_idempotent",
      state: "DISABLED" as const,
      reasonCategory: "SCHOOL_POLICY" as const,
      idempotencyKey: key,
    };
    const first = await policies.create(input);
    const second = await policies.create(input);
    expect(second.id).toBe(first.id);

    const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM learning_path_policy WHERE resource_ref = 'ue_idempotent'`);
    expect(count.rows[0]!.n).toBe("1");
  });
});
