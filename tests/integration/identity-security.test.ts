import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  ClassCodeService,
  IdentityError,
  RATE_LIMITS,
  SessionService,
  generateClassCode,
  generatePin,
  hashPin,
  hashClassCode,
  normalizeAlias,
  normalizeClassCode,
} from "@quest-city-web/identity";

/**
 * WEB-M1 Fase 2 security-focused integration tests (real Postgres — see
 * identity-flow.test.ts for the container/connection convention).
 * Complements identity-flow.test.ts's SESSION_START_ENROLLMENT rate-limit
 * coverage with the remaining 3 dimensions, plus audit-log and
 * response-shape secret-exposure checks.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5555/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

// Fixed 32-byte test pepper (base64-decoded) — never used outside this test suite.
const TEST_PEPPER = Buffer.from("dGVzdC1wZXBwZXItZm9yLWlkZW50aXR5LWZsb3ctdGVzdHMh", "base64url");

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

async function buildFixture() {
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
  await pool.query(
    `INSERT INTO school_enrollment
       (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
    [tenantRow.id, classRow.id, profileRow.id, accessAlias, normalizeAlias(accessAlias), await hashPin(pin)],
  );

  return { tenantId: tenantRow.id, classCode, accessAlias, pin, studentPublicId };
}

describe("WEB-M1 Fase 2 security tests (real Postgres)", () => {
  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe("rate limiting — remaining 3 dimensions (D7)", () => {
    it("class-code/resolve: blocks after the per-IP limit (30)", async () => {
      const fixture = await buildFixture();
      const classCodeService = new ClassCodeService(pool, TEST_PEPPER);
      const ip = "198.51.100.10";
      const limit = RATE_LIMITS.CLASS_CODE_RESOLVE_IP.limit;

      for (let i = 0; i < limit; i += 1) {
        await classCodeService.resolve(fixture.classCode, ip);
      }
      const blocked = await classCodeService.resolve(fixture.classCode, ip).catch((error: unknown) => error);
      expect(blocked).toBeInstanceOf(IdentityError);
      expect((blocked as IdentityError).code).toBe("RATE_LIMITED");
    }, 20000);

    it("class-code/resolve: blocks after the per-code limit (60) even across many distinct IPs", async () => {
      const fixture = await buildFixture();
      const classCodeService = new ClassCodeService(pool, TEST_PEPPER);
      const limit = RATE_LIMITS.CLASS_CODE_RESOLVE_CODE.limit;

      // Distinct IPs so the per-IP dimension (30) never trips first — proves
      // the per-code dimension is independently enforced.
      for (let i = 0; i < limit; i += 1) {
        await classCodeService.resolve(fixture.classCode, `198.51.100.${20 + (i % 200)}`);
      }
      const blocked = await classCodeService
        .resolve(fixture.classCode, "198.51.100.250")
        .catch((error: unknown) => error);
      expect(blocked).toBeInstanceOf(IdentityError);
      expect((blocked as IdentityError).code).toBe("RATE_LIMITED");
    }, 20000);

    it("session/start: blocks after the per-IP limit (30), independent of enrollment", async () => {
      const fixture = await buildFixture();
      const sessionService = new SessionService(pool, TEST_PEPPER);
      const ip = "198.51.100.99";
      const limit = RATE_LIMITS.SESSION_START_IP.limit;

      for (let i = 0; i < limit; i += 1) {
        await sessionService
          .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: "000000", clientIp: ip })
          .catch(() => undefined);
      }
      const blocked = await sessionService
        .start({ classCode: fixture.classCode, accessAlias: fixture.accessAlias, pin: fixture.pin, clientIp: ip })
        .catch((error: unknown) => error);
      expect(blocked).toBeInstanceOf(IdentityError);
      expect((blocked as IdentityError).code).toBe("RATE_LIMITED");
    }, 20000);
  });

  describe("no secret ever reaches the audit log or a service response object", () => {
    it("audit_event rows never contain the PIN, class code or a raw token", async () => {
      const fixture = await buildFixture();
      const classCodeService = new ClassCodeService(pool, TEST_PEPPER);
      const sessionService = new SessionService(pool, TEST_PEPPER);

      await classCodeService.resolve(fixture.classCode, "203.0.113.10");
      const started = await sessionService.start({
        classCode: fixture.classCode,
        accessAlias: fixture.accessAlias,
        pin: fixture.pin,
        clientIp: "203.0.113.10",
      });
      await sessionService.refresh({ sessionToken: started.sessionToken, csrfToken: started.csrfToken });

      const events = await pool.query<{ metadata_redacted: unknown; action: string }>(
        "SELECT action, metadata_redacted FROM audit_event",
      );
      expect(events.rows.length).toBeGreaterThan(0);

      const serialized = JSON.stringify(events.rows);
      expect(serialized).not.toContain(fixture.pin);
      expect(serialized).not.toContain(fixture.classCode);
      expect(serialized).not.toContain(started.sessionToken);
      expect(serialized).not.toContain(started.csrfToken);
    });

    it("SessionStartResult never carries a pinHash-shaped field", async () => {
      const fixture = await buildFixture();
      const sessionService = new SessionService(pool, TEST_PEPPER);
      const started = await sessionService.start({
        classCode: fixture.classCode,
        accessAlias: fixture.accessAlias,
        pin: fixture.pin,
        clientIp: "203.0.113.20",
      });
      expect(Object.keys(started)).not.toContain("pinHash");
      expect(Object.keys(started)).not.toContain("pin");
      expect(JSON.stringify(started)).not.toContain(fixture.pin);
    });

    it("StudentContext (the /me/student-context payload) never carries a pin or token field", async () => {
      const fixture = await buildFixture();
      const sessionService = new SessionService(pool, TEST_PEPPER);
      const started = await sessionService.start({
        classCode: fixture.classCode,
        accessAlias: fixture.accessAlias,
        pin: fixture.pin,
        clientIp: "203.0.113.30",
      });
      const context = await sessionService.getContext(started.sessionToken);
      expect(Object.keys(context).sort()).toEqual(
        ["classPublicId", "displayAlias", "enrollmentStatus", "studentPublicId", "tenantPublicId"].sort(),
      );
    });
  });

  describe("idempotent logout across every session state", () => {
    it("is a no-op with no thrown error for: no cookie, garbage token, and an already-revoked session", async () => {
      const fixture = await buildFixture();
      const sessionService = new SessionService(pool, TEST_PEPPER);

      await expect(sessionService.logout({ sessionToken: null, csrfToken: null })).resolves.toBeUndefined();
      await expect(
        sessionService.logout({ sessionToken: "not-a-real-token", csrfToken: "not-a-real-csrf" }),
      ).resolves.toBeUndefined();

      const started = await sessionService.start({
        classCode: fixture.classCode,
        accessAlias: fixture.accessAlias,
        pin: fixture.pin,
        clientIp: "203.0.113.40",
      });
      await sessionService.logout({ sessionToken: started.sessionToken, csrfToken: started.csrfToken });
      await expect(
        sessionService.logout({ sessionToken: started.sessionToken, csrfToken: started.csrfToken }),
      ).resolves.toBeUndefined();
    });
  });
});
