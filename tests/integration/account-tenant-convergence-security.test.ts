import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PlatformAuthService, type Capability, type PlatformAdminIdentity } from "@quest-city-web/platform-admin";
import { hashPassword, StaffAuthService, type StaffInternalIdentity } from "@quest-city-web/staff-identity";
import {
  ConvergenceRequestRepository,
  MigrationPlanRepository,
  MigrationExecutionRepository,
  ConvergenceRequestService,
  ConvergencePreviewService,
  ConvergenceApprovalService,
  ConvergenceExecutionService,
  ConvergenceRollbackReviewService,
  ContentPromotionService,
  TenantContextService,
  type MigrationExecution,
} from "@quest-city-web/convergence";

/**
 * School Pilot Readiness Tranche D (Account/Tenant Convergence)
 * integration/security tests against a real, dockerized PostgreSQL
 * instance with migrations 0001-0011 applied. Structural template is
 * `independent-educator-security.test.ts`: real `pg.Pool`, direct
 * service-class calls (never HTTP -- `apps/api`/`apps/dashboard` are not
 * implemented for this tranche yet), raw `pool.query` fixture seeding and
 * DB-side-effect assertions, `.rejects.toMatchObject({ code: "..." })`.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- account-tenant-convergence-security
 *
 * Covers 02_38 v1.4 §9-10/§10.2bis/§12-15/§17-18/§20-22, 02_25 v1.10
 * §6.15, 02_35 v1.5 §11quater, 02_26 v1.14 §36: party-scoped create/list/
 * read, cross-tenant impersonation guards, anti-duplication, already-
 * member/suspended-tenant guards, anti-enumeration, PLATFORM_ADMIN-only
 * preview (with integrated identity verification), staff-session-authed
 * approve/reject, PLATFORM_ADMIN-only execute (active-attempt guard,
 * cross-tenant class transfer), rollback review, the disclosed
 * ContentPromotionService gap, and TenantContextService.switchTenant.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });
const PASSWORD = "correct horse battery staple";

const ALL_PLATFORM_CAPABILITIES: Capability[] = [
  "tenant.create",
  "tenant.read",
  "tenant.suspend",
  "school_admin.activate",
  "audit.read.global",
  "independent_educator.activate",
  "independent_educator.read",
  "independent_educator.status.manage",
  "convergence.read",
  "convergence.preview",
  "convergence.execute",
  "convergence.rollback.review",
];

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

function idempotencyKey(): string {
  return `key_${rnd()}_${rnd()}`;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE platform_admin_session, capability_grant, platform_admin_grant, migration_execution, migration_plan, convergence_request, staff_invitation, staff_class_assignment, staff_session, staff_tenant_membership, staff_account, review_queue_item, teacher_feedback, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function createPlatformAdmin(email: string, capabilities: Capability[] = ALL_PLATFORM_CAPABILITIES): Promise<string> {
  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
     VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_BOOTSTRAP_SCRIPT', 'test-fixture') RETURNING id`,
    [email, await hashPassword(PASSWORD)],
  );
  const accountId = accountResult.rows[0]!.id;
  const grantResult = await pool.query<{ id: string }>(
    `INSERT INTO platform_admin_grant (staff_account_id, status, granted_by_actor_type, granted_by_actor_id)
     VALUES ($1, 'ACTIVE', 'ADMIN_BOOTSTRAP_SCRIPT', 'test-fixture') RETURNING id`,
    [accountId],
  );
  const grantId = grantResult.rows[0]!.id;
  for (const capability of capabilities) {
    await pool.query(`INSERT INTO capability_grant (platform_admin_grant_id, capability) VALUES ($1, $2)`, [grantId, capability]);
  }
  return accountId;
}

async function platformIdentity(email: string) {
  const platformAuth = new PlatformAuthService(pool);
  const session = await platformAuth.start({ email, password: PASSWORD, clientIp: "127.0.0.1" });
  return platformAuth.resolveIdentity(session.sessionToken);
}

async function createTenant(type: "SCHOOL" | "INDEPENDENT_EDUCATOR", name: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<string> {
  const prefix = type === "SCHOOL" ? "sch" : "edu";
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${prefix}_${rnd()}`, type, status, name],
  );
  return result.rows[0]!.id;
}

async function createStaffAccount(email: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
     VALUES ($1, 'x', 'scrypt', $2, 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
    [email, status],
  );
  return result.rows[0]!.id;
}

async function createMembership(
  staffAccountId: string,
  tenantId: string,
  role: "TEACHER" | "SCHOOL_ADMIN" | "INDEPENDENT_EDUCATOR",
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED" = "ACTIVE",
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [staffAccountId, tenantId, role, status],
  );
  return result.rows[0]!.id;
}

async function createStaffSession(staffAccountId: string, tenantId: string, staffTenantMembershipId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO staff_session (staff_account_id, tenant_id, staff_tenant_membership_id, token_hash, csrf_token_hash, absolute_expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '12 hours') RETURNING id`,
    [staffAccountId, tenantId, staffTenantMembershipId, `tok_${rnd()}_${rnd()}`, `csrf_${rnd()}`],
  );
  return result.rows[0]!.id;
}

/** `sessionId` (StaffInternalIdentity's most recent field) defaults to a placeholder UUID -- only `switchTenant` actually resolves it against a real `staff_session` row, per the governing instruction. */
function staffIdentity(input: {
  staffAccountId: string;
  tenantId: string;
  staffTenantMembershipId: string;
  role: "TEACHER" | "SCHOOL_ADMIN" | "INDEPENDENT_EDUCATOR";
  classScope: string[] | null;
  sessionId?: string;
}): StaffInternalIdentity {
  return {
    staffAccountId: input.staffAccountId,
    tenantId: input.tenantId,
    staffTenantMembershipId: input.staffTenantMembershipId,
    role: input.role,
    classScope: input.classScope,
    csrfTokenHash: "unused-in-these-tests",
    sessionId: input.sessionId ?? randomUUID(),
  };
}

async function buildEducator(tenantId: string, email: string = `educator-${rnd()}@example.org`): Promise<StaffInternalIdentity> {
  const staffAccountId = await createStaffAccount(email);
  const staffTenantMembershipId = await createMembership(staffAccountId, tenantId, "INDEPENDENT_EDUCATOR");
  return staffIdentity({ staffAccountId, tenantId, staffTenantMembershipId, role: "INDEPENDENT_EDUCATOR", classScope: null });
}

async function buildSchoolAdmin(tenantId: string, email: string = `admin-${rnd()}@example.org`): Promise<StaffInternalIdentity> {
  const staffAccountId = await createStaffAccount(email);
  const staffTenantMembershipId = await createMembership(staffAccountId, tenantId, "SCHOOL_ADMIN");
  return staffIdentity({ staffAccountId, tenantId, staffTenantMembershipId, role: "SCHOOL_ADMIN", classScope: null });
}

async function buildTeacher(tenantId: string, email: string = `teacher-${rnd()}@example.org`): Promise<StaffInternalIdentity> {
  const staffAccountId = await createStaffAccount(email);
  const staffTenantMembershipId = await createMembership(staffAccountId, tenantId, "TEACHER");
  return staffIdentity({ staffAccountId, tenantId, staffTenantMembershipId, role: "TEACHER", classScope: [] });
}

interface ConvergenceFixture {
  sourceTenantId: string;
  targetTenantId: string;
  educator: StaffInternalIdentity;
  schoolAdmin: StaffInternalIdentity;
}

/** A ready-to-use INDEPENDENT_EDUCATOR source tenant + SCHOOL target tenant pair, each with an ACTIVE party identity, matching the only tenant-type pairing `enforce_convergence_request_tenant_types` (migration 0011) accepts. */
async function buildConvergenceFixture(): Promise<ConvergenceFixture> {
  const sourceTenantId = await createTenant("INDEPENDENT_EDUCATOR", "Source Tutoring Practice");
  const targetTenantId = await createTenant("SCHOOL", "Target School");
  const educator = await buildEducator(sourceTenantId);
  const schoolAdmin = await buildSchoolAdmin(targetTenantId);
  return { sourceTenantId, targetTenantId, educator, schoolAdmin };
}

async function createClass(tenantId: string, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [tenantId, `cls_${rnd()}`, name],
  );
  return result.rows[0]!.id;
}

async function createStudent(tenantId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [tenantId, `std_${rnd()}`],
  );
  return result.rows[0]!.id;
}

async function enrollStudent(tenantId: string, classId: string, studentProfileId: string, alias: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
     VALUES ($1, $2, $3, $4, $5, 'x', 'ACTIVE') RETURNING id`,
    [tenantId, classId, studentProfileId, alias, alias.toLowerCase()],
  );
  return result.rows[0]!.id;
}

async function createContentBundle(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref)
     VALUES ($1, 'MAT', '1.0.0', 'RUNTIME_FIXTURE_BUNDLE', 'PUBLISHED', 'sha256:abc', 's3://x') RETURNING id`,
    [`bnd_${rnd()}`],
  );
  const contentBundleId = result.rows[0]!.id;
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [contentBundleId]);
  return contentBundleId;
}

async function createAssignment(tenantId: string, classId: string, contentBundleId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
     VALUES ($1, $2, $3, 'Test assignment', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
    [tenantId, classId, `asn_${rnd()}`, contentBundleId],
  );
  const assignmentId = result.rows[0]!.id;
  await pool.query(`INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, 'WEB')`, [
    assignmentId,
    tenantId,
  ]);
  return assignmentId;
}

async function createInProgressAttempt(
  tenantId: string,
  assignmentId: string,
  studentProfileId: string,
  enrollmentId: string,
  contentBundleId: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO learning_attempt
       (tenant_id, event_id, assignment_id, student_profile_id, enrollment_id, content_bundle_id, content_id, content_version,
        runtime_channel, attempt_state, creation_idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, gen_random_uuid(), '1.0.0', 'WEB', 'IN_PROGRESS', $7) RETURNING id`,
    [tenantId, `evt_${rnd()}`, assignmentId, studentProfileId, enrollmentId, contentBundleId, `key_${rnd()}`],
  );
  return result.rows[0]!.id;
}

const requestService = new ConvergenceRequestService(pool);
const previewService = new ConvergencePreviewService(pool);
const approvalService = new ConvergenceApprovalService(pool);
const executionService = new ConvergenceExecutionService(pool);
const rollbackService = new ConvergenceRollbackReviewService(pool);
const promotionService = new ContentPromotionService(pool);
const tenantContextService = new TenantContextService(pool);
const requestRepo = new ConvergenceRequestRepository(pool);
const planRepo = new MigrationPlanRepository(pool);
const executionRepo = new MigrationExecutionRepository(pool);

/**
 * `ConvergenceExecutionService.execute()` has no explicit return-type
 * annotation and one internal branch (`return begin.response;`, the
 * idempotency-replay short-circuit) returns `unknown` -- TypeScript
 * therefore infers the whole method's return type as `unknown`, even
 * though every code path actually exercised in these tests returns a
 * real `MigrationExecution`. Narrowed here once instead of casting at
 * every call site.
 */
async function executeConvergence(identity: PlatformAdminIdentity, requestId: string, key: string): Promise<MigrationExecution> {
  return (await executionService.execute(identity, requestId, key)) as MigrationExecution;
}

describe("Create -- party scoping (02_38 v1.4 §10.3, 02_35 v1.5 §11quater.3)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("an INDEPENDENT_EDUCATOR can create a convergence request for their own source tenant", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    expect(created.sourceTenantId).toBe(fx.sourceTenantId);
    expect(created.targetTenantId).toBe(fx.targetTenantId);
    expect(created.educatorStaffAccountId).toBe(fx.educator.staffAccountId);
    expect(created.status).toBe("REQUESTED");
  });

  it("a SCHOOL_ADMIN can create one targeting their own tenant (explicit educatorStaffAccountId)", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.schoolAdmin, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      educatorStaffAccountId: fx.educator.staffAccountId,
      idempotencyKey: idempotencyKey(),
    });
    expect(created.targetTenantId).toBe(fx.targetTenantId);
    expect(created.educatorStaffAccountId).toBe(fx.educator.staffAccountId);
    expect(created.requestedByStaffAccountId).toBe(fx.schoolAdmin.staffAccountId);
  });
});

describe("TEACHER is never a party to Account/Tenant Convergence (capability.ts)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("cannot create -- STAFF_FORBIDDEN", async () => {
    const fx = await buildConvergenceFixture();
    const teacher = await buildTeacher(fx.targetTenantId);
    await expect(
      requestService.create(teacher, {
        sourceTenantId: fx.sourceTenantId,
        targetTenantId: fx.targetTenantId,
        educatorStaffAccountId: fx.educator.staffAccountId,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("cannot approve -- STAFF_FORBIDDEN", async () => {
    const fx = await buildConvergenceFixture();
    const teacher = await buildTeacher(fx.targetTenantId);
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await expect(approvalService.approve(teacher, created.id, { migrationPlanFingerprint: "whatever" })).rejects.toMatchObject({
      code: "STAFF_FORBIDDEN",
    });
  });

  it("cannot read or list -- STAFF_FORBIDDEN", async () => {
    const fx = await buildConvergenceFixture();
    const teacher = await buildTeacher(fx.targetTenantId);
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await expect(requestService.getByIdForStaff(teacher, created.id)).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
    await expect(requestService.listForStaff(teacher, { limit: 50, offset: 0 })).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });
});

describe("Cross-tenant impersonation guards", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("an INDEPENDENT_EDUCATOR cannot create a request where sourceTenantId is NOT their own tenant", async () => {
    const fx = await buildConvergenceFixture();
    const otherSourceTenantId = await createTenant("INDEPENDENT_EDUCATOR", "Someone Else's Tutoring");
    await expect(
      requestService.create(fx.educator, {
        sourceTenantId: otherSourceTenantId,
        targetTenantId: fx.targetTenantId,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });

  it("a SCHOOL_ADMIN cannot create a request where targetTenantId is NOT their own tenant", async () => {
    const fx = await buildConvergenceFixture();
    const otherTargetTenantId = await createTenant("SCHOOL", "Someone Else's School");
    await expect(
      requestService.create(fx.schoolAdmin, {
        sourceTenantId: fx.sourceTenantId,
        targetTenantId: otherTargetTenantId,
        educatorStaffAccountId: fx.educator.staffAccountId,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });
  });
});

describe("Anti-duplication and pre-flight guards (migration 0011 convergence_request_active_uq)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("duplicate creation for the same (source, target, educator) triple while a non-terminal request exists returns the SAME row, never a second", async () => {
    const fx = await buildConvergenceFixture();
    const first = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    const second = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    expect(second.id).toBe(first.id);

    const count = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM convergence_request WHERE source_tenant_id = $1 AND target_tenant_id = $2 AND educator_staff_account_id = $3`,
      [fx.sourceTenantId, fx.targetTenantId, fx.educator.staffAccountId],
    );
    expect(count.rows[0]!.n).toBe("1");
  });

  it("an identity already ACTIVE on the target tenant produces CONVERGENCE_ALREADY_MEMBER, no request created", async () => {
    const fx = await buildConvergenceFixture();
    await createMembership(fx.educator.staffAccountId, fx.targetTenantId, "TEACHER", "ACTIVE");
    await expect(
      requestService.create(fx.educator, {
        sourceTenantId: fx.sourceTenantId,
        targetTenantId: fx.targetTenantId,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "CONVERGENCE_ALREADY_MEMBER" });

    const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM convergence_request`);
    expect(count.rows[0]!.n).toBe("0");
  });

  it("a SUSPENDED source tenant produces TENANT_SUSPENDED_FOR_CONVERGENCE", async () => {
    const sourceTenantId = await createTenant("INDEPENDENT_EDUCATOR", "Suspended Source", "SUSPENDED");
    const targetTenantId = await createTenant("SCHOOL", "Healthy Target");
    const educator = await buildEducator(sourceTenantId);
    await expect(
      requestService.create(educator, { sourceTenantId, targetTenantId, idempotencyKey: idempotencyKey() }),
    ).rejects.toMatchObject({ code: "TENANT_SUSPENDED_FOR_CONVERGENCE" });
  });

  it("a SUSPENDED target tenant produces TENANT_SUSPENDED_FOR_CONVERGENCE", async () => {
    const sourceTenantId = await createTenant("INDEPENDENT_EDUCATOR", "Healthy Source");
    const targetTenantId = await createTenant("SCHOOL", "Suspended Target", "SUSPENDED");
    const educator = await buildEducator(sourceTenantId);
    const schoolAdmin = await buildSchoolAdmin(targetTenantId);
    await expect(
      requestService.create(schoolAdmin, {
        sourceTenantId,
        targetTenantId,
        educatorStaffAccountId: educator.staffAccountId,
        idempotencyKey: idempotencyKey(),
      }),
    ).rejects.toMatchObject({ code: "TENANT_SUSPENDED_FOR_CONVERGENCE" });
  });
});

describe("Cross-scope read/list -- anti-enumeration", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("an unrelated third-tenant party cannot read a request they're not a party to: a real (foreign) id and a genuinely nonexistent id return byte-identical CONVERGENCE_REQUEST_NOT_FOUND", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    const thirdTenantId = await createTenant("SCHOOL", "Unrelated Third School");
    const thirdAdmin = await buildSchoolAdmin(thirdTenantId);

    const realIdError = await requestService.getByIdForStaff(thirdAdmin, created.id).catch((e: unknown) => e);
    const fakeIdError = await requestService
      .getByIdForStaff(thirdAdmin, "00000000-0000-0000-0000-000000000000")
      .catch((e: unknown) => e);

    expect(realIdError).toMatchObject({ code: "CONVERGENCE_REQUEST_NOT_FOUND" });
    expect(fakeIdError).toMatchObject({ code: "CONVERGENCE_REQUEST_NOT_FOUND" });
    // Never a different code/message/status for "exists but not yours" vs "genuinely doesn't exist".
    const shapeOf = (e: unknown) => {
      const err = e as { code: string; message: string; httpStatus: number };
      return { code: err.code, message: err.message, httpStatus: err.httpStatus };
    };
    expect(shapeOf(realIdError)).toEqual(shapeOf(fakeIdError));
  });

  it("listForStaff scopes results to the caller's own party role and never leaks an unrelated tenant's request", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });

    const educatorList = await requestService.listForStaff(fx.educator, { limit: 50, offset: 0 });
    expect(educatorList.map((r) => r.id)).toContain(created.id);

    const schoolAdminList = await requestService.listForStaff(fx.schoolAdmin, { limit: 50, offset: 0 });
    expect(schoolAdminList.map((r) => r.id)).toContain(created.id);

    const unrelatedTenantId = await createTenant("SCHOOL", "Unrelated School");
    const unrelatedAdmin = await buildSchoolAdmin(unrelatedTenantId);
    const unrelatedList = await requestService.listForStaff(unrelatedAdmin, { limit: 50, offset: 0 });
    expect(unrelatedList.map((r) => r.id)).not.toContain(created.id);
  });
});

describe("PLATFORM_ADMIN cross-tenant read/list (convergence.read, 02_38 v1.4 §4.1)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("a PLATFORM_ADMIN lacking convergence.read gets CAPABILITY_DENIED on listForPlatformAdmin/getByIdForPlatformAdmin", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await createPlatformAdmin("no-cvg-read@example.org", ["convergence.preview"]);
    const identity = await platformIdentity("no-cvg-read@example.org");
    await expect(requestService.listForPlatformAdmin(identity, { limit: 50, offset: 0 })).rejects.toMatchObject({
      code: "CAPABILITY_DENIED",
    });
    await expect(requestService.getByIdForPlatformAdmin(identity, created.id)).rejects.toMatchObject({
      code: "CAPABILITY_DENIED",
    });
  });

  it("a PLATFORM_ADMIN with convergence.read sees the request unscoped, across both tenants", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await createPlatformAdmin("cvg-reader@example.org", ["convergence.read"]);
    const identity = await platformIdentity("cvg-reader@example.org");
    const found = await requestService.getByIdForPlatformAdmin(identity, created.id);
    expect(found.id).toBe(created.id);
    const list = await requestService.listForPlatformAdmin(identity, { limit: 50, offset: 0 });
    expect(list.map((r) => r.id)).toContain(created.id);
  });

  it("getByIdForPlatformAdmin on a nonexistent id returns CONVERGENCE_REQUEST_NOT_FOUND", async () => {
    await createPlatformAdmin("cvg-reader2@example.org", ["convergence.read"]);
    const identity = await platformIdentity("cvg-reader2@example.org");
    await expect(requestService.getByIdForPlatformAdmin(identity, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      code: "CONVERGENCE_REQUEST_NOT_FOUND",
    });
  });
});

describe("preview() -- PLATFORM_ADMIN-only, integrated identity verification (02_38 v1.4 §9/§10.2bis)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("requires convergence.preview -- a PLATFORM_ADMIN lacking it gets CAPABILITY_DENIED (runtime check; the staff-vs-platform identity split is additionally enforced by TypeScript at the service signature level)", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await createPlatformAdmin("no-preview@example.org", ["convergence.read"]);
    const identity = await platformIdentity("no-preview@example.org");
    await expect(previewService.preview(identity, created.id)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  });

  it("an educator who does NOT actually hold an ACTIVE INDEPENDENT_EDUCATOR membership on the source tenant produces CONVERGENCE_IDENTITY_MISMATCH and transitions the request to BLOCKED", async () => {
    const fx = await buildConvergenceFixture();
    // A SCHOOL_ADMIN-initiated request naming an educatorStaffAccountId
    // who holds no membership at all on the source tenant -- create()'s
    // SCHOOL_ADMIN branch does not itself verify the named educator's
    // source-tenant standing (only preview()'s identity verification does).
    const impostorAccountId = await createStaffAccount(`impostor-${rnd()}@example.org`);
    const created = await requestService.create(fx.schoolAdmin, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      educatorStaffAccountId: impostorAccountId,
      idempotencyKey: idempotencyKey(),
    });

    await createPlatformAdmin("mismatch-previewer@example.org");
    const platform = await platformIdentity("mismatch-previewer@example.org");
    await expect(previewService.preview(platform, created.id)).rejects.toMatchObject({ code: "CONVERGENCE_IDENTITY_MISMATCH" });

    const reread = await requestRepo.findById(created.id);
    expect(reread?.status).toBe("BLOCKED");
  });
});

describe("Full happy path: create -> preview -> approve x2 -> execute -> COMPLETED", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("migrates a class + its student + enrollment cross-tenant and grants the educator a new TEACHER membership on the target tenant", async () => {
    const fx = await buildConvergenceFixture();
    const classId = await createClass(fx.sourceTenantId, "Migrating Class");
    const studentProfileId = await createStudent(fx.sourceTenantId);
    const enrollmentId = await enrollStudent(fx.sourceTenantId, classId, studentProfileId, "Migrating Student");

    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });

    await createPlatformAdmin("happy-path-admin@example.org");
    const platform = await platformIdentity("happy-path-admin@example.org");

    const plan = await previewService.preview(platform, created.id);
    expect(plan.classesConsidered.map((c) => c.classId)).toContain(classId);

    const afterTeacherSide = await approvalService.approve(fx.educator, created.id, {
      migrationPlanFingerprint: plan.fingerprint,
      classDecisions: [{ classId, decision: "TRANSFER" }],
    });
    expect(afterTeacherSide.status).toBe("AWAITING_APPROVALS");

    const afterSchoolSide = await approvalService.approve(fx.schoolAdmin, created.id, {
      migrationPlanFingerprint: plan.fingerprint,
    });
    expect(afterSchoolSide.status).toBe("APPROVED");

    const confirmedPlan = await planRepo.findById(plan.id);
    expect(confirmedPlan?.status).toBe("CONFIRMED");
    expect(confirmedPlan?.classDecisions).toEqual([expect.objectContaining({ classId, decision: "TRANSFER" })]);

    const executed = await executeConvergence(platform, created.id, idempotencyKey());
    expect(executed.status).toBe("COMPLETED");
    expect(executed.unitsFailed).toBe(0);

    const finalRequest = await requestRepo.findById(created.id);
    expect(finalRequest?.status).toBe("COMPLETED");

    const classRow = await pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM school_class WHERE id = $1`, [classId]);
    expect(classRow.rows[0]!.tenant_id).toBe(fx.targetTenantId);

    const enrollmentRow = await pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM school_enrollment WHERE id = $1`, [
      enrollmentId,
    ]);
    expect(enrollmentRow.rows[0]!.tenant_id).toBe(fx.targetTenantId);

    const studentRow = await pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM student_profile WHERE id = $1`, [
      studentProfileId,
    ]);
    expect(studentRow.rows[0]!.tenant_id).toBe(fx.targetTenantId);

    const newMembership = await pool.query<{ role: string; status: string }>(
      `SELECT role, status FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2`,
      [fx.educator.staffAccountId, fx.targetTenantId],
    );
    expect(newMembership.rows[0]).toMatchObject({ role: "TEACHER", status: "ACTIVE" });

    // Regression (bug found during Tranche D closure walkthrough): the
    // educator's new membership is TEACHER, whose scope is per-class only
    // (02_35 §3.2, enforced by the staff_class_assignment_teacher_only
    // trigger) -- unlike the INDEPENDENT_EDUCATOR membership it came from,
    // which had implicit access to every class and so never held a
    // staff_class_assignment row to begin with. Without an explicit INSERT
    // for the freshly transferred class, the newly provisioned teacher
    // would see zero classes in the target school despite the class having
    // just migrated to them.
    const classAssignment = await pool.query<{ id: string }>(
      `SELECT sca.id FROM staff_class_assignment sca
       JOIN staff_tenant_membership stm ON stm.id = sca.staff_tenant_membership_id
       WHERE stm.staff_account_id = $1 AND stm.tenant_id = $2 AND sca.class_id = $3`,
      [fx.educator.staffAccountId, fx.targetTenantId, classId],
    );
    expect(classAssignment.rows).toHaveLength(1);
  });
});

describe("Stale preview guard (migration_plan append-only, 02_25 v1.10 §6.15)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("approving against a fingerprint from an earlier preview call (superseded by a second preview) produces CONVERGENCE_PREVIEW_STALE", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await createPlatformAdmin("stale-admin@example.org");
    const platform = await platformIdentity("stale-admin@example.org");

    const firstPlan = await previewService.preview(platform, created.id);
    const secondPlan = await previewService.preview(platform, created.id);
    expect(secondPlan.id).not.toBe(firstPlan.id);

    await expect(
      approvalService.approve(fx.educator, created.id, { migrationPlanFingerprint: firstPlan.fingerprint }),
    ).rejects.toMatchObject({ code: "CONVERGENCE_PREVIEW_STALE" });
  });
});

describe("Reject -- terminal transition", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("rejecting a request transitions it to REJECTED; a further approve/reject on the same id is CONVERGENCE_REQUEST_INVALID_TRANSITION", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await createPlatformAdmin("reject-admin@example.org");
    const platform = await platformIdentity("reject-admin@example.org");
    // reject() only accepts PREVIEW_READY/AWAITING_APPROVALS as source
    // states (approval-service.ts) -- a freshly REQUESTED row must be
    // previewed first.
    await previewService.preview(platform, created.id);

    const rejected = await approvalService.reject(fx.educator, created.id, "Changed my mind");
    expect(rejected.status).toBe("REJECTED");

    await expect(
      approvalService.approve(fx.schoolAdmin, created.id, { migrationPlanFingerprint: "whatever" }),
    ).rejects.toMatchObject({ code: "CONVERGENCE_REQUEST_INVALID_TRANSITION" });
    await expect(approvalService.reject(fx.schoolAdmin, created.id, "too late")).rejects.toMatchObject({
      code: "CONVERGENCE_REQUEST_INVALID_TRANSITION",
    });
  });
});

describe("Idempotency (convergence_request_create, migration 0011)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("replaying the same idempotencyKey with the same payload returns the identical response and never creates a second row", async () => {
    const fx = await buildConvergenceFixture();
    const key = idempotencyKey();
    const first = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: key,
    });
    const second = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: key,
    });
    expect(second.id).toBe(first.id);
    const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM convergence_request`);
    expect(count.rows[0]!.n).toBe("1");
  });

  it("reusing the same idempotencyKey for the same caller with a DIFFERENT payload (source/target/educator triple) produces IDEMPOTENCY_CONFLICT, never a silent second row", async () => {
    // scope_key is `${identity.staffAccountId}:${idempotencyKey}` (caller-partitioned,
    // matching the convention every other idempotency-wrapped service in this codebase
    // uses -- e.g. tenant-provisioning-service.ts, independent-educator-activation-service.ts).
    // The payload itself travels separately via requestHash(), so begin()'s stored-hash
    // comparison can actually observe a mismatch here.
    const fx = await buildConvergenceFixture();
    const otherTargetTenantId = await createTenant("SCHOOL", "Other Target School");
    const key = idempotencyKey();
    const first = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: key,
    });
    await expect(
      requestService.create(fx.educator, {
        sourceTenantId: fx.sourceTenantId,
        targetTenantId: otherTargetTenantId,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM convergence_request`);
    expect(count.rows[0]!.n).toBe("1");
    expect(first.targetTenantId).toBe(fx.targetTenantId);
  });

  it("the same idempotencyKey used by a DIFFERENT caller (different staffAccountId) is independent -- no cross-caller collision", async () => {
    const fx = await buildConvergenceFixture();
    const otherFx = await buildConvergenceFixture();
    const key = idempotencyKey();
    const first = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: key,
    });
    const second = await requestService.create(otherFx.educator, {
      sourceTenantId: otherFx.sourceTenantId,
      targetTenantId: otherFx.targetTenantId,
      idempotencyKey: key,
    });
    expect(second.id).not.toBe(first.id);
  });
});

describe("Active-attempt guard at execute() (02_38 v1.4 §12/§10.2bis)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("a TRANSFER-decision class with an IN_PROGRESS learning_attempt blocks execute() with CONVERGENCE_ACTIVE_ATTEMPTS_PENDING, leaving the request APPROVED (never EXECUTING/COMPLETED)", async () => {
    const fx = await buildConvergenceFixture();
    const classId = await createClass(fx.sourceTenantId, "Blocked Class");
    const studentProfileId = await createStudent(fx.sourceTenantId);
    const enrollmentId = await enrollStudent(fx.sourceTenantId, classId, studentProfileId, "Blocked Student");
    const contentBundleId = await createContentBundle();
    const assignmentId = await createAssignment(fx.sourceTenantId, classId, contentBundleId);
    await createInProgressAttempt(fx.sourceTenantId, assignmentId, studentProfileId, enrollmentId, contentBundleId);

    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await createPlatformAdmin("attempts-admin@example.org");
    const platform = await platformIdentity("attempts-admin@example.org");

    const plan = await previewService.preview(platform, created.id);
    expect(plan.activeAttemptsSnapshot.some((a) => a.classId === classId)).toBe(true);

    await approvalService.approve(fx.educator, created.id, {
      migrationPlanFingerprint: plan.fingerprint,
      classDecisions: [{ classId, decision: "TRANSFER" }],
    });
    await approvalService.approve(fx.schoolAdmin, created.id, { migrationPlanFingerprint: plan.fingerprint });

    await expect(executionService.execute(platform, created.id, idempotencyKey())).rejects.toMatchObject({
      code: "CONVERGENCE_ACTIVE_ATTEMPTS_PENDING",
    });

    const reread = await requestRepo.findById(created.id);
    expect(reread?.status).toBe("APPROVED");
  });
});

describe("ContentPromotionService.promote() -- disclosed gap, not a bug (content-promotion-service.ts)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("throws CONTENT_NOT_FOUND even for a fully valid, approved PROMOTE decision, since no owned-content table exists yet in this schema (02_37 Authoring not implemented -- documented, disclosed gap)", async () => {
    const fx = await buildConvergenceFixture();
    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await createPlatformAdmin("promote-admin@example.org");
    const platform = await platformIdentity("promote-admin@example.org");
    const plan = await previewService.preview(platform, created.id);
    const contentId = randomUUID();

    await approvalService.approve(fx.educator, created.id, {
      migrationPlanFingerprint: plan.fingerprint,
      ownershipDecisions: [{ resourceId: contentId, decision: "PROMOTE" }],
    });
    await approvalService.approve(fx.schoolAdmin, created.id, { migrationPlanFingerprint: plan.fingerprint });

    const approved = await requestRepo.findById(created.id);
    expect(approved?.status).toBe("APPROVED");

    await expect(promotionService.promote(fx.schoolAdmin, contentId, created.id, idempotencyKey())).rejects.toMatchObject({
      code: "CONTENT_NOT_FOUND",
    });
  });
});

describe("TenantContextService.switchTenant() (02_35 v1.5 §11quater.5)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("switching to a tenant with no ACTIVE membership fails with STAFF_FORBIDDEN", async () => {
    const fx = await buildConvergenceFixture();
    const unrelatedTenantId = await createTenant("SCHOOL", "Unrelated");
    await expect(tenantContextService.switchTenant(fx.educator, unrelatedTenantId)).rejects.toMatchObject({
      code: "STAFF_FORBIDDEN",
    });
  });

  it("switching to a tenant with an ACTIVE membership succeeds: the OLD staff_session is revoked ROTATED, a NEW session exists scoped to the new tenant/membership", async () => {
    const sourceTenantId = await createTenant("INDEPENDENT_EDUCATOR", "Multi-Tenant Educator Source");
    const targetTenantId = await createTenant("SCHOOL", "Multi-Tenant Educator Target");
    const staffAccountId = await createStaffAccount(`multi-${rnd()}@example.org`);
    const sourceMembershipId = await createMembership(staffAccountId, sourceTenantId, "INDEPENDENT_EDUCATOR");
    const targetMembershipId = await createMembership(staffAccountId, targetTenantId, "TEACHER");
    const oldSessionId = await createStaffSession(staffAccountId, sourceTenantId, sourceMembershipId);
    const identity = staffIdentity({
      staffAccountId,
      tenantId: sourceTenantId,
      staffTenantMembershipId: sourceMembershipId,
      role: "INDEPENDENT_EDUCATOR",
      classScope: null,
      sessionId: oldSessionId,
    });

    const result = await tenantContextService.switchTenant(identity, targetTenantId);
    expect(result.tenantId).toBe(targetTenantId);
    expect(result.role).toBe("TEACHER");

    const oldSession = await pool.query<{ revoked_at: Date | null; revoked_reason: string | null }>(
      `SELECT revoked_at, revoked_reason FROM staff_session WHERE id = $1`,
      [oldSessionId],
    );
    expect(oldSession.rows[0]!.revoked_at).not.toBeNull();
    expect(oldSession.rows[0]!.revoked_reason).toBe("ROTATED");

    const newSession = await pool.query<{ staff_tenant_membership_id: string }>(
      `SELECT staff_tenant_membership_id FROM staff_session WHERE staff_account_id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
      [staffAccountId, targetTenantId],
    );
    expect(newSession.rows).toHaveLength(1);
    expect(newSession.rows[0]!.staff_tenant_membership_id).toBe(targetMembershipId);
  });
});

describe("Rollback review: partial failure -> ROLLBACK_REVIEW_REQUIRED -> ACCEPT_PARTIAL -> COMPLETED (02_38 v1.4 §10.5)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("preserves the successfully migrated class while leaving the conflicting class's data untouched on the source tenant", async () => {
    const fx = await buildConvergenceFixture();

    const classSucceed = await createClass(fx.sourceTenantId, "Succeeds");
    const okStudent = await createStudent(fx.sourceTenantId);
    await enrollStudent(fx.sourceTenantId, classSucceed, okStudent, "OkStudent");

    const classFail = await createClass(fx.sourceTenantId, "Fails");
    // classUntouched deliberately gets NO decision at approve() time --
    // execute() only iterates plan.classDecisions, so it is never
    // migrated and permanently keeps conflictedStudent's enrollment on
    // the source tenant. Two MUTUALLY TRANSFER-decision classes sharing
    // a student would instead make BOTH units fail symmetrically
    // (transferClass's conflict check in convergence-execution-service.ts
    // finds the other class's still-active enrollment regardless of
    // processing order, since a failed transfer rolls back and leaves the
    // enrollment right where the other side's check will see it again) --
    // an untouched third class is what makes exactly one unit fail
    // deterministically, matching this scenario's "one succeeds, one
    // fails" requirement.
    const classUntouched = await createClass(fx.sourceTenantId, "Untouched");
    const conflictedStudent = await createStudent(fx.sourceTenantId);
    await enrollStudent(fx.sourceTenantId, classFail, conflictedStudent, "ConflictedStudent");
    const untouchedEnrollmentId = await enrollStudent(fx.sourceTenantId, classUntouched, conflictedStudent, "ConflictedStudentElsewhere");

    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await createPlatformAdmin("rollback-admin@example.org");
    const platform = await platformIdentity("rollback-admin@example.org");
    const plan = await previewService.preview(platform, created.id);

    await approvalService.approve(fx.educator, created.id, {
      migrationPlanFingerprint: plan.fingerprint,
      classDecisions: [
        { classId: classSucceed, decision: "TRANSFER" },
        { classId: classFail, decision: "TRANSFER" },
      ],
    });
    await approvalService.approve(fx.schoolAdmin, created.id, { migrationPlanFingerprint: plan.fingerprint });

    const executed = await executeConvergence(platform, created.id, idempotencyKey());
    expect(executed.status).toBe("ROLLBACK_REVIEW_REQUIRED");
    expect(executed.unitsFailed).toBeGreaterThan(0);
    expect(executed.unitsMigrated).toBeGreaterThan(0);

    const midway = await requestRepo.findById(created.id);
    expect(midway?.status).toBe("ROLLBACK_REVIEW_REQUIRED");

    const resolved = await rollbackService.resolve(platform, created.id, "ACCEPT_PARTIAL");
    expect(resolved.status).toBe("COMPLETED");

    // Successful unit's migration preserved.
    const succeedClassRow = await pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM school_class WHERE id = $1`, [
      classSucceed,
    ]);
    expect(succeedClassRow.rows[0]!.tenant_id).toBe(fx.targetTenantId);

    // Failed unit's data untouched -- still on the source tenant.
    const failClassRow = await pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM school_class WHERE id = $1`, [classFail]);
    expect(failClassRow.rows[0]!.tenant_id).toBe(fx.sourceTenantId);
    const conflictedEnrollmentRow = await pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM school_enrollment WHERE student_profile_id = $1 AND class_id = $2`,
      [conflictedStudent, classFail],
    );
    expect(conflictedEnrollmentRow.rows[0]!.tenant_id).toBe(fx.sourceTenantId);
    const untouchedRow = await pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM school_enrollment WHERE id = $1`, [
      untouchedEnrollmentId,
    ]);
    expect(untouchedRow.rows[0]!.tenant_id).toBe(fx.sourceTenantId);

    // currentMigrationExecutionId is only set on the request row once
    // execute() runs (not on the pre-execute `created` snapshot) --
    // re-read the request to reach the execution row it points to.
    const finalRequest = await requestRepo.findById(created.id);
    const finalExecution = finalRequest?.currentMigrationExecutionId
      ? await executionRepo.findById(finalRequest.currentMigrationExecutionId)
      : null;
    expect(finalExecution?.status).toBe("COMPLETED");
    expect(finalExecution?.rollbackReviewStatus).toBe("ACCEPTED_PARTIAL");
  });
});

describe("RETRY_REMAINING resumes from checkpoint (02_38 v1.4 §10.5, ConvergenceRollbackReviewService's contract)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("a second execute() after RETRY_REMAINING reuses the same convergenceRunId, only retries the previously-FAILED class, and never re-migrates or re-audits the class that already succeeded", async () => {
    const fx = await buildConvergenceFixture();

    const classSucceed = await createClass(fx.sourceTenantId, "Succeeds first time");
    const okStudent = await createStudent(fx.sourceTenantId);
    await enrollStudent(fx.sourceTenantId, classSucceed, okStudent, "OkStudent");

    // Same deterministic single-failure setup as the ACCEPT_PARTIAL test
    // above: a third, undecided class shares a student with classFail so
    // exactly classFail's transfer fails on the first execute() call.
    const classFail = await createClass(fx.sourceTenantId, "Fails then retried");
    const classUntouched = await createClass(fx.sourceTenantId, "Conflict source");
    const conflictedStudent = await createStudent(fx.sourceTenantId);
    const failEnrollmentId = await enrollStudent(fx.sourceTenantId, classFail, conflictedStudent, "ConflictedStudent");
    await enrollStudent(fx.sourceTenantId, classUntouched, conflictedStudent, "ConflictedStudentElsewhere");

    const created = await requestService.create(fx.educator, {
      sourceTenantId: fx.sourceTenantId,
      targetTenantId: fx.targetTenantId,
      idempotencyKey: idempotencyKey(),
    });
    await createPlatformAdmin("retry-admin@example.org");
    const platform = await platformIdentity("retry-admin@example.org");
    const plan = await previewService.preview(platform, created.id);

    await approvalService.approve(fx.educator, created.id, {
      migrationPlanFingerprint: plan.fingerprint,
      classDecisions: [
        { classId: classSucceed, decision: "TRANSFER" },
        { classId: classFail, decision: "TRANSFER" },
      ],
    });
    await approvalService.approve(fx.schoolAdmin, created.id, { migrationPlanFingerprint: plan.fingerprint });

    const firstExecution = await executeConvergence(platform, created.id, idempotencyKey());
    expect(firstExecution.status).toBe("ROLLBACK_REVIEW_REQUIRED");
    expect(firstExecution.unitsFailed).toBe(1);
    expect(firstExecution.unitsMigrated).toBe(2); // membership + classSucceed

    // classSucceed already migrated -- confirm exactly one audit event
    // before the retry, so a post-retry re-check proves no duplicate.
    const migratedAuditBeforeRetry = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM audit_event WHERE action = 'convergence.unit_migrated' AND target_id = $1`,
      [classSucceed],
    );
    expect(migratedAuditBeforeRetry.rows[0]!.count).toBe("1");

    const reviewed = await rollbackService.resolve(platform, created.id, "RETRY_REMAINING");
    expect(reviewed.status).toBe("READY_TO_EXECUTE");

    // Resolve the real-world conflict an operator would fix before
    // retrying: remove the student's enrollment from the OTHER class
    // entirely (not merely flip its status) -- once classFail's transfer
    // moves conflictedStudent's student_profile.tenant_id to the target
    // tenant, ANY remaining school_enrollment row for that student still
    // pointing at the source tenant (even a LEFT one) would permanently
    // violate the composite FK school_enrollment(student_profile_id,
    // tenant_id) -> student_profile(id, tenant_id), deferred or not.
    await pool.query(`DELETE FROM school_enrollment WHERE class_id = $1 AND student_profile_id = $2`, [
      classUntouched,
      conflictedStudent,
    ]);

    const secondExecution = await executeConvergence(platform, created.id, idempotencyKey());
    expect(secondExecution.status).toBe("COMPLETED");
    expect(secondExecution.unitsFailed).toBe(0);
    expect(secondExecution.unitsMigrated).toBe(3); // membership + classSucceed (carried forward) + classFail (now migrated)
    expect(secondExecution.convergenceRunId).toBe(firstExecution.convergenceRunId);

    // The retried class actually transferred this time.
    const failClassRow = await pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM school_class WHERE id = $1`, [classFail]);
    expect(failClassRow.rows[0]!.tenant_id).toBe(fx.targetTenantId);
    const failEnrollmentRow = await pool.query<{ tenant_id: string }>(`SELECT tenant_id FROM school_enrollment WHERE id = $1`, [
      failEnrollmentId,
    ]);
    expect(failEnrollmentRow.rows[0]!.tenant_id).toBe(fx.targetTenantId);

    // classSucceed was carried forward, never re-transferred/re-audited.
    const migratedAuditAfterRetry = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM audit_event WHERE action = 'convergence.unit_migrated' AND target_id = $1`,
      [classSucceed],
    );
    expect(migratedAuditAfterRetry.rows[0]!.count).toBe("1");

    // The membership unit was likewise carried forward, not re-created/re-audited.
    const membershipAuditAfterRetry = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM audit_event WHERE action = 'convergence.unit_migrated' AND target_type = 'staff_tenant_membership'`,
    );
    expect(membershipAuditAfterRetry.rows[0]!.count).toBe("1");
  });
});

describe("StaffAuthService.start() tenantId disambiguation (multi-membership login, FVR-style bug found during Tranche D closure)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  async function seedTwoMembershipAccount(): Promise<{ email: string; sourceTenantId: string; targetTenantId: string }> {
    const email = `multi-membership-${rnd()}@example.org`;
    const sourceTenantId = await createTenant("INDEPENDENT_EDUCATOR", "Login Test Source");
    const targetTenantId = await createTenant("SCHOOL", "Login Test Target");
    const accountResult = await pool.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      [email, await hashPassword(PASSWORD)],
    );
    const staffAccountId = accountResult.rows[0]!.id;
    await createMembership(staffAccountId, sourceTenantId, "INDEPENDENT_EDUCATOR");
    await createMembership(staffAccountId, targetTenantId, "TEACHER");
    return { email, sourceTenantId, targetTenantId };
  }

  it("resolves a real membership's tenantId even when the caller sends it uppercase (as many SQL clients render UUIDs)", async () => {
    const authService = new StaffAuthService(pool);
    const { email, targetTenantId } = await seedTwoMembershipAccount();

    const result = await authService.start({ email, password: PASSWORD, tenantId: targetTenantId.toUpperCase(), clientIp: "127.0.0.1" });
    expect(result.tenantId).toBe(targetTenantId);
    expect(result.role).toBe("TEACHER");
  });

  it("resolves a real membership's tenantId even with surrounding whitespace", async () => {
    const authService = new StaffAuthService(pool);
    const { email, sourceTenantId } = await seedTwoMembershipAccount();

    const result = await authService.start({ email, password: PASSWORD, tenantId: `  ${sourceTenantId}  `, clientIp: "127.0.0.1" });
    expect(result.tenantId).toBe(sourceTenantId);
    expect(result.role).toBe("INDEPENDENT_EDUCATOR");
  });

  it("still rejects a tenantId that genuinely does not match any of the account's memberships (control case)", async () => {
    const authService = new StaffAuthService(pool);
    const { email } = await seedTwoMembershipAccount();
    const unrelatedTenantId = await createTenant("SCHOOL", "Genuinely Unrelated");

    await expect(authService.start({ email, password: PASSWORD, tenantId: unrelatedTenantId, clientIp: "127.0.0.1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

afterAll(async () => {
  await pool.end();
});
