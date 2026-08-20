import { describe, it, expect, vi } from "vitest";
import { buildAlertMessage, buildRecoveryMessage, sendTelegramMessage, LEVEL1_CONDITION_TYPES } from "./level1-telegram.mjs";

const HOST_CONDITION = { service: "HOST", conditionType: "VPS_UNREACHABLE" };

describe("buildAlertMessage", () => {
  it("produces the exact static template shape from 02_42 §61", () => {
    const msg = buildAlertMessage({ environment: "PRODUCTION", condition: HOST_CONDITION, detectedAt: "2026-08-20T10:00:00Z" });
    expect(msg).toBe(
      [
        "QUEST CITY ALERT — EXTERNAL MONITOR",
        "Severity: SEV-1",
        "Service: HOST",
        "Problem: VPS/API unreachable from external monitor",
        "Detected: 2026-08-20T10:00:00Z",
        "Environment: production",
        "Note: Control Center unreachable — bypass alert (Level 1)",
      ].join("\n"),
    );
  });

  it("always uses SEV-1 regardless of which Level 1 condition triggered it", () => {
    for (const conditionType of LEVEL1_CONDITION_TYPES) {
      const msg = buildAlertMessage({ environment: "STAGING", condition: { service: "TLS", conditionType }, detectedAt: "t" });
      expect(msg).toContain("Severity: SEV-1");
    }
  });

  it("refuses to build a message for a non-Level-1 condition type (never a generic/unbounded channel)", () => {
    expect(() => buildAlertMessage({ environment: "PRODUCTION", condition: { service: "TLS", conditionType: "TLS_EXPIRY_WARNING" }, detectedAt: "t" })).toThrow(/not a Level 1 condition type/);
  });

  it("contains no free-text/PII fields — only the seven fixed labeled lines", () => {
    const msg = buildAlertMessage({ environment: "PRODUCTION", condition: HOST_CONDITION, detectedAt: "2026-08-20T10:00:00Z" });
    const lines = msg.split("\n");
    expect(lines).toHaveLength(7);
    for (const line of lines) {
      expect(line.length).toBeLessThan(120); // bounded, not an essay
    }
  });

  it("explicitly identifies itself as EXTERNAL MONITOR, never indistinguishable from a real Control Center alert", () => {
    const msg = buildAlertMessage({ environment: "PRODUCTION", condition: HOST_CONDITION, detectedAt: "t" });
    expect(msg).toContain("EXTERNAL MONITOR");
  });
});

describe("buildRecoveryMessage", () => {
  it("produces the symmetric static recovery template", () => {
    const msg = buildRecoveryMessage({ environment: "PRODUCTION", condition: HOST_CONDITION, recoveredAt: "2026-08-20T10:30:00Z" });
    expect(msg.startsWith("QUEST CITY RECOVERY — EXTERNAL MONITOR\n")).toBe(true);
    expect(msg).toContain("Recovered: 2026-08-20T10:30:00Z");
    expect(msg).toContain("Severity: SEV-1");
  });
});

describe("sendTelegramMessage", () => {
  it("POSTs to the Telegram Bot API with the bot token in the URL path and chat_id/text in the body", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await sendTelegramMessage({ botToken: "TESTTOKEN123", chatId: "-1001", text: "hello" }, { fetchImpl });
    expect(result.ok).toBe(true);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botTESTTOKEN123/sendMessage");
    expect(JSON.parse(options.body)).toEqual({ chat_id: "-1001", text: "hello" });
  });

  it("throws (fail-closed) when the bot token or chat id is missing, never silently sending", async () => {
    const fetchImpl = vi.fn();
    await expect(sendTelegramMessage({ botToken: "", chatId: "-1001", text: "x" }, { fetchImpl })).rejects.toThrow();
    await expect(sendTelegramMessage({ botToken: "t", chatId: "", text: "x" }, { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns ok=false on a non-2xx Telegram API response, never throwing", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));
    const result = await sendTelegramMessage({ botToken: "t", chatId: "c", text: "x" }, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("returns ok=false on a network failure without ever including the bot token in the error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ETIMEDOUT to https://api.telegram.org/botSUPERSECRETTOKEN/sendMessage");
    });
    const result = await sendTelegramMessage({ botToken: "SUPERSECRETTOKEN", chatId: "c", text: "x" }, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("SUPERSECRETTOKEN");
  });

  it("never logs the bot token to console (no console.* call in this module at all)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendTelegramMessage({ botToken: "SUPERSECRETTOKEN", chatId: "c", text: "x" }, { fetchImpl });
    for (const call of [...logSpy.mock.calls, ...errorSpy.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain("SUPERSECRETTOKEN");
    }
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
