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
});
