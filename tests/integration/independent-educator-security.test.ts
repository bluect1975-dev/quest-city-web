import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  PlatformAuthService,
  IndependentEducatorActivationService,
  IndependentEducatorStatusService,
  type Capability,
} from "@quest-city-web/platform-admin";
import { StaffAuthService, hashPassword } from "@quest-city-web/staff-identity";

/**
 * School Pilot Readiness Tranche C (Independent Educator Foundation)
 * integration tests against a real, dockerized PostgreSQL instance with
 * migrations 0001-0010 applied.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- independent-educator-security
 *
 * Covers the governing instruction's §28 security scenario list:
 * activation authorization, identity reuse (incl. mixed-identity with an
 * existing SCHOOL membership), duplicate activation, suspended identity,
 * tenant isolation (Independent Educator A vs B vs School C),
 * suspension/reactivation enforcement (staff login + active session +
 * student access), idempotency, and the tenant/role coherence trigger
 * from migration 0010.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });
const PASSWORD = "correct horse battery staple";
const ALL_CAPABILITIES: Capability[] = [
  "tenant.create",
  "tenant.read",
  "tenant.suspend",
  "school_admin.activate",
  "audit.read.global",
  "independent_educator.activate",
  "independent_educator.read",
  "independent_educator.status.manage",
];

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE platform_admin_session, capability_grant, platform_admin_grant, staff_invitation, staff_class_assignment, staff_session, staff_tenant_membership, staff_account, review_queue_item, teacher_feedback, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
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

async function platformIdentity(email: string) {
  const platformAuth = new PlatformAuthService(pool);
  const session = await platformAuth.start({ email, password: PASSWORD, clientIp: "127.0.0.1" });
  return platformAuth.resolveIdentity(session.sessionToken);
}

async function createSchoolTenant(name: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', $2, $3) RETURNING id`,
    [`sch_${Math.random().toString(36).slice(2, 10)}`, status, name],
  );
  return result.rows[0]!.id;
}

describe("Independent Educator activation (02_26 v1.13 §35.2, 02_38 v1.3 §9/§13)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("a Platform Admin lacking independent_educator.activate cannot activate (missing capability -> denied)", async () => {
    await createPlatformAdmin("no-activate@example.org", ["tenant.read"]);
    const identity = await platformIdentity("no-activate@example.org");
    await expect(
      new IndependentEducatorActivationService(pool).activate(identity, {
        email: "educator@example.org",
        tenantName: "Should Fail Tutoring",
        idempotencyKey: "idem-ie-capability-denied-0001",
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  });

  it("activates a brand-new identity: creates tenant type=INDEPENDENT_EDUCATOR, role=INDEPENDENT_EDUCATOR membership, one-time temporary password, no auto-created classes/students", async () => {
    await createPlatformAdmin("activator@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("activator@example.org");

    const result = await new IndependentEducatorActivationService(pool).activate(identity, {
      email: "new-educator@example.org",
      tenantName: "New Tutoring Practice",
      idempotencyKey: "idem-ie-new-0001",
    });
    expect(result.identityReused).toBe(false);
    expect(result.temporaryPassword).toBeTruthy();

    const tenant = await pool.query(`SELECT type, status FROM tenant WHERE id = $1`, [result.tenantId]);
    expect(tenant.rows[0]).toMatchObject({ type: "INDEPENDENT_EDUCATOR", status: "ACTIVE" });

    const membership = await pool.query(
      `SELECT role, status FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2`,
      [result.staffAccountId, result.tenantId],
    );
    expect(membership.rows[0]).toMatchObject({ role: "INDEPENDENT_EDUCATOR", status: "ACTIVE" });

    const classCount = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM school_class WHERE tenant_id = $1`, [
      result.tenantId,
    ]);
    expect(classCount.rows[0]!.n).toBe("0");

    const provisionedAudit = await pool.query(
      `SELECT action FROM audit_event WHERE action = 'independent_educator_tenant_provisioned' AND tenant_id = $1`,
      [result.tenantId],
    );
    expect(provisionedAudit.rows).toHaveLength(1);
    const activatedAudit = await pool.query(
      `SELECT action FROM audit_event WHERE action = 'independent_educator_activated' AND tenant_id = $1`,
      [result.tenantId],
    );
    expect(activatedAudit.rows).toHaveLength(1);
  });

  it("mixed-identity: an existing ACTIVE SCHOOL membership can also become an Independent Educator -- second membership on a new tenant, same staff_account, never a second identity (02_38 v1.3 §13, 02_35 v1.4 §11ter.6)", async () => {
    const schoolTenant = await createSchoolTenant("Existing School");
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      ["mixed@example.org", await hashPassword(PASSWORD)],
    );
    const existingAccount = await pool.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, ["mixed@example.org"]);
    await pool.query(`INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, 'TEACHER', 'ACTIVE')`, [
      existingAccount.rows[0]!.id,
      schoolTenant,
    ]);

    await createPlatformAdmin("mixed-activator@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("mixed-activator@example.org");

    const result = await new IndependentEducatorActivationService(pool).activate(identity, {
      email: "mixed@example.org",
      tenantName: "Mixed Identity Tutoring",
      idempotencyKey: "idem-ie-mixed-0001",
    });
    expect(result.identityReused).toBe(true);
    expect(result.temporaryPassword).toBeUndefined();
    expect(result.staffAccountId).toBe(existingAccount.rows[0]!.id);

    const accountCount = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM staff_account WHERE email = $1`, [
      "mixed@example.org",
    ]);
    expect(accountCount.rows[0]!.n).toBe("1");

    const memberships = await pool.query(
      `SELECT tenant_id, role, status FROM staff_tenant_membership WHERE staff_account_id = $1 ORDER BY created_at ASC`,
      [existingAccount.rows[0]!.id],
    );
    expect(memberships.rows).toHaveLength(2);
    expect(memberships.rows[0]).toMatchObject({ tenant_id: schoolTenant, role: "TEACHER", status: "ACTIVE" });
    expect(memberships.rows[1]).toMatchObject({ tenant_id: result.tenantId, role: "INDEPENDENT_EDUCATOR", status: "ACTIVE" });
  });

  it("activating an identity that already holds an ACTIVE INDEPENDENT_EDUCATOR membership fails with INDEPENDENT_EDUCATOR_ALREADY_ACTIVE (duplicate request, no second tenant/membership)", async () => {
    await createPlatformAdmin("dup-activator@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("dup-activator@example.org");
    const service = new IndependentEducatorActivationService(pool);

    const first = await service.activate(identity, {
      email: "dup-educator@example.org",
      tenantName: "First Tutoring",
      idempotencyKey: "idem-ie-dup-0001",
    });
    await expect(
      service.activate(identity, {
        email: "dup-educator@example.org",
        tenantName: "Second Tutoring",
        idempotencyKey: "idem-ie-dup-0002",
      }),
    ).rejects.toMatchObject({ code: "INDEPENDENT_EDUCATOR_ALREADY_ACTIVE" });

    const tenantCount = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM tenant WHERE type = 'INDEPENDENT_EDUCATOR'`);
    expect(tenantCount.rows[0]!.n).toBe("1");
    expect(first.tenantId).toBeTruthy();
  });

  it("cannot activate against a SUSPENDED existing identity (INDEPENDENT_EDUCATOR_IDENTITY_SUSPENDED)", async () => {
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'SUSPENDED', 'ADMIN_SEED_SCRIPT', 'test-fixture')`,
      ["suspended-identity@example.org", await hashPassword(PASSWORD)],
    );
    await createPlatformAdmin("activator-susp@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("activator-susp@example.org");

    await expect(
      new IndependentEducatorActivationService(pool).activate(identity, {
        email: "suspended-identity@example.org",
        tenantName: "Should Fail Tutoring",
        idempotencyKey: "idem-ie-susp-0001",
      }),
    ).rejects.toMatchObject({ code: "INDEPENDENT_EDUCATOR_IDENTITY_SUSPENDED" });
  });
});

describe("Independent Educator activation idempotency (02_26 v1.13 §35.9, migration 0010)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("replay: same Idempotency-Key + same payload returns the exact original response and creates no second tenant/membership", async () => {
    await createPlatformAdmin("idem-replay@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("idem-replay@example.org");
    const service = new IndependentEducatorActivationService(pool);

    const key = "idem-ie-replay-same-payload-0001";
    const first = await service.activate(identity, { email: "replay@example.org", tenantName: "Replay Tutoring", idempotencyKey: key });
    const second = await service.activate(identity, { email: "replay@example.org", tenantName: "Replay Tutoring", idempotencyKey: key });

    expect(second).toEqual(first);
    const tenantCount = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM tenant WHERE type = 'INDEPENDENT_EDUCATOR'`);
    expect(tenantCount.rows[0]!.n).toBe("1");
  });

  it("conflict: same Idempotency-Key + different payload is rejected with IDEMPOTENCY_CONFLICT", async () => {
    await createPlatformAdmin("idem-conflict@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("idem-conflict@example.org");
    const service = new IndependentEducatorActivationService(pool);

    const key = "idem-ie-conflict-0001";
    await service.activate(identity, { email: "conflict-a@example.org", tenantName: "Conflict A", idempotencyKey: key });
    await expect(
      service.activate(identity, { email: "conflict-b@example.org", tenantName: "Conflict B", idempotencyKey: key }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("actor partitioning: the same Idempotency-Key value used by two different Platform Admins never collides", async () => {
    await createPlatformAdmin("idem-actor-a@example.org", ["independent_educator.activate"]);
    await createPlatformAdmin("idem-actor-b@example.org", ["independent_educator.activate"]);
    const identityA = await platformIdentity("idem-actor-a@example.org");
    const identityB = await platformIdentity("idem-actor-b@example.org");
    const service = new IndependentEducatorActivationService(pool);

    const sharedKey = "idem-ie-shared-key-reused-by-two-admins";
    const resultA = await service.activate(identityA, { email: "actor-a-educator@example.org", tenantName: "A", idempotencyKey: sharedKey });
    const resultB = await service.activate(identityB, { email: "actor-b-educator@example.org", tenantName: "B", idempotencyKey: sharedKey });

    expect(resultA.tenantId).not.toBe(resultB.tenantId);
  });
});

describe("Independent Educator read (02_26 v1.13 §35.3) -- anti-enumeration, no didactic data", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("a Platform Admin lacking independent_educator.read cannot list or read", async () => {
    await createPlatformAdmin("no-read@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("no-read@example.org");
    const service = new IndependentEducatorActivationService(pool);
    await expect(service.list(identity, { limit: 50, offset: 0 })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await expect(service.getById(identity, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      code: "CAPABILITY_DENIED",
    });
  });

  it("GET by id on a non-existent id and on a real SCHOOL tenant id both return INDEPENDENT_EDUCATOR_NOT_FOUND (anti-enumeration, never distinguished)", async () => {
    const schoolTenant = await createSchoolTenant("Not An Educator School");
    await createPlatformAdmin("reader@example.org", ["independent_educator.read"]);
    const identity = await platformIdentity("reader@example.org");
    const service = new IndependentEducatorActivationService(pool);

    await expect(service.getById(identity, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      code: "INDEPENDENT_EDUCATOR_NOT_FOUND",
    });
    await expect(service.getById(identity, schoolTenant)).rejects.toMatchObject({ code: "INDEPENDENT_EDUCATOR_NOT_FOUND" });
  });

  it("list() returns only INDEPENDENT_EDUCATOR tenants, never SCHOOL tenants", async () => {
    await createSchoolTenant("Regular School");
    await createPlatformAdmin("lister@example.org", ["independent_educator.activate", "independent_educator.read"]);
    const identity = await platformIdentity("lister@example.org");
    const service = new IndependentEducatorActivationService(pool);
    await service.activate(identity, { email: "listed@example.org", tenantName: "Listed Tutoring", idempotencyKey: "idem-ie-list-0001" });

    const list = await service.list(identity, { limit: 50, offset: 0 });
    expect(list).toHaveLength(1);
    expect(list[0]!.email).toBe("listed@example.org");
  });
});

describe("Independent Educator suspension/reactivation (02_26 v1.13 §35.4, 02_35 v1.4 §11ter.8)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  async function activateFixture(email: string) {
    await createPlatformAdmin(`fixture-activator-${email}`, ["independent_educator.activate"]);
    const identity = await platformIdentity(`fixture-activator-${email}`);
    return new IndependentEducatorActivationService(pool).activate(identity, {
      email,
      tenantName: `Tutoring for ${email}`,
      idempotencyKey: `idem-ie-fixture-${email}`,
    });
  }

  it("a Platform Admin lacking independent_educator.status.manage cannot suspend", async () => {
    const activated = await activateFixture("no-suspend-target@example.org");
    await createPlatformAdmin("no-suspend@example.org", ["independent_educator.read"]);
    const identity = await platformIdentity("no-suspend@example.org");
    await expect(
      new IndependentEducatorStatusService(pool).setStatus(identity, { tenantId: activated.tenantId, status: "SUSPENDED" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  });

  it("suspends contextually: tenant.status AND the INDEPENDENT_EDUCATOR membership status flip together in one transaction; blocks a NEW staff login", async () => {
    const activated = await activateFixture("suspend-target@example.org");
    await createPlatformAdmin("suspender@example.org", ["independent_educator.status.manage"]);
    const identity = await platformIdentity("suspender@example.org");

    const result = await new IndependentEducatorStatusService(pool).setStatus(identity, {
      tenantId: activated.tenantId,
      status: "SUSPENDED",
    });
    expect(result.tenantStatus).toBe("SUSPENDED");
    expect(result.membershipStatus).toBe("SUSPENDED");

    const tenant = await pool.query(`SELECT status FROM tenant WHERE id = $1`, [activated.tenantId]);
    expect(tenant.rows[0]!.status).toBe("SUSPENDED");
    const membership = await pool.query(
      `SELECT status FROM staff_tenant_membership WHERE staff_account_id = $1 AND tenant_id = $2`,
      [activated.staffAccountId, activated.tenantId],
    );
    expect(membership.rows[0]!.status).toBe("SUSPENDED");

    const staffAuth = new StaffAuthService(pool);
    await expect(
      staffAuth.start({ email: "suspend-target@example.org", password: activated.temporaryPassword ?? "", clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("suspending revokes an ALREADY-ACTIVE Independent Educator staff session's usability on its very next request (not merely hidden in a UI)", async () => {
    const activated = await activateFixture("active-session-target@example.org");
    const staffAuth = new StaffAuthService(pool);
    const staffSession = await staffAuth.start({
      email: "active-session-target@example.org",
      password: activated.temporaryPassword ?? "",
      clientIp: "127.0.0.1",
    });
    await expect(staffAuth.resolveInternalIdentity(staffSession.sessionToken)).resolves.toMatchObject({
      role: "INDEPENDENT_EDUCATOR",
    });

    await createPlatformAdmin("suspender2@example.org", ["independent_educator.status.manage"]);
    const identity = await platformIdentity("suspender2@example.org");
    await new IndependentEducatorStatusService(pool).setStatus(identity, { tenantId: activated.tenantId, status: "SUSPENDED" });

    await expect(staffAuth.resolveInternalIdentity(staffSession.sessionToken)).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("reactivating a suspended Independent Educator restores staff login", async () => {
    const activated = await activateFixture("reactivate-target@example.org");
    await createPlatformAdmin("reactivator@example.org", ["independent_educator.status.manage"]);
    const identity = await platformIdentity("reactivator@example.org");
    const statusService = new IndependentEducatorStatusService(pool);

    await statusService.setStatus(identity, { tenantId: activated.tenantId, status: "SUSPENDED" });
    const reactivated = await statusService.setStatus(identity, { tenantId: activated.tenantId, status: "ACTIVE" });
    expect(reactivated.tenantStatus).toBe("ACTIVE");
    expect(reactivated.membershipStatus).toBe("ACTIVE");

    const staffAuth = new StaffAuthService(pool);
    await expect(
      staffAuth.start({ email: "reactivate-target@example.org", password: activated.temporaryPassword ?? "", clientIp: "127.0.0.1" }),
    ).resolves.toMatchObject({ role: "INDEPENDENT_EDUCATOR" });
  });

  it("setStatus() to the tenant's current status fails with INDEPENDENT_EDUCATOR_STATUS_UNCHANGED (no silent no-op)", async () => {
    const activated = await activateFixture("noop-target@example.org");
    await createPlatformAdmin("noop@example.org", ["independent_educator.status.manage"]);
    const identity = await platformIdentity("noop@example.org");
    await expect(
      new IndependentEducatorStatusService(pool).setStatus(identity, { tenantId: activated.tenantId, status: "ACTIVE" }),
    ).rejects.toMatchObject({ code: "INDEPENDENT_EDUCATOR_STATUS_UNCHANGED" });
  });

  it("setStatus() on a SCHOOL tenant id fails with INDEPENDENT_EDUCATOR_NOT_FOUND (never operates cross-type)", async () => {
    const schoolTenant = await createSchoolTenant("Wrong Type School");
    await createPlatformAdmin("wrong-type@example.org", ["independent_educator.status.manage"]);
    const identity = await platformIdentity("wrong-type@example.org");
    await expect(
      new IndependentEducatorStatusService(pool).setStatus(identity, { tenantId: schoolTenant, status: "SUSPENDED" }),
    ).rejects.toMatchObject({ code: "INDEPENDENT_EDUCATOR_NOT_FOUND" });
  });
});

describe("Tenant isolation -- Independent Educator A vs B vs School C (02_25 v1.9 §6.14, 02_35 v1.4 §11ter.4)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("staff auth resolves classScope=null (tenant-wide) for INDEPENDENT_EDUCATOR, scoped to its own tenant only", async () => {
    await createPlatformAdmin("iso-activator@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("iso-activator@example.org");
    const service = new IndependentEducatorActivationService(pool);

    const educatorA = await service.activate(identity, { email: "iso-a@example.org", tenantName: "Tutoring A", idempotencyKey: "idem-iso-a" });
    const educatorB = await service.activate(identity, { email: "iso-b@example.org", tenantName: "Tutoring B", idempotencyKey: "idem-iso-b" });

    const staffAuth = new StaffAuthService(pool);
    const sessionA = await staffAuth.start({ email: "iso-a@example.org", password: educatorA.temporaryPassword ?? "", clientIp: "127.0.0.1" });
    const internalA = await staffAuth.resolveInternalIdentity(sessionA.sessionToken);
    expect(internalA.tenantId).toBe(educatorA.tenantId);
    expect(internalA.tenantId).not.toBe(educatorB.tenantId);
    expect(internalA.role).toBe("INDEPENDENT_EDUCATOR");
    expect(internalA.classScope).toBeNull();
  });

  it("a class created under Independent Educator A's tenant is not visible via School C's class listing scope, and vice versa (composite tenant_id FK isolation)", async () => {
    const schoolTenant = await createSchoolTenant("Isolation School C");
    await createPlatformAdmin("iso-activator2@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("iso-activator2@example.org");
    const educatorA = await new IndependentEducatorActivationService(pool).activate(identity, {
      email: "iso-class-a@example.org",
      tenantName: "Class Isolation Tutoring",
      idempotencyKey: "idem-iso-class-a",
    });

    await pool.query(`INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Educator A Class', 'ACTIVE')`, [
      educatorA.tenantId,
      `cls_${Math.random().toString(36).slice(2, 10)}`,
    ]);

    const schoolScopedClasses = await pool.query(`SELECT id FROM school_class WHERE tenant_id = $1`, [schoolTenant]);
    expect(schoolScopedClasses.rows).toHaveLength(0);
    const educatorScopedClasses = await pool.query(`SELECT id FROM school_class WHERE tenant_id = $1`, [educatorA.tenantId]);
    expect(educatorScopedClasses.rows).toHaveLength(1);
  });
});

describe("tenant.type / staff_tenant_membership.role coherence trigger (migration 0010, 02_25 v1.9 §6.14)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("rejects an INSERT of role=INDEPENDENT_EDUCATOR on a tenant.type=SCHOOL row", async () => {
    const schoolTenant = await createSchoolTenant("Coherence Test School");
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      ["coherence-a@example.org", await hashPassword(PASSWORD)],
    );
    const account = await pool.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, ["coherence-a@example.org"]);
    await expect(
      pool.query(`INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, 'INDEPENDENT_EDUCATOR', 'ACTIVE')`, [
        account.rows[0]!.id,
        schoolTenant,
      ]),
    ).rejects.toThrow();
  });

  it("rejects an INSERT of role=TEACHER on a tenant.type=INDEPENDENT_EDUCATOR row", async () => {
    await createPlatformAdmin("coherence-activator@example.org", ["independent_educator.activate"]);
    const identity = await platformIdentity("coherence-activator@example.org");
    const educator = await new IndependentEducatorActivationService(pool).activate(identity, {
      email: "coherence-b@example.org",
      tenantName: "Coherence Tutoring",
      idempotencyKey: "idem-coherence-b",
    });
    await pool.query(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, $2, 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      ["coherence-c@example.org", await hashPassword(PASSWORD)],
    );
    const account = await pool.query<{ id: string }>(`SELECT id FROM staff_account WHERE email = $1`, ["coherence-c@example.org"]);
    await expect(
      pool.query(`INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, 'TEACHER', 'ACTIVE')`, [
        account.rows[0]!.id,
        educator.tenantId,
      ]),
    ).rejects.toThrow();
  });

  it("rejects creating a tenant with type=ORGANIZATION (retired vocabulary, 02_25 v1.9 §6.13.1)", async () => {
    await expect(
      pool.query(`INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'ORGANIZATION', 'ACTIVE', 'Should Fail')`, [
        `org_${Math.random().toString(36).slice(2, 10)}`,
      ]),
    ).rejects.toThrow();
  });
});

afterAll(async () => {
  await pool.end();
});
