import { describe, expect, it } from "vitest";
import {
  severityForExternalMonitorCondition,
  defaultServiceForExternalMonitorCondition,
  EXTERNAL_MONITOR_SOURCE,
  type ExternalMonitorConditionType,
} from "./condition-mapping";

/** 02_42 v1.2 §57 -- the fixed table, reused verbatim from the canonical spec so a table edit here is caught by review, not silently drifting from the contract. */
const EXPECTED: Record<ExternalMonitorConditionType, { service: string; severity: string }> = {
  VPS_UNREACHABLE: { service: "HOST", severity: "SEV-1" },
  REVERSE_PROXY_UNREACHABLE: { service: "REVERSE_PROXY", severity: "SEV-1" },
  TLS_HANDSHAKE_FAILURE: { service: "TLS", severity: "SEV-1" },
  BACKUP_FAILED: { service: "BACKUP", severity: "SEV-2" },
  EXTERNAL_HTTP_DEGRADED: { service: "API", severity: "SEV-3" },
  BACKUP_STALE: { service: "BACKUP", severity: "SEV-3" },
  TLS_EXPIRY_WARNING: { service: "TLS", severity: "SEV-4" },
};

describe("severityForExternalMonitorCondition / defaultServiceForExternalMonitorCondition (02_42 v1.2 §57)", () => {
  for (const [conditionType, expected] of Object.entries(EXPECTED) as [ExternalMonitorConditionType, { service: string; severity: string }][]) {
    it(`maps ${conditionType} to ${expected.severity} / ${expected.service}`, () => {
      expect(severityForExternalMonitorCondition(conditionType)).toBe(expected.severity);
      expect(defaultServiceForExternalMonitorCondition(conditionType)).toBe(expected.service);
    });
  }

  it("covers exactly the seven contract-defined condition types, no more, no fewer", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      [
        "BACKUP_FAILED",
        "BACKUP_STALE",
        "EXTERNAL_HTTP_DEGRADED",
        "REVERSE_PROXY_UNREACHABLE",
        "TLS_EXPIRY_WARNING",
        "TLS_HANDSHAKE_FAILURE",
        "VPS_UNREACHABLE",
      ].sort(),
    );
  });
});

describe("EXTERNAL_MONITOR_SOURCE (02_42 v1.2 §58)", () => {
  it("is the reserved MetricSource value, unambiguous with local-collector sources", () => {
    expect(EXTERNAL_MONITOR_SOURCE).toBe("EXTERNAL_MONITOR");
  });
});
