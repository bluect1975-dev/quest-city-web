import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { StaffAuthService } from "@quest-city-web/staff-identity";

/**
 * WEB-M3B integration tests against a real, dockerized PostgreSQL instance
 * with migrations 0001-0004 applied.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- staff-auth-flow
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });
const PASSWORD = "correct horse battery staple";

interface Fixture {
  tenantId: string;
  tenantPublicId: string;
  otherTenantId: string;
  classId: string;
  classPublicId: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE staff_class_assignment, staff_session, staff_tenant_membership, staff_account, review_queue_item, teacher_feedback, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function buildFixture(): Promise<Fixture> {
  const tenantPublicId = `sch_${Math.random().toString(36).slice(2, 10)}`;
  const tenantResult = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`,
    [tenantPublicId],
  );
  const tenantId = tenantResult.rows[0]!.id;

  const otherTenantResult = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Other School') RETURNING id`,
    [`sch_${Math.random().toString(36).slice(2, 10)}`],
  );
  const otherTenantId = otherTenantResult.rows[0]!.id;

  const classPublicId = `cls_${Math.random().toString(36).slice(2, 10)}`;
  const classResult = await pool.query<{ id: string }>(
    `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Test Class', 'ACTIVE') RETURNING id`,
    [tenantId, classPublicId],
  );
  const classId = classResult.rows[0]!.id;

  return { tenantId, tenantPublicId, otherTenantId, classId, classPublicId };
}

async function createStaffAccount(email: string, passwordHash: string, status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
     VALUES ($1, $2, 'scrypt', $3, 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
    [email, passwordHash, status],
  );
  return result.rows[0]!.id;
}

async function createMembership(staffAccountId: string, tenantId: string, role: "TEACHER" | "SCHOOL_ADMIN"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [staffAccountId, tenantId, role],
  );
  return result.rows[0]!.id;
}

describe("StaffAuthService (02_35 §4)", () => {
  beforeEach(truncateAll);
  afterAll(async () => {
    await truncateAll();
    await pool.end();
  });

  it("start() succeeds with correct credentials and a single membership, no tenantId required", async () => {
    const fixture = await buildFixture();
    const service = new StaffAuthService(pool);
    const { hashPassword } = await import("@quest-city-web/staff-identity");
    const accountId = await createStaffAccount("teacher@example.org", await hashPassword(PASSWORD));
    await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");

    const result = await service.start({ email: "teacher@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    expect(result.tenantId).toBe(fixture.tenantId);
    expect(result.role).toBe("SCHOOL_ADMIN");
    expect(result.sessionToken).toBeTruthy();
    expect(result.csrfToken).toBeTruthy();

    const row = await pool.query(`SELECT count(*)::int AS n FROM staff_session WHERE staff_account_id = $1`, [accountId]);
    expect(row.rows[0].n).toBe(1);
  });

  it("start() with an unknown email fails with the SAME code as a wrong password (anti-enumeration, 02_35 §4.6)", async () => {
    const service = new StaffAuthService(pool);
    await expect(service.start({ email: "nobody@example.org", password: "x", clientIp: "127.0.0.1" })).rejects.toMatchObject({
      code: "STAFF_AUTH_REQUIRED",
    });
  });

  it("start() with a wrong password fails with STAFF_AUTH_REQUIRED and increments failed_login_count", async () => {
    const fixture = await buildFixture();
    const { hashPassword } = await import("@quest-city-web/staff-identity");
    const accountId = await createStaffAccount("teacher2@example.org", await hashPassword(PASSWORD));
    await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");
    const service = new StaffAuthService(pool);

    await expect(
      service.start({ email: "teacher2@example.org", password: "wrong password", clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "STAFF_AUTH_REQUIRED" });

    const row = await pool.query<{ failed_login_count: number }>(`SELECT failed_login_count FROM staff_account WHERE id = $1`, [
      accountId,
    ]);
    expect(row.rows[0]!.failed_login_count).toBe(1);
  });

  it("locks the account after maxFailedLoginAttempts consecutive failures (02_35 §4.5)", async () => {
    const fixture = await buildFixture();
    const { hashPassword } = await import("@quest-city-web/staff-identity");
    const accountId = await createStaffAccount("teacher3@example.org", await hashPassword(PASSWORD));
    await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");
    const service = new StaffAuthService(pool, {
      absoluteTtlSeconds: 3600,
      inactivityTtlSeconds: 600,
      maxFailedLoginAttempts: 3,
      lockoutDurationSeconds: 900,
    });

    for (let i = 0; i < 2; i += 1) {
      await expect(
        service.start({ email: "teacher3@example.org", password: "wrong", clientIp: "127.0.0.1" }),
      ).rejects.toMatchObject({ code: "STAFF_AUTH_REQUIRED" });
    }
    // 3rd failure crosses the threshold -> locked, distinct code.
    await expect(service.start({ email: "teacher3@example.org", password: "wrong", clientIp: "127.0.0.1" })).rejects.toMatchObject({
      code: "STAFF_ACCOUNT_LOCKED",
    });
    // Even the CORRECT password is rejected while locked.
    await expect(
      service.start({ email: "teacher3@example.org", password: PASSWORD, clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "STAFF_ACCOUNT_LOCKED" });
  });

  it("start() requires tenantId when the account has more than one active membership", async () => {
    const fixtureA = await buildFixture();
    const fixtureB = await buildFixture();
    const { hashPassword } = await import("@quest-city-web/staff-identity");
    const accountId = await createStaffAccount("multi@example.org", await hashPassword(PASSWORD));
    await createMembership(accountId, fixtureA.tenantId, "SCHOOL_ADMIN");
    await createMembership(accountId, fixtureB.tenantId, "TEACHER");
    const service = new StaffAuthService(pool);

    await expect(
      service.start({ email: "multi@example.org", password: PASSWORD, clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const result = await service.start({
      email: "multi@example.org",
      password: PASSWORD,
      tenantId: fixtureB.tenantId,
      clientIp: "127.0.0.1",
    });
    expect(result.tenantId).toBe(fixtureB.tenantId);
    expect(result.role).toBe("TEACHER");
  });

  it("start() with two ACTIVE memberships on the SAME tenant: tenantId alone is still ambiguous (409, candidates in safeDetails), staffTenantMembershipId resolves it", async () => {
    // Same-tenant multi-role (02_25 v1.12 §6.16.6, migration 0012) --
    // unlike the cross-tenant case above, tenantId cannot disambiguate two
    // memberships that already share the same tenant. The login UI reads
    // safeDetails.candidates to render a role picker rather than leaving
    // the user stuck (found live via the Student Support Roles browser
    // walkthrough -- the login form previously had no way to supply
    // staffTenantMembershipId at all).
    const fixture = await buildFixture();
    const { hashPassword } = await import("@quest-city-web/staff-identity");
    const accountId = await createStaffAccount("dualrole@example.org", await hashPassword(PASSWORD));
    const adminMembershipId = await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");
    const teacherMembershipId = await createMembership(accountId, fixture.tenantId, "TEACHER");
    const service = new StaffAuthService(pool);

    const ambiguous = await service
      .start({ email: "dualrole@example.org", password: PASSWORD, tenantId: fixture.tenantId, clientIp: "127.0.0.1" })
      .catch((e) => e);
    expect(ambiguous.code).toBe("AMBIGUOUS_TENANT_MEMBERSHIP");
    expect(ambiguous.safeDetails?.candidates).toEqual(
      expect.arrayContaining([
        { staffTenantMembershipId: adminMembershipId, role: "SCHOOL_ADMIN" },
        { staffTenantMembershipId: teacherMembershipId, role: "TEACHER" },
      ]),
    );

    const resolved = await service.start({
      email: "dualrole@example.org",
      password: PASSWORD,
      tenantId: fixture.tenantId,
      staffTenantMembershipId: teacherMembershipId,
      clientIp: "127.0.0.1",
    });
    expect(resolved.tenantId).toBe(fixture.tenantId);
    expect(resolved.role).toBe("TEACHER");
  });

  it("refresh() rotates the session, revokes the previous one ROTATED, and never extends the absolute TTL", async () => {
    const fixture = await buildFixture();
    const { hashPassword } = await import("@quest-city-web/staff-identity");
    const accountId = await createStaffAccount("refresh@example.org", await hashPassword(PASSWORD));
    await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");
    const service = new StaffAuthService(pool);
    const started = await service.start({ email: "refresh@example.org", password: PASSWORD, clientIp: "127.0.0.1" });

    const refreshed = await service.refresh({ sessionToken: started.sessionToken, csrfToken: started.csrfToken });
    expect(refreshed.sessionToken).not.toBe(started.sessionToken);
    expect(refreshed.csrfToken).not.toBe(started.csrfToken);
    expect(refreshed.absoluteExpiresAt.getTime()).toBe(started.absoluteExpiresAt.getTime());

    // Exactly one session row is active after rotation (the new one); the
    // original was revoked, never left dangling as a second valid session.
    const activeSessions = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM staff_session WHERE staff_account_id = $1 AND revoked_at IS NULL`,
      [accountId],
    );
    expect(activeSessions.rows[0]!.n).toBe("1");
    const revokedSessions = await pool.query<{ revoked_reason: string }>(
      `SELECT revoked_reason FROM staff_session WHERE staff_account_id = $1 AND revoked_at IS NOT NULL`,
      [accountId],
    );
    expect(revokedSessions.rows).toHaveLength(1);
    expect(revokedSessions.rows[0]!.revoked_reason).toBe("ROTATED");
  });

  it("refresh() with a wrong CSRF token fails with STAFF_FORBIDDEN and does not rotate the session", async () => {
    const fixture = await buildFixture();
    const { hashPassword } = await import("@quest-city-web/staff-identity");
    const accountId = await createStaffAccount("badcsrf@example.org", await hashPassword(PASSWORD));
    await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");
    const service = new StaffAuthService(pool);
    const started = await service.start({ email: "badcsrf@example.org", password: PASSWORD, clientIp: "127.0.0.1" });

    await expect(
      service.refresh({ sessionToken: started.sessionToken, csrfToken: "wrong-csrf-token" }),
    ).rejects.toMatchObject({ code: "STAFF_FORBIDDEN" });

    const activeSessions = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM staff_session WHERE staff_account_id = $1 AND revoked_at IS NULL`,
      [accountId],
    );
    expect(activeSessions.rows[0]!.n).toBe("1");
  });

  it("logout() is idempotent — a second call with the same (now-revoked) token still succeeds", async () => {
    const fixture = await buildFixture();
    const { hashPassword } = await import("@quest-city-web/staff-identity");
    const accountId = await createStaffAccount("logout@example.org", await hashPassword(PASSWORD));
    await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");
    const service = new StaffAuthService(pool);
    const started = await service.start({ email: "logout@example.org", password: PASSWORD, clientIp: "127.0.0.1" });

    await service.logout({ sessionToken: started.sessionToken, csrfToken: started.csrfToken });
    await expect(service.logout({ sessionToken: started.sessionToken, csrfToken: started.csrfToken })).resolves.toBeUndefined();
    // logout() with no session at all is also a no-op success (never reveals prior state).
    await expect(service.logout({ sessionToken: null, csrfToken: null })).resolves.toBeUndefined();
  });

  it("resolveInternalIdentity(): TEACHER gets its explicit class scope; SCHOOL_ADMIN gets null (whole-tenant, 02_35 §3.2)", async () => {
    const fixture = await buildFixture();
    const { hashPassword } = await import("@quest-city-web/staff-identity");

    const teacherAccountId = await createStaffAccount("scoped-teacher@example.org", await hashPassword(PASSWORD));
    const teacherMembershipId = await createMembership(teacherAccountId, fixture.tenantId, "TEACHER");
    await pool.query(
      `INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`,
      [teacherMembershipId, fixture.tenantId, fixture.classId],
    );

    const adminAccountId = await createStaffAccount("scoped-admin@example.org", await hashPassword(PASSWORD));
    await createMembership(adminAccountId, fixture.tenantId, "SCHOOL_ADMIN");

    const service = new StaffAuthService(pool);
    const teacherSession = await service.start({ email: "scoped-teacher@example.org", password: PASSWORD, clientIp: "127.0.0.1" });
    const adminSession = await service.start({ email: "scoped-admin@example.org", password: PASSWORD, clientIp: "127.0.0.1" });

    const teacherIdentity = await service.resolveInternalIdentity(teacherSession.sessionToken);
    expect(teacherIdentity.role).toBe("TEACHER");
    expect(teacherIdentity.classScope).toEqual([fixture.classId]);

    const adminIdentity = await service.resolveInternalIdentity(adminSession.sessionToken);
    expect(adminIdentity.role).toBe("SCHOOL_ADMIN");
    expect(adminIdentity.classScope).toBeNull();
  });

  it("resolveInternalIdentity() with an invalid token fails with STAFF_AUTH_REQUIRED", async () => {
    const service = new StaffAuthService(pool);
    await expect(service.resolveInternalIdentity("not-a-real-token")).rejects.toMatchObject({ code: "STAFF_AUTH_REQUIRED" });
  });

  it("start() against a SUSPENDED account fails with STAFF_AUTH_REQUIRED (same code as invalid credentials)", async () => {
    const fixture = await buildFixture();
    const { hashPassword } = await import("@quest-city-web/staff-identity");
    const accountId = await createStaffAccount("suspended@example.org", await hashPassword(PASSWORD), "SUSPENDED");
    await createMembership(accountId, fixture.tenantId, "SCHOOL_ADMIN");
    const service = new StaffAuthService(pool);

    await expect(
      service.start({ email: "suspended@example.org", password: PASSWORD, clientIp: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "STAFF_AUTH_REQUIRED" });
  });
});
