import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalMockAlertChannelAdapter, TelegramAlertChannelAdapter } from "./alert-channel-adapter";

const PAYLOAD = {
  severity: "SEV-1" as const,
  service: "API",
  problem: "Service unavailable",
  detectedAt: new Date("2026-08-18T12:00:00.000Z"),
  environment: "local",
  incidentPublicId: "inc_test123",
};

describe("LocalMockAlertChannelAdapter (02_42 §45, no Telegram account required for local/test)", () => {
  it("sendAlert produces a message with the required six fields and no forbidden content", async () => {
    const adapter = new LocalMockAlertChannelAdapter();
    const result = await adapter.sendAlert(PAYLOAD);
    expect(result.status).toBe("SENT");
    const message = adapter.sentMessages[0];
    expect(message).toBeDefined();
    if (!message) throw new Error("unreachable");
    expect(message).toContain("QUEST CITY ALERT");
    expect(message).toContain("Severity: SEV-1");
    expect(message).toContain("Service: API");
    expect(message).toContain("Incident: inc_test123");
    // Privacy (02_42 §31/§43): the payload type itself has no room for
    // student PII/free-text/PIN/password/token/stack-trace fields, so
    // this assertion is really about the message never leaking anything
    // beyond the six declared fields.
    expect(message.split("\n")).toHaveLength(7);
  });

  it("sendRecovery formats downtime as minutes and seconds", async () => {
    const adapter = new LocalMockAlertChannelAdapter();
    await adapter.sendRecovery({ service: "API", downtimeSeconds: 272, incidentPublicId: "inc_test123" });
    expect(adapter.sentMessages[0]).toContain("Downtime: 4m 32s");
    expect(adapter.sentMessages[0]).toContain("Status: RESTORED");
  });

  it("sendTest is always self-identified as TEST, never ambiguous with a real alert (02_42 §33)", async () => {
    const adapter = new LocalMockAlertChannelAdapter();
    await adapter.sendTest();
    expect(adapter.sentMessages[0]).toContain("TEST");
  });

  it("simulateNextFailure produces a FAILED result exactly once, then reverts to normal delivery", async () => {
    const adapter = new LocalMockAlertChannelAdapter();
    adapter.simulateNextFailure();
    const failed = await adapter.sendTest();
    expect(failed.status).toBe("FAILED");
    expect(failed.failureCategory).toBe("SIMULATED_FAILURE");
    const succeeded = await adapter.sendTest();
    expect(succeeded.status).toBe("SENT");
  });
});

describe("TelegramAlertChannelAdapter (02_42 §21-22/§30, real-credential acceptance TELEGRAM_REAL_DELIVERY_ACCEPTED debt closure)", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  // Never a real network call: fetch is fully replaced for every test in
  // this block (mission §7 -- "NON fare chiamate Telegram reali dalla
  // suite automatica. Usare fetch injection/mock controllato.").
  it("sendAlert: success path calls the Telegram Bot API and normalizes the result without ever including the Bot Token in the return value", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("test-bot-token-value"); // real adapter does put it in the URL path -- that's expected, this only asserts the RESULT never leaks it
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new TelegramAlertChannelAdapter({ botToken: "test-bot-token-value", chatId: "123456789" });
    const result = await adapter.sendAlert(PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("SENT");
    expect(result.providerResultNormalized).toBe("telegram-ok");
    expect(result.providerResultNormalized).not.toContain("test-bot-token-value");
    expect(result.failureCategory).toBeNull();
  });

  it("sendAlert: network failure (fetch rejects) is reported as a bounded, categorized FAILED result -- never throws, never a partial/undefined result", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("simulated DNS/connection failure");
    }) as unknown as typeof fetch;

    const adapter = new TelegramAlertChannelAdapter({ botToken: "test-bot-token-value", chatId: "123456789" });
    const result = await adapter.sendAlert(PAYLOAD);

    expect(result.status).toBe("FAILED");
    expect(result.failureCategory).toBe("NETWORK_ERROR");
    expect(result.providerResultNormalized).toBeNull();
  });

  it("sendAlert: HTTP provider failure (non-2xx) is reported FAILED with the HTTP status normalized, never the raw response body or the Bot Token", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 400 })) as unknown as typeof fetch;

    const adapter = new TelegramAlertChannelAdapter({ botToken: "test-bot-token-value", chatId: "123456789" });
    const result = await adapter.sendAlert(PAYLOAD);

    expect(result.status).toBe("FAILED");
    expect(result.failureCategory).toBe("PROVIDER_ERROR");
    expect(result.providerResultNormalized).toBe("http_400");
    expect(result.providerResultNormalized).not.toContain("chat not found");
    expect(result.providerResultNormalized).not.toContain("test-bot-token-value");
  });

  it("sendRecovery and sendTest never leak the Bot Token into their normalized result either, on success or failure", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const adapter = new TelegramAlertChannelAdapter({ botToken: "another-secret-token-value", chatId: "987654321" });

    const recovery = await adapter.sendRecovery({ service: "API", downtimeSeconds: 90, incidentPublicId: "inc_test123" });
    expect(recovery.providerResultNormalized).toBe("telegram-ok");

    const test = await adapter.sendTest();
    expect(test.providerResultNormalized).toBe("telegram-ok");

    global.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const failedRecovery = await adapter.sendRecovery({ service: "API", downtimeSeconds: 90, incidentPublicId: "inc_test123" });
    expect(failedRecovery.providerResultNormalized).toBe("http_500");
    expect(JSON.stringify(failedRecovery)).not.toContain("another-secret-token-value");
  });

  it("a failed delivery does not throw or crash the caller -- the promise always resolves to a well-formed AlertDeliveryResult", async () => {
    global.fetch = vi.fn(async () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch;

    const adapter = new TelegramAlertChannelAdapter({ botToken: "test-bot-token-value", chatId: "123456789" });
    await expect(adapter.sendAlert(PAYLOAD)).resolves.toEqual({
      status: "FAILED",
      providerResultNormalized: null,
      failureCategory: "TIMEOUT",
    });
  });
});
