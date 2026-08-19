import { describe, expect, it } from "vitest";
import { applyExceptions, extractFindings } from "./check-dependency-audit.mjs";

describe("extractFindings", () => {
  it("extracts from the npm-style advisories shape", () => {
    const auditJson = {
      advisories: {
        1001: { id: 1001, severity: "high", module_name: "left-pad" },
        1002: { id: 1002, severity: "low", module_name: "some-lib" },
      },
    };
    const findings = extractFindings(auditJson);
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.moduleName === "left-pad").severity).toBe("high");
  });

  it("extracts from the npm-style vulnerabilities shape", () => {
    const auditJson = {
      vulnerabilities: {
        "left-pad": {
          severity: "critical",
          via: [{ source: 1001, title: "Prototype pollution" }],
        },
      },
    };
    const findings = extractFindings(auditJson);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "critical", moduleName: "left-pad" });
  });

  it("returns an empty array for an empty/clean audit result", () => {
    expect(extractFindings({})).toEqual([]);
    expect(extractFindings({ advisories: {} })).toEqual([]);
  });
});

describe("applyExceptions", () => {
  const findings = [
    { id: "GHSA-abcd", severity: "high", moduleName: "vulnerable-lib" },
    { id: "GHSA-efgh", severity: "critical", moduleName: "other-lib" },
  ];

  it("passes through findings with no matching exception", () => {
    const { survivors, applied } = applyExceptions(findings, []);
    expect(survivors).toHaveLength(2);
    expect(applied).toHaveLength(0);
  });

  it("removes a finding with a valid (non-expired) exception, matched by id", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const exceptions = [{ id: "GHSA-abcd", justification: "no fix available, not exploitable in our usage", expiresOn: "2026-12-31" }];
    const { survivors, applied } = applyExceptions(findings, exceptions, now);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe("GHSA-efgh");
    expect(applied).toHaveLength(1);
  });

  it("removes a finding with a valid exception matched by moduleName", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const exceptions = [{ moduleName: "other-lib", justification: "dev-only dependency", expiresOn: "2026-12-31" }];
    const { survivors } = applyExceptions(findings, exceptions, now);
    expect(survivors.map((f) => f.moduleName)).toEqual(["vulnerable-lib"]);
  });

  it("does NOT honor an EXPIRED exception — it must fail the gate as if no exception existed", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    const exceptions = [{ id: "GHSA-abcd", justification: "temporary", expiresOn: "2026-12-31" }];
    const { survivors, applied } = applyExceptions(findings, exceptions, now);
    expect(survivors.map((f) => f.id)).toContain("GHSA-abcd");
    expect(applied).toHaveLength(0);
  });

  it("treats an unparseable expiresOn as invalid (never valid)", () => {
    const exceptions = [{ id: "GHSA-abcd", justification: "x", expiresOn: "not-a-date" }];
    const { survivors } = applyExceptions(findings, exceptions);
    expect(survivors.map((f) => f.id)).toContain("GHSA-abcd");
  });
});
