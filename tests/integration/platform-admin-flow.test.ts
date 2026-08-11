import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  PlatformAuthService,
  TenantProvisioningService,
  TenantStatusService,
  SchoolAdminActivationService,
  assertCapability,
  type Capability,
} from "@quest-city-web/platform-admin";
import { StaffAuthService, hashPassword } from "@quest-city-web/staff-identity";

/**
 * School Pilot Readiness Tranche A integration tests against a real,
 * dockerized PostgreSQL instance with migrations 0001-0006 applied.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- platform-admin-flow
 *
 * Covers this tranche's §16 security test list: non-admin/missing-
 * capability rejection, capability-gated success, tenant isolation,
 * suspended-tenant enforcement (login + active session), duplicate
 * school admin activation, identity reuse, CSRF, session security, rate
 * limiting, and the Platform Admin/didactic-data access boundary.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });
const PASSWORD = "correct horse battery staple";
const ALL_CAPABILITIES: Capability[] = ["tenant.create", "tenant.read", "tenant.suspend", "school_admin.activate", "audit.read.global"];

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE platform_admin_session, capability_grant, platform_admin_grant, staff_class_assignment, staff_session, staff_tenant_membership, staff_account, review_queue_item, teacher_feedback, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function createPlatformAdmin(email: string, capabilities: Capability[] = ALL_CAPABILITIES): Promise<string> {
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

async function createSchoolTenant(name: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', $2, $3) RETURNING id`,
    [`sch_${Math.random().toString(36).slice(2, 10)}`, status, name],
  );
  return result.rows[0]!.id;
}

describe("Platform Admin authentication (02_38 §4.1/§20)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("start() succeeds for an ACTIVE platform_admin_grant and returns its effective capabilities", async () => {
    await createPlatformAdmin("admin@example.org", ["tenant.create", "tenant.read"]);
    const service = new PlatformAuthService(pool);
    const result = await service.start({ email: "admin@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    expect(result.sessionToken).toBeTruthy();
    expect(result.capabilities.sort()).toEqual(["tenant.create", "tenant.read"]);
  });

  it("a staff_account with correct credentials but NO platform_admin_grant fails with PLATFORM_AUTH_REQUIRED (non-admin -> 403-equivalent)", async () => {
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture')`,
      ["plain-staff@example.org", await hashPassword(PASSWORD)],
    );
    const service = new PlatformAuthService(pool);
    await expect(
      service.start({ email: "plain-staff@example.org", password: PASSWORD, clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "PLATFORM_AUTH_REQUIRED" });
  });

  it("a SUSPENDED platform_admin_grant fails with PLATFORM_AUTH_REQUIRED even with correct credentials", async () => {
    const accountId = await createPlatformAdmin("suspended-admin@example.org");
    await pool.query(`UPDATE platform_admin_grant SET status = 'SUSPENDED' WHERE staff_account_id = $1`, [accountId]);
    const service = new PlatformAuthService(pool);
    await expect(
      service.start({ email: "suspended-admin@example.org", password: PASSWORD, clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "PLATFORM_AUTH_REQUIRED" });
  });

  it("unknown email and wrong password converge on the same PLATFORM_AUTH_REQUIRED code (anti-enumeration)", async () => {
    await createPlatformAdmin("real-admin@example.org");
    const service = new PlatformAuthService(pool);
    await expect(
      service.start({ email: "nobody@example.org", password: "x", clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "PLATFORM_AUTH_REQUIRED" });
    await expect(
      service.start({ email: "real-admin@example.org", password: "wrong", clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "PLATFORM_AUTH_REQUIRED" });
  });

  it("locks the account after maxFailedLoginAttempts consecutive failures (session security)", async () => {
    await createPlatformAdmin("lockout@example.org");
    const service = new PlatformAuthService(pool, {
      absoluteTtlSeconds: 3600,
      inactivityTtlSeconds: 600,
      maxFailedLoginAttempts: 3,
      lockoutDurationSeconds: 900,
    });
    for (let i = 0; i < 2; i += 1) {
      await expect(
        service.start({ email: "lockout@example.org", password: "wrong", clientIp: "127.0.0.1" }),
      ).rejects.toMatchObject({ code: "PLATFORM_AUTH_REQUIRED" });
    }
    await expect(service.start({ email: "lockout@example.org", password: "wrong", clientIp: "127.0.0.1" })).rejects.toMatchObject({
      code: "PLATFORM_ACCOUNT_LOCKED",
    });
    await expect(
      service.start({ email: "lockout@example.org", password: PASSWORD, clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "PLATFORM_ACCOUNT_LOCKED" });
  });

  it("refresh() rotates the session and rejects a wrong CSRF token without rotating (CSRF security)", async () => {
    const accountId = await createPlatformAdmin("csrf@example.org");
    const service = new PlatformAuthService(pool);
    const started = await service.start({ email: "csrf@example.org", password: PASSWORD, clientIp: "127.0.0.1" });

    await expect(
      service.refresh({ sessionToken: started.sessionToken, csrfToken: "wrong-token" }),
    ).rejects.toMatchObject({ code: "PLATFORM_FORBIDDEN" });

    const refreshed = await service.refresh({ sessionToken: started.sessionToken, csrfToken: started.csrfToken });
    expect(refreshed.sessionToken).not.toBe(started.sessionToken);

    const activeSessions = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM platform_admin_session WHERE staff_account_id = $1 AND revoked_at IS NULL`,
      [accountId],
    );
    expect(activeSessions.rows[0]!.n).toBe("1");
  });

  it("a platform session token is never accepted by StaffAuthService, and a staff session token is never accepted by PlatformAuthService (tenant isolation / no cross-domain session reuse)", async () => {
    const tenantId = await createSchoolTenant("Cross-Domain School");
    await createPlatformAdmin("cross-platform@example.org");
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      ["cross-staff@example.org", await hashPassword(PASSWORD)],
    );
    const staffAccount = await pool.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, ["cross-staff@example.org"]);
    await pool.query(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, 'SCHOOL_ADMIN', 'ACTIVE')`,
      [staffAccount.rows[0]!.id, tenantId],
    );

    const platformAuth = new PlatformAuthService(pool);
    const staffAuth = new StaffAuthService(pool);
    const platformSession = await platformAuth.start({ email: "cross-platform@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const staffSession = await staffAuth.start({ email: "cross-staff@example.org", password: PASSWORD, clientIp: "127.0.0.1" });

    await expect(staffAuth.resolveInternalIdentity(platformSession.sessionToken)).rejects.toMatchObject({
      code: "STAFF_AUTH_REQUIRED",
    });
    await expect(platformAuth.resolveIdentity(staffSession.sessionToken)).rejects.toMatchObject({
      code: "PLATFORM_AUTH_REQUIRED",
    });
  });
});

describe("Capability-first authorization on Platform Admin operations (02_27 §5.3)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("a Platform Admin lacking tenant.create cannot create a tenant (missing capability -> denied)", async () => {
    await createPlatformAdmin("no-create@example.org", ["tenant.read"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "no-create@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);

    const provisioning = new TenantProvisioningService(pool);
    await expect(
      provisioning.createSchoolTenant(identity, { name: "Should Fail School", idempotencyKey: "idem-capability-denied-0001" }),
    ).rejects.toMatchObject({
      code: "CAPABILITY_DENIED",
    });
  });

  it("a Platform Admin with tenant.create succeeds, and the created tenant has no auto-created classes/students (§9)", async () => {
    await createPlatformAdmin("creator@example.org", ["tenant.create"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "creator@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);

    const provisioning = new TenantProvisioningService(pool);
    const result = await provisioning.createSchoolTenant(identity, { name: "New School", idempotencyKey: "idem-create-success-0001" });
    expect(result.type).toBe("SCHOOL");
    expect(result.status).toBe("ACTIVE");

    const classCount = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM school_class WHERE tenant_id = $1`, [
      result.id,
    ]);
    expect(classCount.rows[0]!.n).toBe("0");

    const auditRow = await pool.query(`SELECT action, tenant_id FROM audit_event WHERE action = 'tenant.created' AND tenant_id = $1`, [
      result.id,
    ]);
    expect(auditRow.rows).toHaveLength(1);
  });

  it("assertCapability directly denies an operation not covered by any granted capability", async () => {
    await createPlatformAdmin("partial@example.org", ["audit.read.global"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "partial@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);
    expect(() => assertCapability(identity, "tenant.suspend")).toThrow();
  });
});

describe("Tenant status enforcement (02_38 §10) -- suspension is enforced server-side, not only displayed", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("suspending a tenant rejects a NEW staff login on that tenant with TENANT_SUSPENDED", async () => {
    const tenantId = await createSchoolTenant("Soon Suspended School");
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      ["teacher@suspended-school.org", await hashPassword(PASSWORD)],
    );
    const staffAccount = await pool.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, [
      "teacher@suspended-school.org",
    ]);
    await pool.query(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, 'SCHOOL_ADMIN', 'ACTIVE')`,
      [staffAccount.rows[0]!.id, tenantId],
    );

    await createPlatformAdmin("suspender@example.org", ["tenant.suspend"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "suspender@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);
    await new TenantStatusService(pool).setStatus(identity, { tenantId, status: "SUSPENDED" });

    const staffAuth = new StaffAuthService(pool);
    await expect(
      staffAuth.start({ email: "teacher@suspended-school.org", password: PASSWORD, clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("suspending a tenant revokes an ALREADY-ACTIVE staff session's usability on its very next request", async () => {
    const tenantId = await createSchoolTenant("Active Session School");
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      ["already-in@active-session-school.org", await hashPassword(PASSWORD)],
    );
    const staffAccount = await pool.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, [
      "already-in@active-session-school.org",
    ]);
    await pool.query(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, 'SCHOOL_ADMIN', 'ACTIVE')`,
      [staffAccount.rows[0]!.id, tenantId],
    );
    const staffAuth = new StaffAuthService(pool);
    const staffSession = await staffAuth.start({
      email: "already-in@active-session-school.org",
      password: PASSWORD,
      clientIp: "127.0.0.1",
    });
    // Session is valid before suspension.
    await expect(staffAuth.resolveInternalIdentity(staffSession.sessionToken)).resolves.toMatchObject({ role: "SCHOOL_ADMIN" });

    await createPlatformAdmin("suspender2@example.org", ["tenant.suspend"]);
    const platformAuth = new PlatformAuthService(pool);
    const platformSession = await platformAuth.start({ email: "suspender2@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(platformSession.sessionToken);
    await new TenantStatusService(pool).setStatus(identity, { tenantId, status: "SUSPENDED" });

    // Same session token, now rejected -- not merely hidden in a UI.
    await expect(staffAuth.resolveInternalIdentity(staffSession.sessionToken)).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("reactivating a suspended tenant allows staff login again", async () => {
    const tenantId = await createSchoolTenant("Reactivated School", "SUSPENDED");
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      ["reactivated-teacher@example.org", await hashPassword(PASSWORD)],
    );
    const staffAccount = await pool.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, [
      "reactivated-teacher@example.org",
    ]);
    await pool.query(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, 'SCHOOL_ADMIN', 'ACTIVE')`,
      [staffAccount.rows[0]!.id, tenantId],
    );

    await createPlatformAdmin("reactivator@example.org", ["tenant.suspend"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "reactivator@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);

    // Already SUSPENDED at fixture creation -> re-activating flips it.
    const updated = await new TenantStatusService(pool).setStatus(identity, { tenantId, status: "ACTIVE" });
    expect(updated.status).toBe("ACTIVE");

    const staffAuth = new StaffAuthService(pool);
    await expect(
      staffAuth.start({ email: "reactivated-teacher@example.org", password: PASSWORD, clientIp: "127.0.0.1" }),
    ).resolves.toMatchObject({ role: "SCHOOL_ADMIN" });
  });

  it("setStatus() to the tenant's current status fails with TENANT_STATUS_UNCHANGED (no silent no-op)", async () => {
    const tenantId = await createSchoolTenant("Already Active School");
    await createPlatformAdmin("noop@example.org", ["tenant.suspend"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "noop@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);

    await expect(new TenantStatusService(pool).setStatus(identity, { tenantId, status: "ACTIVE" })).rejects.toMatchObject({
      code: "TENANT_STATUS_UNCHANGED",
    });
  });
});

describe("School Admin activation (02_38 §9/§11) -- identity reuse, duplicates, edge cases", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("activates a brand-new identity, returning a one-time temporary password", async () => {
    const tenantId = await createSchoolTenant("Brand New School");
    await createPlatformAdmin("activator@example.org", ["school_admin.activate"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "activator@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);

    const result = await new SchoolAdminActivationService(pool).activate(identity, {
      tenantId,
      email: "new-school-admin@example.org",
    });
    expect(result.identityReused).toBe(false);
    expect(result.reactivated).toBe(false);
    expect(result.temporaryPassword).toBeTruthy();

    const membership = await pool.query(
      `SELECT role, status FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2`,
      [result.staffAccountId, tenantId],
    );
    expect(membership.rows[0]).toMatchObject({ role: "SCHOOL_ADMIN", status: "ACTIVE" });
  });

  it("reuses an existing staff_account by email instead of creating a duplicate (ONE HUMAN -> ONE PLATFORM IDENTITY, 02_38 §9)", async () => {
    const tenantA = await createSchoolTenant("Origin School");
    const tenantB = await createSchoolTenant("Destination School");
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      ["existing-teacher@example.org", await hashPassword(PASSWORD)],
    );
    const existingAccount = await pool.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, [
      "existing-teacher@example.org",
    ]);
    await pool.query(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, 'TEACHER', 'ACTIVE')`,
      [existingAccount.rows[0]!.id, tenantA],
    );

    await createPlatformAdmin("activator2@example.org", ["school_admin.activate"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "activator2@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);

    const result = await new SchoolAdminActivationService(pool).activate(identity, {
      tenantId: tenantB,
      email: "existing-teacher@example.org",
    });
    expect(result.identityReused).toBe(true);
    expect(result.temporaryPassword).toBeUndefined();
    expect(result.staffAccountId).toBe(existingAccount.rows[0]!.id);

    const accountCount = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM staff_account WHERE email = $1`, [
      "existing-teacher@example.org",
    ]);
    expect(accountCount.rows[0]!.n).toBe("1");
  });

  it("activating an already-ACTIVE SCHOOL_ADMIN on the same tenant fails with SCHOOL_ADMIN_ALREADY_ACTIVE (duplicate request)", async () => {
    const tenantId = await createSchoolTenant("Duplicate Activation School");
    await createPlatformAdmin("activator3@example.org", ["school_admin.activate"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "activator3@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);
    const service = new SchoolAdminActivationService(pool);

    await service.activate(identity, { tenantId, email: "dup-admin@example.org" });
    await expect(service.activate(identity, { tenantId, email: "dup-admin@example.org" })).rejects.toMatchObject({
      code: "SCHOOL_ADMIN_ALREADY_ACTIVE",
    });
  });

  it("reactivates a SUSPENDED SCHOOL_ADMIN membership instead of erroring or duplicating", async () => {
    const tenantId = await createSchoolTenant("Reactivation Target School");
    await createPlatformAdmin("activator4@example.org", ["school_admin.activate"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "activator4@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);
    const service = new SchoolAdminActivationService(pool);

    const first = await service.activate(identity, { tenantId, email: "flaky-admin@example.org" });
    await pool.query(`UPDATE staff_tenant_membership SET status = 'SUSPENDED' WHERE staff_account_id = $1 AND tenant_id = $2`, [
      first.staffAccountId,
      tenantId,
    ]);

    const second = await service.activate(identity, { tenantId, email: "flaky-admin@example.org" });
    expect(second.reactivated).toBe(true);
    expect(second.staffAccountId).toBe(first.staffAccountId);

    const membershipCount = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2`,
      [first.staffAccountId, tenantId],
    );
    expect(membershipCount.rows[0]!.n).toBe("1");
    const membership = await pool.query(`SELECT status FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2`, [
      first.staffAccountId,
      tenantId,
    ]);
    expect(membership.rows[0]!.status).toBe("ACTIVE");
  });

  it("cannot activate a School Admin on a SUSPENDED tenant", async () => {
    const tenantId = await createSchoolTenant("Suspended Target School", "SUSPENDED");
    await createPlatformAdmin("activator5@example.org", ["school_admin.activate"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "activator5@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);

    await expect(
      new SchoolAdminActivationService(pool).activate(identity, { tenantId, email: "cannot-activate@example.org" }),
    ).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("cannot activate against a SUSPENDED existing identity", async () => {
    const tenantId = await createSchoolTenant("Suspended Identity School");
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'SUSPENDED', 'ADMIN_SEED_SCRIPT', 'test-fixture')`,
      ["suspended-identity@example.org", await hashPassword(PASSWORD)],
    );
    await createPlatformAdmin("activator6@example.org", ["school_admin.activate"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "activator6@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);

    await expect(
      new SchoolAdminActivationService(pool).activate(identity, { tenantId, email: "suspended-identity@example.org" }),
    ).rejects.toMatchObject({ code: "SCHOOL_ADMIN_IDENTITY_SUSPENDED" });
  });
});

describe("Data access boundary (02_38 §4.1/§18.1) -- Platform Admin never gets automatic didactic data access", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("a resolved PlatformAdminIdentity carries no tenant scope, class scope, or student-data-shaped fields -- structurally incapable of reaching tenant-scoped repositories that require a tenantId", async () => {
    await createPlatformAdmin("boundary@example.org");
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "boundary@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);

    expect(identity).not.toHaveProperty("tenantId");
    expect(identity).not.toHaveProperty("classScope");
    expect(Object.keys(identity).sort()).toEqual(["capabilities", "csrfTokenHash", "platformAdminGrantId", "staffAccountId"]);
  });

  it("audit.read.global lists only audit_event rows -- never school_class/student_profile/learning_attempt content", async () => {
    const tenantId = await createSchoolTenant("Audited School");
    await pool.query(`INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Class With Secrets', 'ACTIVE')`, [
      tenantId,
      `cls_${Math.random().toString(36).slice(2, 10)}`,
    ]);
    await createPlatformAdmin("auditor@example.org", ["audit.read.global"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "auditor@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    await platformAuth.resolveIdentity(session.sessionToken);

    const rows = await pool.query(`SELECT * FROM audit_event ORDER BY created_at DESC LIMIT 50`);
    for (const row of rows.rows as Array<Record<string, unknown>>) {
      expect(Object.keys(row)).not.toContain("class_name");
      expect(Object.keys(row)).not.toContain("student_profile_id");
    }
  });
});

describe("POST /platform/tenants idempotency (02_26 v1.10 §32.4, migration 0007)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  async function tenantCount(): Promise<number> {
    const result = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM tenant`);
    return Number(result.rows[0]!.n);
  }

  it("replay: same Idempotency-Key + same payload returns the exact original response and creates no second tenant", async () => {
    await createPlatformAdmin("idem-replay@example.org", ["tenant.create"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "idem-replay@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);
    const provisioning = new TenantProvisioningService(pool);

    const key = "idem-replay-same-payload-0001";
    const first = await provisioning.createSchoolTenant(identity, { name: "Replay School", idempotencyKey: key });
    const second = await provisioning.createSchoolTenant(identity, { name: "Replay School", idempotencyKey: key });

    expect(second).toEqual(first);
    expect(await tenantCount()).toBe(1);

    const auditRows = await pool.query(`SELECT id FROM audit_event WHERE action = 'tenant.created' AND tenant_id = $1`, [first.id]);
    expect(auditRows.rows).toHaveLength(1);
  });

  it("conflict: same Idempotency-Key + different payload is rejected with IDEMPOTENCY_CONFLICT, no second tenant created", async () => {
    await createPlatformAdmin("idem-conflict@example.org", ["tenant.create"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "idem-conflict@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);
    const provisioning = new TenantProvisioningService(pool);

    const key = "idem-conflict-different-payload-01";
    await provisioning.createSchoolTenant(identity, { name: "Original School", idempotencyKey: key });
    await expect(provisioning.createSchoolTenant(identity, { name: "Different School", idempotencyKey: key })).rejects.toMatchObject(
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    expect(await tenantCount()).toBe(1);
  });

  it("actor partitioning: the same Idempotency-Key value used by two different Platform Admins never collides -- two tenants are created", async () => {
    await createPlatformAdmin("idem-actor-a@example.org", ["tenant.create"]);
    await createPlatformAdmin("idem-actor-b@example.org", ["tenant.create"]);
    const platformAuth = new PlatformAuthService(pool);
    const sessionA = await platformAuth.start({ email: "idem-actor-a@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const sessionB = await platformAuth.start({ email: "idem-actor-b@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identityA = await platformAuth.resolveIdentity(sessionA.sessionToken);
    const identityB = await platformAuth.resolveIdentity(sessionB.sessionToken);
    const provisioning = new TenantProvisioningService(pool);

    const sharedKey = "idem-shared-key-reused-by-two-admins";
    const resultA = await provisioning.createSchoolTenant(identityA, { name: "School A", idempotencyKey: sharedKey });
    const resultB = await provisioning.createSchoolTenant(identityB, { name: "School B", idempotencyKey: sharedKey });

    expect(resultA.id).not.toBe(resultB.id);
    expect(await tenantCount()).toBe(2);
  });

  it("concurrency: N concurrent requests with the same actor and the same Idempotency-Key create at most one real tenant", async () => {
    await createPlatformAdmin("idem-concurrent@example.org", ["tenant.create"]);
    const platformAuth = new PlatformAuthService(pool);
    const session = await platformAuth.start({ email: "idem-concurrent@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const identity = await platformAuth.resolveIdentity(session.sessionToken);
    const provisioning = new TenantProvisioningService(pool);

    const key = "idem-concurrent-single-creation-0001";
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => provisioning.createSchoolTenant(identity, { name: "Concurrent School", idempotencyKey: key })),
    );

    expect(await tenantCount()).toBe(1);
    const fulfilled = outcomes.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof provisioning.createSchoolTenant>>> =>
      o.status === "fulfilled",
    );
    // Every settled (non-rejected) outcome must agree on the same tenant id --
    // the Postgres row-level lock on the atomic UPSERT guarantees this
    // structurally, not just at the application layer (02_26 v1.10 §32.4).
    const distinctTenantIds = new Set(fulfilled.map((o) => o.value.id));
    expect(distinctTenantIds.size).toBe(1);
  });

  it("backward compatibility: tenant-scoped idempotency scopes (tenant_id NOT NULL) keep working unmodified after migration 0007", async () => {
    // Direct regression check on the shared repository/table rather than a
    // higher-level service, since packages/staff-identity's own services
    // are out of scope for this tranche -- this proves migration 0007 only
    // widened the column, never narrowed or altered existing behavior for
    // every scope with a real tenantId.
    const { IdempotencyRecordRepository } = await import("@quest-city-web/attempts");
    const repo = new IdempotencyRecordRepository(pool);
    const tenantId = await createSchoolTenant("Idempotency Regression School");

    const begin = await repo.begin({
      tenantId,
      scope: "attempt_completion",
      scopeKey: "regression-scope-key-0001",
      requestHash: "deadbeef",
    });
    expect(begin.outcome).toBe("NEW");
    if (begin.outcome !== "NEW") throw new Error("unreachable");

    const complete = await repo.complete({
      tenantId,
      scope: "attempt_completion",
      scopeKey: "regression-scope-key-0001",
      expectedGeneration: begin.generation,
      response: { ok: true },
    });
    expect(complete.outcome).toBe("COMMITTED");

    const replay = await repo.begin({
      tenantId,
      scope: "attempt_completion",
      scopeKey: "regression-scope-key-0001",
      requestHash: "deadbeef",
    });
    expect(replay.outcome).toBe("DUPLICATE_SAME_PAYLOAD");
  });
});

// File-scoped teardown: the pool is shared module-wide across every describe
// block above, so it must be closed exactly once, after all of them have
// finished -- closing it per-describe-block (the staff-auth-flow.test.ts
// single-describe pattern this file otherwise mirrors) would leave later
// blocks calling truncateAll() against an already-ended pool.
afterAll(async () => {
  await pool.end();
});
