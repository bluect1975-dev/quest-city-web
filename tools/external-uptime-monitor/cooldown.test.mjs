import { describe, it, expect } from "vitest";
import { getMonitorHistory, isInCooldown, level1DetectedStepName, STEP_NAME_LEVEL1_ALERT_SENT } from "./cooldown.mjs";

function runsFixture(entries) {
  // entries: array of { id, createdAt, updatedAt, conditionType (or null), alertSent }, NEWEST FIRST
  return {
    fetchRecentRunsImpl: async () => entries.map((e) => ({ id: e.id, createdAt: e.createdAt, updatedAt: e.updatedAt })),
    fetchRunStepConclusionsImpl: async ({ runId }) => {
      const e = entries.find((x) => x.id === runId);
      const steps = {};
      if (e.conditionType) steps[level1DetectedStepName(e.conditionType)] = "success";
      if (e.alertSent) steps[STEP_NAME_LEVEL1_ALERT_SENT] = "success";
      return steps;
    },
  };
}

describe("level1DetectedStepName", () => {
  it("templates the conditionType into a fixed, parseable prefix", () => {
    expect(level1DetectedStepName("VPS_UNREACHABLE")).toBe("Level 1 condition detected: VPS_UNREACHABLE");
  });
});

describe("isInCooldown", () => {
  it("false when no alert has ever been sent", () => {
    expect(isInCooldown(null, 15 * 60_000)).toBe(false);
  });

  it("true when the last alert was sent recently, within the window", () => {
    const now = new Date("2026-08-20T10:10:00Z");
    expect(isInCooldown("2026-08-20T10:05:00Z", 15 * 60_000, now)).toBe(true);
  });

  it("false once the cooldown window has fully elapsed", () => {
    const now = new Date("2026-08-20T10:30:00Z");
    expect(isInCooldown("2026-08-20T10:05:00Z", 15 * 60_000, now)).toBe(false);
  });

  it("false exactly at the window boundary going forward (>= elapsed treated as expired)", () => {
    const now = new Date("2026-08-20T10:20:00Z");
    expect(isInCooldown("2026-08-20T10:05:00Z", 15 * 60_000, now)).toBe(false);
  });
});

describe("getMonitorHistory — anti-storm during a prolonged outage", () => {
  it("no prior alert -> lastAlertSentAt is null, outage streak starts at the single active run, conditionType captured", async () => {
    const deps = runsFixture([{ id: 1, createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-20T10:00:05Z", conditionType: "VPS_UNREACHABLE", alertSent: true }]);
    const history = await getMonitorHistory({ owner: "o", repo: "r", workflowFileName: "w.yml", token: "t", currentRunId: 2 }, deps);
    expect(history.lastAlertSentAt).toBe("2026-08-20T10:00:05Z");
    expect(history.lastRunLevel1Active).toBe(true);
    expect(history.outageStartedAt).toBe("2026-08-20T10:00:00Z");
    expect(history.lastConditionType).toBe("VPS_UNREACHABLE");
  });

  it("a second consecutive outage run within cooldown finds the SAME earlier alert timestamp and the ORIGINAL conditionType", async () => {
    const deps = runsFixture([
      { id: 2, createdAt: "2026-08-20T10:10:00Z", updatedAt: "2026-08-20T10:10:05Z", conditionType: "VPS_UNREACHABLE", alertSent: false },
      { id: 1, createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-20T10:00:05Z", conditionType: "VPS_UNREACHABLE", alertSent: true },
    ]);
    const history = await getMonitorHistory({ owner: "o", repo: "r", workflowFileName: "w.yml", token: "t", currentRunId: 3 }, deps);
    expect(history.lastAlertSentAt).toBe("2026-08-20T10:00:05Z");
    expect(history.outageStartedAt).toBe("2026-08-20T10:00:00Z");
    expect(history.lastConditionType).toBe("VPS_UNREACHABLE");
    expect(history.lastRunLevel1Active).toBe(true);
  });

  it("outage streak stops extending at the first non-active run found scanning backward", async () => {
    const deps = runsFixture([
      { id: 3, createdAt: "2026-08-20T10:20:00Z", updatedAt: "2026-08-20T10:20:05Z", conditionType: "TLS_HANDSHAKE_FAILURE", alertSent: false },
      { id: 2, createdAt: "2026-08-20T10:10:00Z", updatedAt: "2026-08-20T10:10:05Z", conditionType: null, alertSent: false }, // healthy run breaks the streak
      { id: 1, createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-20T10:00:05Z", conditionType: "VPS_UNREACHABLE", alertSent: true },
    ]);
    const history = await getMonitorHistory({ owner: "o", repo: "r", workflowFileName: "w.yml", token: "t", currentRunId: 4 }, deps);
    expect(history.outageStartedAt).toBe("2026-08-20T10:20:00Z"); // only the most recent unbroken streak
    expect(history.lastConditionType).toBe("TLS_HANDSHAKE_FAILURE");
  });
});

describe("getMonitorHistory — recovery detection", () => {
  it("lastRunLevel1Active=true when the single most recent run was active, enabling a recovery send on this run", async () => {
    const deps = runsFixture([{ id: 1, createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-20T10:00:05Z", conditionType: "REVERSE_PROXY_UNREACHABLE", alertSent: true }]);
    const history = await getMonitorHistory({ owner: "o", repo: "r", workflowFileName: "w.yml", token: "t", currentRunId: 2 }, deps);
    expect(history.lastRunLevel1Active).toBe(true);
    expect(history.lastConditionType).toBe("REVERSE_PROXY_UNREACHABLE");
  });

  it("lastRunLevel1Active=false when the most recent run was healthy — no recovery to send", async () => {
    const deps = runsFixture([{ id: 1, createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-20T10:00:05Z", conditionType: null, alertSent: false }]);
    const history = await getMonitorHistory({ owner: "o", repo: "r", workflowFileName: "w.yml", token: "t", currentRunId: 2 }, deps);
    expect(history.lastRunLevel1Active).toBe(false);
    expect(history.outageStartedAt).toBeNull();
  });

  it("no run history at all (first-ever run) -> everything defaults safely, no crash", async () => {
    const deps = runsFixture([]);
    const history = await getMonitorHistory({ owner: "o", repo: "r", workflowFileName: "w.yml", token: "t", currentRunId: 1 }, deps);
    expect(history.lastAlertSentAt).toBeNull();
    expect(history.lastRunLevel1Active).toBe(false);
    expect(history.outageStartedAt).toBeNull();
    expect(history.lastConditionType).toBeNull();
  });

  it("excludes the current in-progress run itself from the scanned history", async () => {
    const deps = runsFixture([
      { id: 99, createdAt: "2026-08-20T10:30:00Z", updatedAt: "2026-08-20T10:30:05Z", conditionType: "VPS_UNREACHABLE", alertSent: true }, // would be the "current" run if not excluded
      { id: 1, createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-20T10:00:05Z", conditionType: null, alertSent: false },
    ]);
    const history = await getMonitorHistory({ owner: "o", repo: "r", workflowFileName: "w.yml", token: "t", currentRunId: 99 }, deps);
    expect(history.lastRunLevel1Active).toBe(false); // run 99 excluded, so the real "last" is run 1 (healthy)
  });
});
