import { describe, expect, it } from "vitest";
import { buildStorageAlertMessage, evaluateStorageUsage } from "./check-backup-storage-usage.mjs";

describe("evaluateStorageUsage", () => {
  it("computes the correct percentage", () => {
    const result = evaluateStorageUsage({ usedBytes: 5 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, thresholdPercent: 90 });
    expect(result.percent).toBeCloseTo(50, 5);
    expect(result.overThreshold).toBe(false);
  });

  it("flags overThreshold once usage reaches the threshold percent", () => {
    const result = evaluateStorageUsage({ usedBytes: 9 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, thresholdPercent: 90 });
    expect(result.percent).toBeCloseTo(90, 5);
    expect(result.overThreshold).toBe(true);
  });

  it("does not flag overThreshold just below the threshold", () => {
    const result = evaluateStorageUsage({ usedBytes: 8.9 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, thresholdPercent: 90 });
    expect(result.overThreshold).toBe(false);
  });

  it("treats a zero limit as 0% rather than dividing by zero", () => {
    const result = evaluateStorageUsage({ usedBytes: 100, limitBytes: 0, thresholdPercent: 90 });
    expect(result.percent).toBe(0);
    expect(Number.isFinite(result.percent)).toBe(true);
  });
});

describe("buildStorageAlertMessage", () => {
  it("includes bucket, usage, and percent, and never a secret-shaped value", () => {
    const message = buildStorageAlertMessage({
      bucket: "qcweb-staging-backups",
      usedBytes: 9.2 * 1024 ** 3,
      limitBytes: 10 * 1024 ** 3,
      percent: 92,
      environment: "STAGING",
    });
    expect(message).toContain("qcweb-staging-backups");
    expect(message).toContain("92.0%");
    expect(message).toContain("staging");
    expect(message).not.toMatch(/[A-Za-z0-9_-]{30,}/); // no token/key-shaped substring
  });
});
