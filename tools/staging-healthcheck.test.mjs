import { describe, expect, it } from "vitest";
import { checkDiskUsage, daysUntilExpiry, mostRecentBackupAgeHours } from "./staging-healthcheck.mjs";

describe("daysUntilExpiry", () => {
  it("returns a positive count for a certificate expiring in the future", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const validTo = new Date("2026-03-15T00:00:00Z");
    expect(daysUntilExpiry(validTo, now)).toBe(14);
  });

  it("returns a negative count for an already-expired certificate", () => {
    const now = new Date("2026-03-20T00:00:00Z");
    const validTo = new Date("2026-03-15T00:00:00Z");
    expect(daysUntilExpiry(validTo, now)).toBeLessThan(0);
  });
});

describe("checkDiskUsage", () => {
  it("returns a well-formed result without throwing, even if statfs is unsupported here", async () => {
    const result = await checkDiskUsage("/", 85);
    expect(result).toHaveProperty("ok");
    if (result.ok !== null) {
      expect(typeof result.usedPercent).toBe("number");
    }
  });

  it("reports ok:null (not a crash) for a path that does not exist", async () => {
    const result = await checkDiskUsage("/this/path/does/not/exist/qcweb", 85);
    expect(result.ok).toBeNull();
    expect(result.error).toBeDefined();
  });
});

describe("mostRecentBackupAgeHours", () => {
  function fakeAdapter(identifiers) {
    return { async list() { return identifiers; } };
  }

  it("returns null when no parseable backups exist", async () => {
    expect(await mostRecentBackupAgeHours(fakeAdapter([]))).toBeNull();
    expect(await mostRecentBackupAgeHours(fakeAdapter(["unrelated.txt"]))).toBeNull();
  });

  it("computes age in hours from the most recent of several backups", async () => {
    const now = new Date("2026-03-02T00:00:00Z");
    const twelveHoursAgo = new Date("2026-03-01T12:00:00Z");
    const twoDaysAgo = new Date("2026-02-28T00:00:00Z");
    const name = (d) => `qcweb-staging-${d.getTime()}-x.dump.enc`;
    const age = await mostRecentBackupAgeHours(fakeAdapter([name(twoDaysAgo), name(twelveHoursAgo)]), now);
    expect(age).toBeCloseTo(12, 5);
  });
});
