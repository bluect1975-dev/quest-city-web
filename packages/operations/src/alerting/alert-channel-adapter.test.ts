import { describe, expect, it } from "vitest";
import { LocalMockAlertChannelAdapter } from "./alert-channel-adapter";

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
