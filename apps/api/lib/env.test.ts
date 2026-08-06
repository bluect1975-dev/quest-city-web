import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it("returns defaults for HEALTH_READY_DB_TIMEOUT_MS when unset", () => {
    const env = loadEnv({ DATABASE_URL: "postgresql://u:p@localhost:5432/db" });
    expect(env.healthReadyDbTimeoutMs).toBe(2000);
    expect(env.databaseSsl).toBe(false);
  });

  it("parses a custom timeout and SSL flag", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      DATABASE_SSL: "true",
      HEALTH_READY_DB_TIMEOUT_MS: "500",
    });
    expect(env.healthReadyDbTimeoutMs).toBe(500);
    expect(env.databaseSsl).toBe(true);
  });

  it("rejects a non-numeric timeout", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        HEALTH_READY_DB_TIMEOUT_MS: "not-a-number",
      }),
    ).toThrow(/HEALTH_READY_DB_TIMEOUT_MS/);
  });
});
