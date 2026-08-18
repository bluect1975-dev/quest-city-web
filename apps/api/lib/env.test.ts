import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

// A valid 32-byte pepper, base64-encoded — used everywhere a test isn't
// specifically exercising CLASS_CODE_HASH_PEPPER's own validation, since
// loadEnv now requires it unconditionally (WEB-M1 Fase 2 correction #1:
// "nessun valore di default").
const VALID_PEPPER = randomBytes(32).toString("base64");

function baseSource(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    CLASS_CODE_HASH_PEPPER: VALID_PEPPER,
    ...overrides,
  };
}

describe("loadEnv", () => {
  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadEnv({ CLASS_CODE_HASH_PEPPER: VALID_PEPPER })).toThrow(/DATABASE_URL/);
  });

  it("returns defaults for HEALTH_READY_DB_TIMEOUT_MS when unset", () => {
    const env = loadEnv(baseSource());
    expect(env.healthReadyDbTimeoutMs).toBe(2000);
    expect(env.databaseSsl).toBe(false);
  });

  it("parses a custom timeout and SSL flag", () => {
    const env = loadEnv(baseSource({ DATABASE_SSL: "true", HEALTH_READY_DB_TIMEOUT_MS: "500" }));
    expect(env.healthReadyDbTimeoutMs).toBe(500);
    expect(env.databaseSsl).toBe(true);
  });

  it("rejects a non-numeric timeout", () => {
    expect(() => loadEnv(baseSource({ HEALTH_READY_DB_TIMEOUT_MS: "not-a-number" }))).toThrow(
      /HEALTH_READY_DB_TIMEOUT_MS/,
    );
  });

  describe("WEB-M1 Fase 2 — session security parameters", () => {
    it("defaults to the approved 12h absolute / 60min inactivity TTL baseline", () => {
      const env = loadEnv(baseSource());
      expect(env.sessionAbsoluteTtlSeconds).toBe(12 * 60 * 60);
      expect(env.sessionInactivityTtlSeconds).toBe(60 * 60);
    });

    it("defaults sessionCookieName to qc_web_session", () => {
      const env = loadEnv(baseSource());
      expect(env.sessionCookieName).toBe("qc_web_session");
    });

    it("defaults nodeEnv to development when NODE_ENV is unset", () => {
      const env = loadEnv(baseSource());
      expect(env.nodeEnv).toBe("development");
    });

    describe("SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL — must never activate outside development (correction report §6)", () => {
      it("activates when explicitly true AND NODE_ENV=development", () => {
        const env = loadEnv(
          baseSource({ NODE_ENV: "development", SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL: "true" }),
        );
        expect(env.sessionCookieSecureOverrideInsecureLocal).toBe(true);
      });

      it("is ignored when NODE_ENV=production, even if set to true", () => {
        const env = loadEnv(
          baseSource({ NODE_ENV: "production", SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL: "true" }),
        );
        expect(env.sessionCookieSecureOverrideInsecureLocal).toBe(false);
      });

      it("is ignored when NODE_ENV=staging, even if set to true", () => {
        const env = loadEnv(baseSource({ NODE_ENV: "staging", SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL: "true" }));
        expect(env.sessionCookieSecureOverrideInsecureLocal).toBe(false);
      });

      it("defaults to false in development when unset", () => {
        const env = loadEnv(baseSource({ NODE_ENV: "development" }));
        expect(env.sessionCookieSecureOverrideInsecureLocal).toBe(false);
      });

      it("requires the exact string 'true' — any other value is treated as false", () => {
        const env = loadEnv(baseSource({ NODE_ENV: "development", SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL: "1" }));
        expect(env.sessionCookieSecureOverrideInsecureLocal).toBe(false);
      });
    });

    it("parses WEB_AUTH_TRUSTED_ORIGINS as a comma-separated, trimmed list", () => {
      const env = loadEnv(baseSource({ WEB_AUTH_TRUSTED_ORIGINS: " http://localhost:3000 , http://localhost:8080 " }));
      expect(env.webAuthTrustedOrigins).toEqual(["http://localhost:3000", "http://localhost:8080"]);
    });
  });

  describe("WEB-M3B — staff session parameters (02_35 §4.4)", () => {
    it("defaults staffSessionCookieName to qc_staff_session, distinct from sessionCookieName", () => {
      const env = loadEnv(baseSource());
      expect(env.staffSessionCookieName).toBe("qc_staff_session");
      expect(env.staffSessionCookieName).not.toBe(env.sessionCookieName);
    });

    it("defaults to the same 12h absolute / 60min inactivity TTL baseline as the student session", () => {
      const env = loadEnv(baseSource());
      expect(env.staffSessionAbsoluteTtlSeconds).toBe(12 * 60 * 60);
      expect(env.staffSessionInactivityTtlSeconds).toBe(60 * 60);
    });

    it("parses custom staff session TTLs independently from the student session ones", () => {
      const env = loadEnv(
        baseSource({ STAFF_SESSION_ABSOLUTE_TTL_SECONDS: "600", SESSION_ABSOLUTE_TTL_SECONDS: "999" }),
      );
      expect(env.staffSessionAbsoluteTtlSeconds).toBe(600);
      expect(env.sessionAbsoluteTtlSeconds).toBe(999);
    });
  });

  describe("CLASS_CODE_HASH_PEPPER (WEB-M1 Fase 2 correction #1) — no default, ever", () => {
    it("decodes a valid pepper into a 32+ byte Buffer", () => {
      const env = loadEnv(baseSource());
      expect(Buffer.isBuffer(env.classCodeHashPepper)).toBe(true);
      expect(env.classCodeHashPepper.length).toBeGreaterThanOrEqual(32);
    });

    it("startup fails in production when the pepper is missing", () => {
      expect(() => loadEnv({ DATABASE_URL: "postgresql://u:p@localhost:5432/db", NODE_ENV: "production" })).toThrow(
        /CLASS_CODE_HASH_PEPPER/,
      );
    });

    it("startup fails in staging when the pepper is missing", () => {
      expect(() => loadEnv({ DATABASE_URL: "postgresql://u:p@localhost:5432/db", NODE_ENV: "staging" })).toThrow(
        /CLASS_CODE_HASH_PEPPER/,
      );
    });

    it("startup fails in development too — there is no environment where a missing pepper is tolerated", () => {
      expect(() => loadEnv({ DATABASE_URL: "postgresql://u:p@localhost:5432/db", NODE_ENV: "development" })).toThrow(
        /CLASS_CODE_HASH_PEPPER/,
      );
    });

    it("startup fails in production when the pepper decodes to fewer than 32 bytes", () => {
      const tooShort = randomBytes(16).toString("base64");
      expect(() =>
        loadEnv({
          DATABASE_URL: "postgresql://u:p@localhost:5432/db",
          NODE_ENV: "production",
          CLASS_CODE_HASH_PEPPER: tooShort,
        }),
      ).toThrow(/at least 32 bytes/);
    });

    it("never includes the raw pepper value in the thrown error message", () => {
      const tooShort = randomBytes(16).toString("base64");
      try {
        loadEnv({ DATABASE_URL: "postgresql://u:p@localhost:5432/db", CLASS_CODE_HASH_PEPPER: tooShort });
        throw new Error("expected loadEnv to throw");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(tooShort);
      }
    });

    it("is distinct from other configured secrets/values (does not collide with DATABASE_URL et al.)", () => {
      const env = loadEnv(baseSource());
      const pepperB64 = env.classCodeHashPepper.toString("base64");
      expect(pepperB64).not.toBe(env.databaseUrl);
      expect(pepperB64).not.toContain(env.sessionCookieName);
    });
  });

  describe("Tranche E — per-pool connection tuning (design report §19)", () => {
    it("defaults reproduce the values every pool hardcoded before these variables existed", () => {
      const env = loadEnv(baseSource());
      expect(env.dbPoolHealthMax).toBe(5);
      expect(env.dbPoolHealthIdleTimeoutMs).toBe(10000);
      expect(env.dbPoolAttemptsMax).toBe(10);
      expect(env.dbPoolAttemptsIdleTimeoutMs).toBe(10000);
      expect(env.dbPoolAttemptsConnectionTimeoutMs).toBe(0);
      expect(env.dbPoolIdentityMax).toBe(10);
      expect(env.dbPoolIdentityIdleTimeoutMs).toBe(10000);
      expect(env.dbPoolIdentityConnectionTimeoutMs).toBe(0);
      expect(env.dbPoolStaffIdentityMax).toBe(10);
      expect(env.dbPoolStaffIdentityIdleTimeoutMs).toBe(10000);
      expect(env.dbPoolStaffIdentityConnectionTimeoutMs).toBe(0);
      expect(env.dbPoolPlatformIdentityMax).toBe(10);
      expect(env.dbPoolPlatformIdentityIdleTimeoutMs).toBe(10000);
      expect(env.dbPoolPlatformIdentityConnectionTimeoutMs).toBe(0);
    });

    it("honors staging-style overrides for every pool independently", () => {
      const env = loadEnv(
        baseSource({
          DB_POOL_HEALTH_MAX: "2",
          DB_POOL_ATTEMPTS_MAX: "8",
          DB_POOL_ATTEMPTS_IDLE_TIMEOUT_MS: "30000",
          DB_POOL_ATTEMPTS_CONNECTION_TIMEOUT_MS: "5000",
          DB_POOL_IDENTITY_MAX: "6",
          DB_POOL_STAFF_IDENTITY_MAX: "6",
          DB_POOL_PLATFORM_IDENTITY_MAX: "4",
        }),
      );
      expect(env.dbPoolHealthMax).toBe(2);
      expect(env.dbPoolAttemptsMax).toBe(8);
      expect(env.dbPoolAttemptsIdleTimeoutMs).toBe(30000);
      expect(env.dbPoolAttemptsConnectionTimeoutMs).toBe(5000);
      expect(env.dbPoolIdentityMax).toBe(6);
      expect(env.dbPoolStaffIdentityMax).toBe(6);
      expect(env.dbPoolPlatformIdentityMax).toBe(4);
    });

    it("accepts an explicit 0 connection timeout (pg's own 'wait indefinitely' default)", () => {
      const env = loadEnv(baseSource({ DB_POOL_IDENTITY_CONNECTION_TIMEOUT_MS: "0" }));
      expect(env.dbPoolIdentityConnectionTimeoutMs).toBe(0);
    });

    it("rejects a negative pool max", () => {
      expect(() => loadEnv(baseSource({ DB_POOL_ATTEMPTS_MAX: "-1" }))).toThrow(/DB_POOL_ATTEMPTS_MAX/);
    });

    it("rejects a negative idle timeout", () => {
      expect(() => loadEnv(baseSource({ DB_POOL_ATTEMPTS_IDLE_TIMEOUT_MS: "-1" }))).toThrow(
        /DB_POOL_ATTEMPTS_IDLE_TIMEOUT_MS/,
      );
    });
  });
});
