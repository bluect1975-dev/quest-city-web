import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("./probe.mjs", () => ({ runProbe: vi.fn() }));
vi.mock("./level2-submit.mjs", () => ({ buildReportBody: vi.fn((x) => ({ ...x, __built: true })), submitLevel2Report: vi.fn() }));
vi.mock("./level1-telegram.mjs", () => ({ buildAlertMessage: vi.fn(() => "ALERT TEXT"), buildRecoveryMessage: vi.fn(() => "RECOVERY TEXT"), sendTelegramMessage: vi.fn() }));
vi.mock("./cooldown.mjs", () => ({ getMonitorHistory: vi.fn(), isInCooldown: vi.fn(), level1DetectedStepName: (t) => `Level 1 condition detected: ${t}` }));

const { runProbe } = await import("./probe.mjs");
const { buildReportBody, submitLevel2Report } = await import("./level2-submit.mjs");
const { sendTelegramMessage } = await import("./level1-telegram.mjs");
const { getMonitorHistory, isInCooldown } = await import("./cooldown.mjs");
const { main } = await import("./run.mjs");

let ORIGINAL_ENV;
let tmpDir;
let outputFile;

beforeEach(() => {
  ORIGINAL_ENV = { ...process.env };
  tmpDir = mkdtempSync(path.join(tmpdir(), "eum-test-"));
  outputFile = path.join(tmpDir, "github_output");
  process.env.GITHUB_OUTPUT = outputFile;
  process.env.GITHUB_REPOSITORY = "bluect1975-dev/quest-city-web";
  process.env.GITHUB_TOKEN = "gh-token-should-never-be-logged";
  process.env.GITHUB_RUN_ID = "12345";
  process.env.EXTERNAL_MONITOR_TARGET_HOST = "example.invalid";
  process.env.EXTERNAL_MONITOR_ENVIRONMENT = "PRODUCTION";
  process.env.EXTERNAL_MONITOR_API_BASE_URL = "https://example.invalid";
  process.env.EXTERNAL_MONITOR_HMAC_SECRET = Buffer.alloc(32, 5).toString("base64");
  process.env.EXTERNAL_MONITOR_HMAC_KEY_ID = "key-2026-08";
  process.env.TELEGRAM_BOT_TOKEN = "telegram-token-should-never-be-logged";
  process.env.TELEGRAM_CHAT_ID = "-1001";
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  rmSync(tmpDir, { recursive: true, force: true });
});

function outputEntries() {
  const raw = readFileSync(outputFile, "utf8");
  const entries = {};
  const re = /^([A-Za-z0-9_]+)<<__EOM__\n([\s\S]*?)\n__EOM__$/gm;
  let m;
  while ((m = re.exec(raw))) entries[m[1]] = m[2];
  return entries;
}

describe("probe subcommand", () => {
  it("writes reachable/condition_type/result outputs for a healthy probe", async () => {
    runProbe.mockResolvedValue({ reachable: true, level1: null, level2Conditions: [] });
    await main(["node", "run.mjs", "probe"]);
    const out = outputEntries();
    expect(out.reachable).toBe("true");
    expect(out.condition_type).toBe("");
    expect(JSON.parse(out.result)).toEqual({ reachable: true, level1: null, level2Conditions: [] });
  });

  it("writes the level1 conditionType when unreachable", async () => {
    runProbe.mockResolvedValue({ reachable: false, level1: { conditionType: "VPS_UNREACHABLE", service: "HOST", summaryCode: "CONNECT_REFUSED", evidence: {} }, level2Conditions: [] });
    await main(["node", "run.mjs", "probe"]);
    expect(outputEntries().reachable).toBe("false");
    expect(outputEntries().condition_type).toBe("VPS_UNREACHABLE");
  });

  it("fails closed when EXTERNAL_MONITOR_TARGET_HOST is missing", async () => {
    delete process.env.EXTERNAL_MONITOR_TARGET_HOST;
    await expect(main(["node", "run.mjs", "probe"])).rejects.toThrow(/EXTERNAL_MONITOR_TARGET_HOST/);
  });
});

describe("history subcommand", () => {
  it("computes cooldown and writes all four outputs", async () => {
    getMonitorHistory.mockResolvedValue({ lastAlertSentAt: "2026-08-20T10:00:00Z", lastRunLevel1Active: true, outageStartedAt: "2026-08-20T09:50:00Z", lastConditionType: "VPS_UNREACHABLE" });
    isInCooldown.mockReturnValue(true);
    await main(["node", "run.mjs", "history"]);
    const out = outputEntries();
    expect(out.in_cooldown).toBe("true");
    expect(out.was_level1_active).toBe("true");
    expect(out.outage_started_at).toBe("2026-08-20T09:50:00Z");
    expect(out.last_condition_type).toBe("VPS_UNREACHABLE");
  });

  it("fails closed when GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(main(["node", "run.mjs", "history"])).rejects.toThrow(/GITHUB_REPOSITORY, GITHUB_TOKEN/);
  });
});

describe("level1-alert subcommand", () => {
  it("sends the alert and never throws on success", async () => {
    process.env.RESULT_JSON = JSON.stringify({ reachable: false, level1: { conditionType: "VPS_UNREACHABLE", service: "HOST" }, level2Conditions: [] });
    sendTelegramMessage.mockResolvedValue({ ok: true, status: 200, error: null });
    await expect(main(["node", "run.mjs", "level1-alert"])).resolves.toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("throws (so the step conclusion is 'failure', which cooldown.mjs relies on) when the Telegram send fails", async () => {
    process.env.RESULT_JSON = JSON.stringify({ reachable: false, level1: { conditionType: "VPS_UNREACHABLE", service: "HOST" }, level2Conditions: [] });
    sendTelegramMessage.mockResolvedValue({ ok: false, status: 401, error: "Telegram API returned HTTP 401." });
    await expect(main(["node", "run.mjs", "level1-alert"])).rejects.toThrow(/Level 1 direct alert send failed/);
  });

  it("fails closed when RESULT_JSON is missing", async () => {
    await expect(main(["node", "run.mjs", "level1-alert"])).rejects.toThrow(/RESULT_JSON is required/);
  });

  it("never logs the Telegram bot token or GitHub token", async () => {
    process.env.RESULT_JSON = JSON.stringify({ reachable: false, level1: { conditionType: "VPS_UNREACHABLE", service: "HOST" }, level2Conditions: [] });
    sendTelegramMessage.mockResolvedValue({ ok: true, status: 200, error: null });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["node", "run.mjs", "level1-alert"]);
    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("telegram-token-should-never-be-logged");
      expect(JSON.stringify(call)).not.toContain("gh-token-should-never-be-logged");
    }
    logSpy.mockRestore();
  });
});

describe("level1-recovery subcommand", () => {
  it("sends the recovery message and writes recovered_at", async () => {
    process.env.LAST_CONDITION_TYPE = "REVERSE_PROXY_UNREACHABLE";
    sendTelegramMessage.mockResolvedValue({ ok: true, status: 200, error: null });
    await main(["node", "run.mjs", "level1-recovery"]);
    expect(outputEntries().recovered_at).toBeTruthy();
  });

  it("throws when the recovery send fails, no output written", async () => {
    process.env.LAST_CONDITION_TYPE = "VPS_UNREACHABLE";
    sendTelegramMessage.mockResolvedValue({ ok: false, status: 500, error: "boom" });
    await expect(main(["node", "run.mjs", "level1-recovery"])).rejects.toThrow(/recovery send failed/);
  });

  it("fails closed on an unrecognized conditionType (never invents a new enum)", async () => {
    process.env.LAST_CONDITION_TYPE = "SOMETHING_MADE_UP";
    await expect(main(["node", "run.mjs", "level1-recovery"])).rejects.toThrow(/not a recognized Level 1 conditionType/);
  });
});

describe("level1-backfill subcommand", () => {
  beforeEach(() => {
    process.env.OUTAGE_STARTED_AT = "2026-08-20T09:50:00Z";
    process.env.LAST_CONDITION_TYPE = "VPS_UNREACHABLE";
    process.env.RECOVERED_AT = "2026-08-20T10:00:00Z";
  });

  it("submits a backfill=true report with state=RECOVERED and never triggers a second Telegram send", async () => {
    submitLevel2Report.mockResolvedValue({ ok: true, status: 200, body: { data: { incidentPublicId: "inc_1", deduped: false } } });
    await main(["node", "run.mjs", "level1-backfill"]);
    expect(buildReportBody).toHaveBeenCalledWith(
      expect.objectContaining({ state: "RECOVERED", backfill: true, detectedAt: "2026-08-20T09:50:00Z", resolvedAt: "2026-08-20T10:00:00Z" }),
    );
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("throws on a failed submit", async () => {
    submitLevel2Report.mockResolvedValue({ ok: false, status: 500, error: "server error", body: null });
    await expect(main(["node", "run.mjs", "level1-backfill"])).rejects.toThrow(/backfill submit failed/);
  });

  it("fails closed when required env vars are missing", async () => {
    delete process.env.OUTAGE_STARTED_AT;
    await expect(main(["node", "run.mjs", "level1-backfill"])).rejects.toThrow(/all required for a backfill/);
  });
});

describe("level2-submit subcommand", () => {
  it("submits one report per detected Level 2 condition", async () => {
    process.env.RESULT_JSON = JSON.stringify({
      reachable: true,
      level1: null,
      level2Conditions: [
        { conditionType: "TLS_EXPIRY_WARNING", service: "TLS", summaryCode: "CERTIFICATE_EXPIRED_SOON", evidence: {} },
        { conditionType: "EXTERNAL_HTTP_DEGRADED", service: "API", summaryCode: "HTTP_LATENCY_EXCEEDED", evidence: {} },
      ],
    });
    submitLevel2Report.mockResolvedValue({ ok: true, status: 200, body: { data: { incidentPublicId: "inc_x", deduped: false } } });
    await main(["node", "run.mjs", "level2-submit"]);
    expect(submitLevel2Report).toHaveBeenCalledTimes(2);
  });

  it("is a no-op (no submit call) when there are zero Level 2 conditions", async () => {
    process.env.RESULT_JSON = JSON.stringify({ reachable: true, level1: null, level2Conditions: [] });
    await main(["node", "run.mjs", "level2-submit"]);
    expect(submitLevel2Report).not.toHaveBeenCalled();
  });

  it("throws if any submission fails, after attempting all of them", async () => {
    process.env.RESULT_JSON = JSON.stringify({
      reachable: true,
      level1: null,
      level2Conditions: [
        { conditionType: "TLS_EXPIRY_WARNING", service: "TLS", summaryCode: "CERTIFICATE_EXPIRED_SOON", evidence: {} },
        { conditionType: "EXTERNAL_HTTP_DEGRADED", service: "API", summaryCode: "HTTP_LATENCY_EXCEEDED", evidence: {} },
      ],
    });
    submitLevel2Report.mockResolvedValueOnce({ ok: false, status: 500, error: "boom", body: null }).mockResolvedValueOnce({ ok: true, status: 200, body: { data: {} } });
    await expect(main(["node", "run.mjs", "level2-submit"])).rejects.toThrow(/at least one/i);
    expect(submitLevel2Report).toHaveBeenCalledTimes(2); // both attempted, not short-circuited
  });

  it("never sends a Telegram message on the Level 2 normal path (02_42 §52 Level 2 rule)", async () => {
    process.env.RESULT_JSON = JSON.stringify({ reachable: true, level1: null, level2Conditions: [{ conditionType: "TLS_EXPIRY_WARNING", service: "TLS", summaryCode: "CERTIFICATE_EXPIRED_SOON", evidence: {} }] });
    submitLevel2Report.mockResolvedValue({ ok: true, status: 200, body: { data: {} } });
    await main(["node", "run.mjs", "level2-submit"]);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});

describe("unknown command", () => {
  it("fails closed with a clear error listing valid commands", async () => {
    await expect(main(["node", "run.mjs", "not-a-real-command"])).rejects.toThrow(/Unknown command/);
  });
});
