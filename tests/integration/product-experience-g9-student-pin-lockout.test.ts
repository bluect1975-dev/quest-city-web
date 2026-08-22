import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  IdentityError,
  SessionService,
  generateClassCode,
  generatePin,
  hashPin,
  hashClassCode,
  normalizeAlias,
  normalizeClassCode,
  DEFAULT_SESSION_SECURITY_CONFIG,
} from "@quest-city-web/identity";

/**
 * Pilot Product Experience Remediation, Tranche G9 (`SEC-STUDENT-PIN-01`)
 * — per-account PIN lockout, closing the gap the mission's own errata
 * disclosed: student PIN login had fixed-window rate limiting (IP-wide and
 * per-enrollment) but no persistent lockout, so an attacker could keep
 * guessing indefinitely across successive 15-minute reset windows.
 *
 * Uses a lower `maxFailedPinAttempts` (3) than the real default (10) so
 * the lockout threshold is reached BEFORE the pre-existing
 * `SESSION_START_ENROLLMENT` fixed-window limit (5 attempts/15min, same
 * bucket key: classId+alias) would otherwise trip first and mask the
 * lockout behavior under test.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- product-experience-g9-student-pin-lockout
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });
const TEST_PEPPER = Buffer.from("dGVzdC1wZXBwZXItZm9yLWlkZW50aXR5LWZsb3ctdGVzdHMh", "base64url");
const LOW_THRESHOLD_CONFIG = { ...DEFAULT_SESSION_SECURITY_CONFIG, maxFailedPinAttempts: 3, pinLockoutDurationSeconds: 300 };

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function buildFixture() {
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
  const classCode = generateClassCode();
  await pool.query(`INSERT INTO class_access_code (tenant_id, class_id, code_hash, status) VALUES ($1, $2, $3, 'ACTIVE')`, [
    tenantId,
    classId,
    hashClassCode(normalizeClassCode(classCode), TEST_PEPPER),
  ]);
  const studentProfileId = (
    await pool.query<{ id: string }>(
      `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [tenantId, `std_${rnd()}`],
    )
  ).rows[0]!.id;
  const accessAlias = `Alias${rnd()}`;
  const pin = generatePin();
  const enrollmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_enrollment
         (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE') RETURNING id`,
      [tenantId, classId, studentProfileId, accessAlias, normalizeAlias(accessAlias), await hashPin(pin)],
    )
  ).rows[0]!.id;
  return { tenantId, classId, classCode, accessAlias, pin, enrollmentId };
}

describe("Student PIN lockout (SEC-STUDENT-PIN-01, real Postgres)", () => {
  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("locks the account after maxFailedPinAttempts wrong PINs, rejecting even the CORRECT pin while locked", async () => {
    const fixture = await buildFixture();
    const sessionService = new SessionService(pool, TEST_PEPPER, LOW_THRESHOLD_CONFIG);

    for (let i = 0; i < LOW_THRESHOLD_CONFIG.maxFailedPinAttempts - 1; i += 1) {
      const rejected = await sessionService
        .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: "000000", clientIp: `198.51.100.${i}` })
        .catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(IdentityError);
      expect((rejected as IdentityError).code).toBe("ACCESS_CREDENTIALS_INVALID");
    }

    const lockingAttempt = await sessionService
      .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: "000000", clientIp: "198.51.100.50" })
      .catch((error: unknown) => error);
    expect(lockingAttempt).toBeInstanceOf(IdentityError);
    expect((lockingAttempt as IdentityError).code).toBe("STUDENT_ACCOUNT_LOCKED");

    const correctPinWhileLocked = await sessionService
      .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: fixture.pin, clientIp: "198.51.100.51" })
      .catch((error: unknown) => error);
    expect(correctPinWhileLocked).toBeInstanceOf(IdentityError);
    expect((correctPinWhileLocked as IdentityError).code).toBe("STUDENT_ACCOUNT_LOCKED");
  });

  it("carries a positive retryAfterSeconds on the locking response", async () => {
    const fixture = await buildFixture();
    const sessionService = new SessionService(pool, TEST_PEPPER, LOW_THRESHOLD_CONFIG);

    for (let i = 0; i < LOW_THRESHOLD_CONFIG.maxFailedPinAttempts; i += 1) {
      await sessionService
        .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: "000000", clientIp: `198.51.100.${60 + i}` })
        .catch(() => undefined);
    }
    const locked = await sessionService
      .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: fixture.pin, clientIp: "198.51.100.70" })
      .catch((error: unknown) => error);
    expect((locked as IdentityError).retryAfterSeconds).toBeGreaterThan(0);
    expect((locked as IdentityError).retryAfterSeconds).toBeLessThanOrEqual(LOW_THRESHOLD_CONFIG.pinLockoutDurationSeconds);
  });

  it("a correct PIN before the threshold succeeds and resets the failure counter", async () => {
    const fixture = await buildFixture();
    const sessionService = new SessionService(pool, TEST_PEPPER, LOW_THRESHOLD_CONFIG);

    await sessionService
      .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: "000000", clientIp: "198.51.100.80" })
      .catch(() => undefined);

    const success = await sessionService.start({
      classCode: fixture.classCode,
      accessAlias: fixture.accessAlias,
      pin: fixture.pin,
      clientIp: "198.51.100.81",
    });
    expect(success.studentPublicId).toBeTruthy();

    const row = await pool.query<{ failed_pin_count: number; pin_locked_until: Date | null }>(
      `SELECT failed_pin_count, pin_locked_until FROM school_enrollment WHERE id = $1`,
      [fixture.enrollmentId],
    );
    expect(row.rows[0]!.failed_pin_count).toBe(0);
    expect(row.rows[0]!.pin_locked_until).toBeNull();
  });

  it("never locks a DIFFERENT enrollment in the same class (per-account, not per-class)", async () => {
    const fixture = await buildFixture();
    const otherAlias = `Other${rnd()}`;
    const otherPin = generatePin();
    await pool.query(
      `INSERT INTO school_enrollment
         (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
      [
        fixture.tenantId,
        fixture.classId,
        (
          await pool.query<{ id: string }>(
            `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
            [fixture.tenantId, `std_${rnd()}`],
          )
        ).rows[0]!.id,
        otherAlias,
        normalizeAlias(otherAlias),
        await hashPin(otherPin),
      ],
    );

    const sessionService = new SessionService(pool, TEST_PEPPER, LOW_THRESHOLD_CONFIG);
    for (let i = 0; i < LOW_THRESHOLD_CONFIG.maxFailedPinAttempts; i += 1) {
      await sessionService
        .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: "000000", clientIp: `198.51.100.${90 + i}` })
        .catch(() => undefined);
    }

    const otherStudentLogin = await sessionService.start({
      classCode: fixture.classCode,
      accessAlias: otherAlias,
      pin: otherPin,
      clientIp: "198.51.100.99",
    });
    expect(otherStudentLogin.studentPublicId).toBeTruthy();
  });

  it("never locks the same alias in a DIFFERENT tenant/class (tenant-scoped, not global)", async () => {
    const fixture = await buildFixture();
    const otherClassId = (
      await pool.query<{ id: string }>(
        `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Other Class', 'ACTIVE') RETURNING id`,
        [fixture.tenantId, `cls_${rnd()}`],
      )
    ).rows[0]!.id;
    const otherClassCode = generateClassCode();
    await pool.query(`INSERT INTO class_access_code (tenant_id, class_id, code_hash, status) VALUES ($1, $2, $3, 'ACTIVE')`, [
      fixture.tenantId,
      otherClassId,
      hashClassCode(normalizeClassCode(otherClassCode), TEST_PEPPER),
    ]);
    const otherPin = generatePin();
    await pool.query(
      `INSERT INTO school_enrollment
         (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
      [
        fixture.tenantId,
        otherClassId,
        (
          await pool.query<{ id: string }>(
            `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
            [fixture.tenantId, `std_${rnd()}`],
          )
        ).rows[0]!.id,
        fixture.accessAlias,
        normalizeAlias(fixture.accessAlias),
        await hashPin(otherPin),
      ],
    );

    const sessionService = new SessionService(pool, TEST_PEPPER, LOW_THRESHOLD_CONFIG);
    for (let i = 0; i < LOW_THRESHOLD_CONFIG.maxFailedPinAttempts; i += 1) {
      await sessionService
        .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: "000000", clientIp: `198.51.100.${110 + i}` })
        .catch(() => undefined);
    }

    const otherClassLogin = await sessionService.start({
      classCode: otherClassCode,
      accessAlias: fixture.accessAlias,
      pin: otherPin,
      clientIp: "198.51.100.120",
    });
    expect(otherClassLogin.studentPublicId).toBeTruthy();
  });
});
