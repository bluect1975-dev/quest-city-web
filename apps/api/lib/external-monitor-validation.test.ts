import { describe, expect, it } from "vitest";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { validateExternalMonitorReportBody } from "./external-monitor-validation";

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    monitorId: "github-actions:questcity-external-monitor",
    observationId: "5f2c6b1a-6e3b-4b3e-8a1a-1a2b3c4d5e6f",
    observedAt: "2026-08-19T10:00:00.000Z",
    environment: "PRODUCTION",
    service: "HOST",
    conditionType: "VPS_UNREACHABLE",
    state: "DETECTED",
    summaryCode: "CONNECT_TIMEOUT",
    evidence: { httpStatus: null, latencyMs: null, tlsDaysRemaining: null, backupAgeHours: null, consecutiveFailures: 3 },
    ...overrides,
  };
}

describe("validateExternalMonitorReportBody (02_42 v1.2 §56, OpenAPI v1.19 ExternalMonitorReportRequest)", () => {
  it("accepts a well-formed minimal DETECTED report", () => {
    const result = validateExternalMonitorReportBody(validBody());
    expect(result.conditionType).toBe("VPS_UNREACHABLE");
    expect(result.backfill).toBe(false);
    expect(result.detectedAt).toBeNull();
    expect(result.resolvedAt).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(() => validateExternalMonitorReportBody("not an object")).toThrow(PlatformAdminError);
    expect(() => validateExternalMonitorReportBody(null)).toThrow(PlatformAdminError);
    expect(() => validateExternalMonitorReportBody([])).toThrow(PlatformAdminError);
  });

  it("rejects an unknown top-level field (additionalProperties: false, 02_42 §56)", () => {
    expect(() => validateExternalMonitorReportBody(validBody({ extraField: "x" }))).toThrow(PlatformAdminError);
  });

  it("SECURITY: rejects a severity field even when present -- the caller can never force a severity (02_42 §56, §72 principle 4, AGENTS.md §4.31 rule 5)", () => {
    expect(() => validateExternalMonitorReportBody(validBody({ severity: "SEV-1" }))).toThrow(/severity/i);
  });

  it("rejects an invalid conditionType (never a duplicated/typo'd value silently accepted)", () => {
    expect(() => validateExternalMonitorReportBody(validBody({ conditionType: "SOMETHING_ELSE" }))).toThrow(PlatformAdminError);
  });

  it("rejects a non-UUID observationId", () => {
    expect(() => validateExternalMonitorReportBody(validBody({ observationId: "not-a-uuid" }))).toThrow(PlatformAdminError);
  });

  it("rejects a malformed observedAt", () => {
    expect(() => validateExternalMonitorReportBody(validBody({ observedAt: "not-a-date" }))).toThrow(PlatformAdminError);
  });

  it("SECURITY: rejects an unknown field inside evidence -- no free-text message/detail field can be smuggled in (02_42 §56.1)", () => {
    expect(() =>
      validateExternalMonitorReportBody(
        validBody({ evidence: { consecutiveFailures: 1, message: "<script>alert(1)</script>" } }),
      ),
    ).toThrow(PlatformAdminError);
  });

  it("requires evidence.consecutiveFailures as a non-negative integer", () => {
    expect(() => validateExternalMonitorReportBody(validBody({ evidence: { consecutiveFailures: -1 } }))).toThrow(
      PlatformAdminError,
    );
    expect(() => validateExternalMonitorReportBody(validBody({ evidence: { consecutiveFailures: 1.5 } }))).toThrow(
      PlatformAdminError,
    );
  });

  it("backfill = true requires detectedAt", () => {
    expect(() => validateExternalMonitorReportBody(validBody({ backfill: true }))).toThrow(/detectedAt/);
  });

  it("backfill = true + state = RECOVERED requires resolvedAt", () => {
    expect(() =>
      validateExternalMonitorReportBody(
        validBody({ backfill: true, state: "RECOVERED", detectedAt: "2026-08-19T09:00:00.000Z" }),
      ),
    ).toThrow(/resolvedAt/);
  });

  it("accepts a well-formed backfill RECOVERED report with both timestamps", () => {
    const result = validateExternalMonitorReportBody(
      validBody({
        backfill: true,
        state: "RECOVERED",
        summaryCode: "THRESHOLD_RECOVERED",
        detectedAt: "2026-08-19T09:00:00.000Z",
        resolvedAt: "2026-08-19T09:30:00.000Z",
      }),
    );
    expect(result.backfill).toBe(true);
    expect(result.detectedAt).toBe("2026-08-19T09:00:00.000Z");
    expect(result.resolvedAt).toBe("2026-08-19T09:30:00.000Z");
  });

  it("rejects monitorId longer than 128 characters", () => {
    expect(() => validateExternalMonitorReportBody(validBody({ monitorId: "x".repeat(129) }))).toThrow(PlatformAdminError);
  });
});
