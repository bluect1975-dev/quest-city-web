import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./provision-external-monitor-key.ts";

const SAVED_ENV = { ...process.env };
const KEYS = [
  "EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT",
  "EXTERNAL_MONITOR_HMAC_SECRET_CURRENT",
  "EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS",
  "EXTERNAL_MONITOR_HMAC_SECRET_PREVIOUS",
  "DATABASE_URL",
];

function resetEnv() {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, SAVED_ENV);
  for (const key of KEYS) delete process.env[key];
}

describe("provision-external-monitor-key.ts: env-var decision logic (no DB/network touched by these branches)", () => {
  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it("no-ops cleanly, without throwing, when EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT is unset (fresh/unconfigured environment)", async () => {
    resetEnv();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main()).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("skipping external monitor key provisioning"));
  });

  it("fails loudly, naming the missing variable, when only EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT is set (secret missing)", async () => {
    resetEnv();
    process.env.EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT = "key-2026-08";
    await expect(main()).rejects.toThrow("EXTERNAL_MONITOR_HMAC_SECRET_CURRENT");
  });

  it("fails loudly, naming the missing variable, when only EXTERNAL_MONITOR_HMAC_SECRET_CURRENT is set (key-id missing)", async () => {
    resetEnv();
    process.env.EXTERNAL_MONITOR_HMAC_SECRET_CURRENT = "some-secret-value";
    await expect(main()).rejects.toThrow("EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT");
  });

  it("never mentions the secret's own value in an incomplete-configuration error message", async () => {
    resetEnv();
    process.env.EXTERNAL_MONITOR_HMAC_SECRET_CURRENT = "super-secret-value-should-not-leak";
    let caught;
    try {
      await main();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).not.toContain("super-secret-value-should-not-leak");
  });

  it("rejects PREVIOUS key-id equal to CURRENT key-id as an incoherent configuration", async () => {
    resetEnv();
    process.env.EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT = "key-same";
    process.env.EXTERNAL_MONITOR_HMAC_SECRET_CURRENT = "current-secret";
    process.env.EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS = "key-same";
    process.env.EXTERNAL_MONITOR_HMAC_SECRET_PREVIOUS = "previous-secret";
    await expect(main()).rejects.toThrow("must not equal");
  });

  it("fails loudly when only EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS is set without its secret counterpart", async () => {
    resetEnv();
    process.env.EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT = "key-current";
    process.env.EXTERNAL_MONITOR_HMAC_SECRET_CURRENT = "current-secret";
    process.env.EXTERNAL_MONITOR_HMAC_KEY_ID_PREVIOUS = "key-previous";
    await expect(main()).rejects.toThrow("EXTERNAL_MONITOR_HMAC_SECRET_PREVIOUS");
  });

  it("requires DATABASE_URL only once the CURRENT key-id/secret pair is actually present", async () => {
    resetEnv();
    process.env.EXTERNAL_MONITOR_HMAC_KEY_ID_CURRENT = "key-2026-08";
    process.env.EXTERNAL_MONITOR_HMAC_SECRET_CURRENT = "some-secret-value";
    delete process.env.DATABASE_URL;
    await expect(main()).rejects.toThrow("DATABASE_URL");
  });
});
