import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateStagingEnv } from "./validate-staging-env.mjs";

const VALID_PEPPER = randomBytes(32).toString("base64");

function validStagingEnv(overrides = {}) {
  return {
    STAGING_ENV_STRICT: "true",
    DATABASE_SSL: "true",
    SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL: "false",
    CLASS_CODE_HASH_PEPPER: VALID_PEPPER,
    STAGING_POSTGRES_PASSWORD: "a-real-staging-password",
    WEB_AUTH_TRUSTED_ORIGINS: "https://staging.example.org",
    STAFF_AUTH_TRUSTED_ORIGINS: "https://staging.example.org",
    PLATFORM_AUTH_TRUSTED_ORIGINS: "https://staging.example.org",
    NEXT_PUBLIC_API_BASE_URL: "https://staging.example.org/api",
    NEXT_PUBLIC_API_BASE_URL_DASHBOARD: "https://staging.example.org/api",
    ...overrides,
  };
}

describe("validateStagingEnv", () => {
  it("is a no-op when STAGING_ENV_STRICT is unset (local dev / CI behavior unaffected)", () => {
    const result = validateStagingEnv({});
    expect(result.skipped).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("is a no-op for any value other than the exact string 'true'", () => {
    const result = validateStagingEnv({ STAGING_ENV_STRICT: "1" });
    expect(result.skipped).toBe(true);
  });

  it("passes with a fully valid staging environment", () => {
    const result = validateStagingEnv(validStagingEnv());
    expect(result.skipped).toBe(false);
    expect(result.failures).toEqual([]);
  });

  it("fails when DATABASE_SSL is not 'true'", () => {
    const result = validateStagingEnv(validStagingEnv({ DATABASE_SSL: "false" }));
    expect(result.failures.some((f) => f.includes("DATABASE_SSL"))).toBe(true);
  });

  it("fails when the insecure cookie override is active", () => {
    const result = validateStagingEnv(validStagingEnv({ SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL: "true" }));
    expect(result.failures.some((f) => f.includes("SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL"))).toBe(true);
  });

  it("fails when CLASS_CODE_HASH_PEPPER is missing", () => {
    const result = validateStagingEnv(validStagingEnv({ CLASS_CODE_HASH_PEPPER: undefined }));
    expect(result.failures.some((f) => f.includes("CLASS_CODE_HASH_PEPPER"))).toBe(true);
  });

  it("fails when CLASS_CODE_HASH_PEPPER decodes to fewer than 32 bytes", () => {
    const tooShort = randomBytes(16).toString("base64");
    const result = validateStagingEnv(validStagingEnv({ CLASS_CODE_HASH_PEPPER: tooShort }));
    expect(result.failures.some((f) => f.includes("32 bytes"))).toBe(true);
  });

  it("fails when STAGING_POSTGRES_PASSWORD still contains the local/CI placeholder value", () => {
    const result = validateStagingEnv(validStagingEnv({ STAGING_POSTGRES_PASSWORD: "changeme_local_only" }));
    expect(result.failures.some((f) => f.includes("STAGING_POSTGRES_PASSWORD"))).toBe(true);
  });

  it("fails when a CSRF origin is missing", () => {
    const result = validateStagingEnv(validStagingEnv({ WEB_AUTH_TRUSTED_ORIGINS: undefined }));
    expect(result.failures.some((f) => f.includes("WEB_AUTH_TRUSTED_ORIGINS"))).toBe(true);
  });

  it("fails when a CSRF origin points at localhost", () => {
    const result = validateStagingEnv(validStagingEnv({ STAFF_AUTH_TRUSTED_ORIGINS: "http://localhost:3001" }));
    expect(result.failures.some((f) => f.includes("STAFF_AUTH_TRUSTED_ORIGINS"))).toBe(true);
  });

  it("fails when a CSRF origin is not https", () => {
    const result = validateStagingEnv(validStagingEnv({ PLATFORM_AUTH_TRUSTED_ORIGINS: "http://staging.example.org" }));
    expect(result.failures.some((f) => f.includes("PLATFORM_AUTH_TRUSTED_ORIGINS"))).toBe(true);
  });

  it("fails when the domain is still the unreplaced template placeholder", () => {
    const result = validateStagingEnv(
      validStagingEnv({ NEXT_PUBLIC_API_BASE_URL: "https://REPLACE_WITH_STAGING_DOMAIN/api" }),
    );
    expect(result.failures.some((f) => f.includes("NEXT_PUBLIC_API_BASE_URL"))).toBe(true);
  });

  it("fails when the domain is missing", () => {
    const result = validateStagingEnv(validStagingEnv({ NEXT_PUBLIC_API_BASE_URL_DASHBOARD: undefined }));
    expect(result.failures.some((f) => f.includes("NEXT_PUBLIC_API_BASE_URL_DASHBOARD"))).toBe(true);
  });

  it("accumulates multiple independent failures in one pass, not just the first", () => {
    const result = validateStagingEnv(
      validStagingEnv({ DATABASE_SSL: "false", CLASS_CODE_HASH_PEPPER: undefined }),
    );
    expect(result.failures.length).toBeGreaterThanOrEqual(2);
  });

  it("warns (does not fail) when BACKUP_ENCRYPTION_KEY is unset", () => {
    const result = validateStagingEnv(validStagingEnv());
    expect(result.failures).toEqual([]);
    expect(result.warnings.some((w) => w.includes("BACKUP_ENCRYPTION_KEY"))).toBe(true);
  });

  it("does not warn about BACKUP_ENCRYPTION_KEY once it is set", () => {
    const result = validateStagingEnv(validStagingEnv({ BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64") }));
    expect(result.warnings.some((w) => w.includes("BACKUP_ENCRYPTION_KEY"))).toBe(false);
  });

  describe("off-site backup target (Tranche E3, GAP-02)", () => {
    it("warns (does not fail) when BACKUP_TARGET_ADAPTER is unset", () => {
      const result = validateStagingEnv(validStagingEnv());
      expect(result.failures).toEqual([]);
      expect(result.warnings.some((w) => w.includes("BACKUP_TARGET_ADAPTER"))).toBe(true);
    });

    it("does not warn once BACKUP_TARGET_ADAPTER=s3 with a full config", () => {
      const result = validateStagingEnv(
        validStagingEnv({
          BACKUP_TARGET_ADAPTER: "s3",
          BACKUP_S3_BUCKET: "bucket",
          BACKUP_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
          BACKUP_S3_ACCESS_KEY_ID: "id",
          BACKUP_S3_SECRET_ACCESS_KEY: "secret",
        }),
      );
      expect(result.failures).toEqual([]);
      expect(result.warnings.some((w) => w.includes("BACKUP_TARGET_ADAPTER"))).toBe(false);
    });

    it.each(["BACKUP_S3_BUCKET", "BACKUP_S3_ENDPOINT", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"])(
      "fails when BACKUP_TARGET_ADAPTER=s3 and %s is missing",
      (missingVar) => {
        const fullConfig = {
          BACKUP_TARGET_ADAPTER: "s3",
          BACKUP_S3_BUCKET: "bucket",
          BACKUP_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
          BACKUP_S3_ACCESS_KEY_ID: "id",
          BACKUP_S3_SECRET_ACCESS_KEY: "secret",
        };
        delete fullConfig[missingVar];
        const result = validateStagingEnv(validStagingEnv(fullConfig));
        expect(result.failures.some((f) => f.includes(missingVar))).toBe(true);
      },
    );
  });

  describe("Telegram alert channel — both variables or neither (mirrors provision-telegram-alert-channel.ts)", () => {
    it("warns (does not fail) when neither TELEGRAM_BOT_TOKEN nor TELEGRAM_CHAT_ID is set", () => {
      const result = validateStagingEnv(validStagingEnv());
      expect(result.failures).toEqual([]);
      expect(result.warnings.some((w) => w.includes("TELEGRAM"))).toBe(true);
    });

    it("passes with no Telegram warning when both are set", () => {
      const result = validateStagingEnv(
        validStagingEnv({ TELEGRAM_BOT_TOKEN: "123456789:fake-token-shape", TELEGRAM_CHAT_ID: "555000111" }),
      );
      expect(result.failures).toEqual([]);
      expect(result.warnings.some((w) => w.includes("TELEGRAM"))).toBe(false);
    });

    it("fails when only TELEGRAM_BOT_TOKEN is set", () => {
      const result = validateStagingEnv(validStagingEnv({ TELEGRAM_BOT_TOKEN: "123456789:fake-token-shape" }));
      expect(result.failures.some((f) => f.includes("TELEGRAM_CHAT_ID"))).toBe(true);
    });

    it("fails when only TELEGRAM_CHAT_ID is set", () => {
      const result = validateStagingEnv(validStagingEnv({ TELEGRAM_CHAT_ID: "555000111" }));
      expect(result.failures.some((f) => f.includes("TELEGRAM_BOT_TOKEN"))).toBe(true);
    });

    it("never includes the Bot Token's own value in a failure message", () => {
      const secretShapedToken = "123456789:super-secret-should-not-leak";
      const result = validateStagingEnv(validStagingEnv({ TELEGRAM_BOT_TOKEN: secretShapedToken }));
      const allMessages = [...result.failures, ...result.warnings].join(" ");
      expect(allMessages).not.toContain(secretShapedToken);
    });
  });
});
