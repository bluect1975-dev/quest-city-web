import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  ClassCodeService,
  IdentityError,
  RATE_LIMITS,
  SessionService,
  checkFixedWindow,
  generateClassCode,
  generatePin,
  hashPin,
  hashClassCode,
  hashToken,
  normalizeAlias,
  normalizeClassCode,
} from "@quest-city-web/identity";

/**
 * WEB-M1 Fase 2 integration tests against a real, dockerized PostgreSQL
 * instance (same `postgres:17.2-alpine` image as
 * infrastructure/deployment/docker-compose.yml — run standalone, without a
 * persistent volume, so each run starts from a clean database rather than
 * reusing a developer's local dev data). Requires migrations 0001 and 0002
 * already applied against DATABASE_URL.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5555/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- identity-flow
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5555/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

// Fixed 32-byte test pepper (base64-decoded) — never used outside this test suite.
const TEST_PEPPER = Buffer.from("dGVzdC1wZXBwZXItZm9yLWlkZW50aXR5LWZsb3ctdGVzdHMh", "base64url");

interface Fixture {
  tenantId: string;
  tenantPublicId: string;
  classId: string;
  classPublicId: string;
  classCode: string;
  studentProfileId: string;
  studentPublicId: string;
  enrollmentId: string;
  accessAlias: string;
  pin: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function buildFixture(overrides?: { enrollmentStatus?: string }): Promise<Fixture> {
  const tenantPublicId = `sch_${Math.random().toString(36).slice(2, 10)}`;
  const tenantResult = await pool.query<{ id: string }>(
    `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`,
    [tenantPublicId],
  );
  const tenantRow = tenantResult.rows[0];
  if (!tenantRow) throw new Error("fixture: tenant insert failed");

  const classPublicId = `cls_${Math.random().toString(36).slice(2, 10)}`;
  const classResult = await pool.query<{ id: string }>(
    `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Test Class', 'ACTIVE') RETURNING id`,
    [tenantRow.id, classPublicId],
  );
  const classRow = classResult.rows[0];
  if (!classRow) throw new Error("fixture: school_class insert failed");

  const classCode = generateClassCode();
  await pool.query(
    `INSERT INTO class_access_code (tenant_id, class_id, code_hash, status) VALUES ($1, $2, $3, 'ACTIVE')`,
    [tenantRow.id, classRow.id, hashClassCode(normalizeClassCode(classCode), TEST_PEPPER)],
  );

  const studentPublicId = `std_${Math.random().toString(36).slice(2, 10)}`;
  const profileResult = await pool.query<{ id: string }>(
    `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [tenantRow.id, studentPublicId],
  );
  const profileRow = profileResult.rows[0];
  if (!profileRow) throw new Error("fixture: student_profile insert failed");

  const accessAlias = "Marco.R";
  const pin = generatePin();
  const enrollmentResult = await pool.query<{ id: string }>(
    `INSERT INTO school_enrollment
       (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      tenantRow.id,
      classRow.id,
      profileRow.id,
      accessAlias,
      normalizeAlias(accessAlias),
      await hashPin(pin),
      overrides?.enrollmentStatus ?? "INVITED",
    ],
  );
  const enrollmentRow = enrollmentResult.rows[0];
  if (!enrollmentRow) throw new Error("fixture: school_enrollment insert failed");

  return {
    tenantId: tenantRow.id,
    tenantPublicId,
    classId: classRow.id,
    classPublicId,
    classCode,
    studentProfileId: profileRow.id,
    studentPublicId,
    enrollmentId: enrollmentRow.id,
    accessAlias,
    pin,
  };
}

describe("WEB-M1 Fase 2 identity flow (real Postgres)", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1"); // fail fast if the DB isn't reachable
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("full flow: resolve -> start -> student-context -> refresh -> logout, with unique per-call random ips", async () => {
    const fixture = await buildFixture();
    const classCodeService = new ClassCodeService(pool, TEST_PEPPER);
    const sessionService = new SessionService(pool, TEST_PEPPER);
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

    const resolved = await classCodeService.resolve(fixture.classCode, ip);
    expect(resolved.tenantPublicId).toBe(fixture.tenantPublicId);
    expect(resolved.classPublicId).toBe(fixture.classPublicId);
    expect(resolved.requiresAlias).toBe(true);
    expect(resolved.requiresPin).toBe(true);

    const started = await sessionService.start({
      classCode: fixture.classCode,
      accessAlias: fixture.accessAlias,
      pin: fixture.pin,
      clientIp: ip,
    });
    expect(started.studentPublicId).toBe(fixture.studentPublicId);
    expect(started.tenantPublicId).toBe(fixture.tenantPublicId);
    expect(started.classPublicId).toBe(fixture.classPublicId);
    expect(started.sessionToken).toBeTruthy();
    expect(started.csrfToken).toBeTruthy();
    expect(started.sessionToken).not.toBe(started.csrfToken);

    // Enrollment activation side effect (02_26 §30.6): INVITED -> ACTIVE on first successful session/start.
    const enrollmentAfterStart = await pool.query<{ status: string }>(
      "SELECT status FROM school_enrollment WHERE id = $1",
      [fixture.enrollmentId],
    );
    expect(enrollmentAfterStart.rows[0]?.status).toBe("ACTIVE");

    const context = await sessionService.getContext(started.sessionToken);
    expect(context.studentPublicId).toBe(fixture.studentPublicId);
    expect(context.enrollmentStatus).toBe("ACTIVE");
    expect(context.displayAlias).toBe(fixture.accessAlias);

    const refreshed = await sessionService.refresh({
      sessionToken: started.sessionToken,
      csrfToken: started.csrfToken,
    });
    expect(refreshed.sessionToken).not.toBe(started.sessionToken);
    expect(refreshed.csrfToken).not.toBe(started.csrfToken);
    // Refresh never extends the absolute TTL (02_26 §30.1).
    expect(refreshed.sessionExpiresAt.getTime()).toBe(started.sessionExpiresAt.getTime());

    // The rotated-away token must no longer resolve to a context.
    await expect(sessionService.getContext(started.sessionToken)).rejects.toThrow(IdentityError);

    // The new token works.
    const contextAfterRefresh = await sessionService.getContext(refreshed.sessionToken);
    expect(contextAfterRefresh.studentPublicId).toBe(fixture.studentPublicId);

    await sessionService.logout({ sessionToken: refreshed.sessionToken, csrfToken: refreshed.csrfToken });
    await expect(sessionService.getContext(refreshed.sessionToken)).rejects.toThrow(IdentityError);

    // Idempotent: logging out again (already-revoked session) must not throw.
    await expect(
      sessionService.logout({ sessionToken: refreshed.sessionToken, csrfToken: refreshed.csrfToken }),
    ).resolves.toBeUndefined();
    // Idempotent with no session at all either.
    await expect(sessionService.logout({ sessionToken: null, csrfToken: null })).resolves.toBeUndefined();
  });

  it("uniform CLASS_CODE_INVALID for a nonexistent class code", async () => {
    const classCodeService = new ClassCodeService(pool, TEST_PEPPER);
    await expect(classCodeService.resolve("NOPE0000", "203.0.113.50")).rejects.toMatchObject({
      code: "CLASS_CODE_INVALID",
    });
  });

  it("uniform ACCESS_CREDENTIALS_INVALID for a wrong PIN (does not reveal that the alias exists)", async () => {
    const fixture = await buildFixture({ enrollmentStatus: "ACTIVE" });
    const sessionService = new SessionService(pool, TEST_PEPPER);
    await expect(
      sessionService.start({
        classCode: fixture.classCode,
        accessAlias: fixture.accessAlias,
        pin: "000000",
        clientIp: "203.0.113.60",
      }),
    ).rejects.toMatchObject({ code: "ACCESS_CREDENTIALS_INVALID" });
  });

  it("uniform ACCESS_CREDENTIALS_INVALID for a nonexistent alias (same code as a wrong PIN)", async () => {
    const fixture = await buildFixture();
    const sessionService = new SessionService(pool, TEST_PEPPER);
    await expect(
      sessionService.start({
        classCode: fixture.classCode,
        accessAlias: "nonexistent-alias",
        pin: "123456",
        clientIp: "203.0.113.61",
      }),
    ).rejects.toMatchObject({ code: "ACCESS_CREDENTIALS_INVALID" });
  });

  it("ENROLLMENT_SUSPENDED is returned distinctly for a suspended enrollment", async () => {
    const fixture = await buildFixture({ enrollmentStatus: "SUSPENDED" });
    const sessionService = new SessionService(pool, TEST_PEPPER);
    await expect(
      sessionService.start({
        classCode: fixture.classCode,
        accessAlias: fixture.accessAlias,
        pin: fixture.pin,
        clientIp: "203.0.113.62",
      }),
    ).rejects.toMatchObject({ code: "ENROLLMENT_SUSPENDED" });
  });

  it("rejects an inactive tenant with TENANT_ACCESS_DENIED", async () => {
    const fixture = await buildFixture();
    await pool.query("UPDATE tenant SET status = 'SUSPENDED' WHERE id = $1", [fixture.tenantId]);
    const sessionService = new SessionService(pool, TEST_PEPPER);
    await expect(
      sessionService.start({
        classCode: fixture.classCode,
        accessAlias: fixture.accessAlias,
        pin: fixture.pin,
        clientIp: "203.0.113.63",
      }),
    ).rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED" });
  });

  it("SESSION_EXPIRED for a revoked session, and a CSRF mismatch never revokes the underlying session", async () => {
    const fixture = await buildFixture({ enrollmentStatus: "ACTIVE" });
    const sessionService = new SessionService(pool, TEST_PEPPER);
    const started = await sessionService.start({
      classCode: fixture.classCode,
      accessAlias: fixture.accessAlias,
      pin: fixture.pin,
      clientIp: "203.0.113.70",
    });

    await expect(
      sessionService.refresh({ sessionToken: started.sessionToken, csrfToken: "wrong-csrf-token" }),
    ).rejects.toMatchObject({ code: "CSRF_INVALID" });

    // The session itself must still be usable after a failed CSRF check.
    const contextStillValid = await sessionService.getContext(started.sessionToken);
    expect(contextStillValid.studentPublicId).toBe(fixture.studentPublicId);

    await pool.query("UPDATE student_session SET revoked_at = now(), revoked_reason = 'ADMIN_REVOKED' WHERE token_hash = $1", [
      hashToken(started.sessionToken),
    ]);
    await expect(sessionService.getContext(started.sessionToken)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  describe("tenant isolation via composite foreign keys (02_25 §6.11)", () => {
    it("rejects a school_enrollment referencing a class from a different tenant", async () => {
      const fixtureA = await buildFixture();
      const fixtureB = await buildFixture();

      await expect(
        pool.query(
          `INSERT INTO school_enrollment
             (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
           VALUES ($1, $2, $3, 'x', 'x', 'scrypt$v=1$N=16384$r=8$p=5$keylen=64$AAAAAAAAAAAAAAAAAAAAAA$` +
            `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'INVITED')`,
          // tenant_id from fixture A, but class_id belongs to fixture B — must violate the composite FK.
          [fixtureA.tenantId, fixtureB.classId, fixtureA.studentProfileId],
        ),
      ).rejects.toThrow();
    });

    it("rejects a student_session referencing an enrollment from a different tenant", async () => {
      const fixtureA = await buildFixture();
      const fixtureB = await buildFixture();

      await expect(
        pool.query(
          `INSERT INTO student_session
             (tenant_id, student_profile_id, enrollment_id, token_hash, csrf_token_hash, expires_at)
           VALUES ($1, $2, $3, 'sometokenhash', 'somecsrfhash', now() + interval '1 hour')`,
          // tenant_id from fixture A, but enrollment_id belongs to fixture B.
          [fixtureA.tenantId, fixtureA.studentProfileId, fixtureB.enrollmentId],
        ),
      ).rejects.toThrow();
    });
  });

  describe("FIXED_WINDOW rate limiting (D7 thresholds, real atomic upsert)", () => {
    it("allows exactly the configured limit, then blocks the next attempt with a Retry-After budget", async () => {
      const dimension = RATE_LIMITS.SESSION_START_ENROLLMENT; // limit: 5
      const bucketKey = `test-bucket-${Math.random().toString(36).slice(2, 10)}`;
      const now = new Date();

      for (let i = 1; i <= dimension.limit; i += 1) {
        const result = await checkFixedWindow(pool, dimension, bucketKey, now);
        expect(result.allowed).toBe(true);
        expect(result.count).toBe(i);
      }

      const overLimit = await checkFixedWindow(pool, dimension, bucketKey, now);
      expect(overLimit.allowed).toBe(false);
      expect(overLimit.count).toBe(dimension.limit + 1);
      expect(overLimit.retryAfterSeconds).toBeGreaterThan(0);
      expect(overLimit.retryAfterSeconds).toBeLessThanOrEqual(dimension.windowMs / 1000);
    });

    it("keeps independent counters per bucket key (per-enrollment isolation)", async () => {
      const dimension = RATE_LIMITS.SESSION_START_ENROLLMENT;
      const now = new Date();
      const a = await checkFixedWindow(pool, dimension, "bucket-a", now);
      const b = await checkFixedWindow(pool, dimension, "bucket-b", now);
      expect(a.count).toBe(1);
      expect(b.count).toBe(1);
    });

    it("resets in a new time window", async () => {
      const dimension = RATE_LIMITS.SESSION_START_ENROLLMENT;
      const bucketKey = `reset-test-${Math.random().toString(36).slice(2, 10)}`;
      const windowOne = new Date(2026, 0, 1, 10, 0, 0);
      const windowTwo = new Date(windowOne.getTime() + dimension.windowMs + 1000);

      for (let i = 0; i < dimension.limit; i += 1) {
        await checkFixedWindow(pool, dimension, bucketKey, windowOne);
      }
      const blockedInWindowOne = await checkFixedWindow(pool, dimension, bucketKey, windowOne);
      expect(blockedInWindowOne.allowed).toBe(false);

      const firstAttemptInWindowTwo = await checkFixedWindow(pool, dimension, bucketKey, windowTwo);
      expect(firstAttemptInWindowTwo.allowed).toBe(true);
      expect(firstAttemptInWindowTwo.count).toBe(1);
    });

    it("session/start returns RATE_LIMITED with Retry-After once the per-enrollment threshold is exceeded", async () => {
      const fixture = await buildFixture({ enrollmentStatus: "ACTIVE" });
      const sessionService = new SessionService(pool, TEST_PEPPER);
      const limit = RATE_LIMITS.SESSION_START_ENROLLMENT.limit;

      // Exhaust the budget with wrong-PIN attempts (each still consumes the enrollment-dimension bucket).
      for (let i = 0; i < limit; i += 1) {
        await expect(
          sessionService.start({
            classCode: fixture.classCode,
            accessAlias: fixture.accessAlias,
            pin: "000000",
            clientIp: `203.0.113.${100 + i}`,
          }),
        ).rejects.toMatchObject({ code: "ACCESS_CREDENTIALS_INVALID" });
      }

      const rateLimited = await sessionService
        .start({
          classCode: fixture.classCode,
          accessAlias: fixture.accessAlias,
          pin: fixture.pin, // even the CORRECT pin is now blocked — rate limiting happens before credential checks.
          clientIp: "203.0.113.200",
        })
        .catch((error: unknown) => error);

      expect(rateLimited).toBeInstanceOf(IdentityError);
      expect((rateLimited as IdentityError).code).toBe("RATE_LIMITED");
      expect((rateLimited as IdentityError).retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe("CHECK constraint rejections", () => {
    it("rejects an out-of-enum tenant.status", async () => {
      await expect(
        pool.query(`INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'NOT_A_STATUS', 'x')`, [
          `sch_${Math.random().toString(36).slice(2, 10)}`,
        ]),
      ).rejects.toThrow();
    });

    it("rejects school_enrollment.valid_until <= valid_from", async () => {
      const fixture = await buildFixture();
      await expect(
        pool.query(
          `INSERT INTO school_enrollment
             (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status, valid_from, valid_until)
           VALUES ($1, $2, $3, 'y', 'y', 'x', 'INVITED', now(), now() - interval '1 day')`,
          [fixture.tenantId, fixture.classId, fixture.studentProfileId],
        ),
      ).rejects.toThrow();
    });

    it("rejects student_session.expires_at <= created_at", async () => {
      const fixture = await buildFixture({ enrollmentStatus: "ACTIVE" });
      await expect(
        pool.query(
          `INSERT INTO student_session
             (tenant_id, student_profile_id, enrollment_id, token_hash, csrf_token_hash, expires_at, created_at)
           VALUES ($1, $2, $3, 'tok', 'csrf', now() - interval '1 hour', now())`,
          [fixture.tenantId, fixture.studentProfileId, fixture.enrollmentId],
        ),
      ).rejects.toThrow();
    });

    it("rejects rate_limit_bucket.count < 0", async () => {
      await expect(
        pool.query(
          `INSERT INTO rate_limit_bucket (scope, bucket_key, window_start, count) VALUES ('TEST', 'key', now(), -1)`,
        ),
      ).rejects.toThrow();
    });

    it("rejects an empty access_alias_normalized", async () => {
      const fixture = await buildFixture();
      await expect(
        pool.query(
          `INSERT INTO school_enrollment
             (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
           VALUES ($1, $2, $3, 'z', '   ', 'x', 'INVITED')`,
          [fixture.tenantId, fixture.classId, fixture.studentProfileId],
        ),
      ).rejects.toThrow();
    });

    it("rejects a student_session with revoked_at set but revoked_reason null (and vice versa)", async () => {
      const fixture = await buildFixture({ enrollmentStatus: "ACTIVE" });
      await expect(
        pool.query(
          `INSERT INTO student_session
             (tenant_id, student_profile_id, enrollment_id, token_hash, csrf_token_hash, expires_at, revoked_at, revoked_reason)
           VALUES ($1, $2, $3, 'tok2', 'csrf2', now() + interval '1 hour', now(), NULL)`,
          [fixture.tenantId, fixture.studentProfileId, fixture.enrollmentId],
        ),
      ).rejects.toThrow();
    });

    it("rejects a generic revoked_reason value (USER_LOGOUT/EXPIRED are not valid — D5 correction)", async () => {
      const fixture = await buildFixture({ enrollmentStatus: "ACTIVE" });
      await expect(
        pool.query(
          `INSERT INTO student_session
             (tenant_id, student_profile_id, enrollment_id, token_hash, csrf_token_hash, expires_at, revoked_at, revoked_reason)
           VALUES ($1, $2, $3, 'tok3', 'csrf3', now() + interval '1 hour', now(), 'EXPIRED')`,
          [fixture.tenantId, fixture.studentProfileId, fixture.enrollmentId],
        ),
      ).rejects.toThrow();
    });
  });
});
