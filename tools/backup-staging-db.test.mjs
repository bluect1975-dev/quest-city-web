import { describe, expect, it } from "vitest";
import { parseBackupDate, shouldRetain } from "./backup-staging-db.mjs";

describe("parseBackupDate", () => {
  it("round-trips a filename produced by this script's own naming convention", () => {
    const originalDate = new Date("2026-03-05T10:00:00.000Z");
    const filename = `qcweb-staging-${originalDate.getTime()}-${originalDate.toISOString().replace(/[:.]/g, "-")}.dump.enc`;
    const parsed = parseBackupDate(filename);
    expect(parsed).not.toBeNull();
    expect(parsed.getTime()).toBe(originalDate.getTime());
  });

  it("returns null for a filename it did not create (never deletes unknown files)", () => {
    expect(parseBackupDate("some-unrelated-file.txt")).toBeNull();
    expect(parseBackupDate("qcweb-staging-not-a-number-2026.dump.enc")).toBeNull();
  });

  it("works with a full path, not just a bare filename", () => {
    const originalDate = new Date("2026-01-01T00:00:00.000Z");
    const filename = `/var/backups/qcweb-staging-${originalDate.getTime()}-x.dump.enc`;
    expect(parseBackupDate(filename).getTime()).toBe(originalDate.getTime());
  });
});

describe("shouldRetain (Tranche E design report §22 tiered retention)", () => {
  const retention = { dailyDays: 14, weeklyWeeks: 8, monthlyMonths: 6 };

  it("retains anything within the daily window regardless of day-of-week", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const backup = new Date("2026-03-10T00:00:00Z"); // 5 days old, a Tuesday
    expect(shouldRetain(backup, now, retention)).toBe(true);
  });

  it("prunes a non-Monday, non-1st backup once it ages past the daily window", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const backup = new Date("2026-02-24T00:00:00Z"); // ~19 days old
    expect(backup.getUTCDay()).not.toBe(1); // self-check: must not be a Monday for this test to be meaningful
    expect(backup.getUTCDate()).not.toBe(1); // self-check: must not be the 1st of the month
    expect(shouldRetain(backup, now, retention)).toBe(false);
  });

  it("retains a Monday backup within the weekly window even past the daily window", () => {
    const now = new Date("2026-03-15T00:00:00Z"); // Sunday
    const backup = new Date("2026-02-23T00:00:00Z"); // a Monday, ~20 days old (past daily, within 8 weeks)
    expect(backup.getUTCDay()).toBe(1);
    expect(shouldRetain(backup, now, retention)).toBe(true);
  });

  it("prunes a Monday backup once it exceeds the weekly window too", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const backup = new Date("2026-02-02T00:00:00Z"); // a Monday, well over 8 weeks and not the 1st of a retained month
    expect(backup.getUTCDay()).toBe(1);
    expect(shouldRetain(backup, now, retention)).toBe(false);
  });

  it("retains a 1st-of-month backup within the monthly window even past daily/weekly", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const backup = new Date("2026-03-01T00:00:00Z"); // 1st of month, 3 months old
    expect(backup.getUTCDate()).toBe(1);
    expect(shouldRetain(backup, now, retention)).toBe(true);
  });

  it("prunes a 1st-of-month backup once it exceeds the monthly window", () => {
    const now = new Date("2027-06-01T00:00:00Z");
    const backup = new Date("2026-01-01T00:00:00Z"); // 17 months old
    expect(shouldRetain(backup, now, retention)).toBe(false);
  });
});
