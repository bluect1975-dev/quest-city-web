import { describe, expect, it } from "vitest";
import { meetsSeverityThreshold, severityForCondition, SEVERITY_ORDER } from "./severity";

describe("severity (02_42 §26, reused verbatim from 07_06 §19)", () => {
  it("reuses exactly the four SEV levels, never a parallel INFO/WARNING/HIGH/CRITICAL taxonomy", () => {
    expect(SEVERITY_ORDER).toEqual(["SEV-1", "SEV-2", "SEV-3", "SEV-4"]);
  });

  it("maps API_DOWN/POSTGRES_DOWN/DATA_EXPOSURE to SEV-1 (07_06 §19: indisponibilita completa/perdita)", () => {
    expect(severityForCondition("API_DOWN")).toBe("SEV-1");
    expect(severityForCondition("POSTGRES_DOWN")).toBe("SEV-1");
    expect(severityForCondition("DATA_EXPOSURE")).toBe("SEV-1");
  });

  it("maps BACKUP_FAILED/SUSTAINED_HIGH_5XX to SEV-2", () => {
    expect(severityForCondition("BACKUP_FAILED")).toBe("SEV-2");
    expect(severityForCondition("SUSTAINED_HIGH_5XX")).toBe("SEV-2");
  });

  it("maps DISK_THRESHOLD to SEV-3 (degraded with workaround)", () => {
    expect(severityForCondition("DISK_THRESHOLD")).toBe("SEV-3");
  });

  it("maps TLS_EXPIRY_WARNING/MINOR_COSMETIC to SEV-4", () => {
    expect(severityForCondition("TLS_EXPIRY_WARNING")).toBe("SEV-4");
    expect(severityForCondition("MINOR_COSMETIC")).toBe("SEV-4");
  });
});

describe("meetsSeverityThreshold (02_42 §35 escalation)", () => {
  it("SEV-1 meets every threshold", () => {
    expect(meetsSeverityThreshold("SEV-1", "SEV-4")).toBe(true);
    expect(meetsSeverityThreshold("SEV-1", "SEV-1")).toBe(true);
  });

  it("SEV-4 meets only the SEV-4 threshold", () => {
    expect(meetsSeverityThreshold("SEV-4", "SEV-4")).toBe(true);
    expect(meetsSeverityThreshold("SEV-4", "SEV-3")).toBe(false);
  });

  it("default threshold SEV-2 excludes SEV-3/SEV-4 but includes SEV-1/SEV-2 (02_42 §35 default)", () => {
    expect(meetsSeverityThreshold("SEV-1", "SEV-2")).toBe(true);
    expect(meetsSeverityThreshold("SEV-2", "SEV-2")).toBe(true);
    expect(meetsSeverityThreshold("SEV-3", "SEV-2")).toBe(false);
    expect(meetsSeverityThreshold("SEV-4", "SEV-2")).toBe(false);
  });
});
