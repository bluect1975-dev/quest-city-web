import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./provision-telegram-alert-channel.ts";

const SAVED_ENV = { ...process.env };

function resetEnv() {
  for (const key of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "DATABASE_URL"]) {
    delete process.env[key];
  }
  Object.assign(process.env, SAVED_ENV);
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
}

describe("provision-telegram-alert-channel.ts: env-var decision logic (no DB/network touched by these branches)", () => {
  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it("no-ops cleanly, without throwing, when neither TELEGRAM_BOT_TOKEN nor TELEGRAM_CHAT_ID is set (local dev/CI default -- LocalMockAlertChannelAdapter stays active)", async () => {
    resetEnv();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main()).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("skipping Telegram alert channel provisioning"));
  });

  it("fails loudly, naming the missing variable, when only TELEGRAM_BOT_TOKEN is set", async () => {
    resetEnv();
    process.env.TELEGRAM_BOT_TOKEN = "some-token-value";
    await expect(main()).rejects.toThrow("TELEGRAM_CHAT_ID");
  });

  it("fails loudly, naming the missing variable, when only TELEGRAM_CHAT_ID is set", async () => {
    resetEnv();
    process.env.TELEGRAM_CHAT_ID = "123456789";
    await expect(main()).rejects.toThrow("TELEGRAM_BOT_TOKEN");
  });

  it("never mentions the Bot Token's own value in the incomplete-configuration error message", async () => {
    resetEnv();
    process.env.TELEGRAM_BOT_TOKEN = "super-secret-token-value-should-not-leak";
    let caught;
    try {
      await main();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).not.toContain("super-secret-token-value-should-not-leak");
  });

  it("requires DATABASE_URL only once both Telegram variables are actually present", async () => {
    resetEnv();
    process.env.TELEGRAM_BOT_TOKEN = "some-token-value";
    process.env.TELEGRAM_CHAT_ID = "123456789";
    delete process.env.DATABASE_URL;
    await expect(main()).rejects.toThrow("DATABASE_URL");
  });
});
