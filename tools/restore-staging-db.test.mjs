import { describe, expect, it } from "vitest";
import { pickMostRecentBackup, runIntegrityChecks } from "./restore-staging-db.mjs";

function backupName(date) {
  return `qcweb-staging-${date.getTime()}-${date.toISOString().replace(/[:.]/g, "-")}.dump.enc`;
}

describe("pickMostRecentBackup", () => {
  it("returns null when there are no parseable backups", () => {
    expect(pickMostRecentBackup([])).toBeNull();
    expect(pickMostRecentBackup(["unrelated.txt"])).toBeNull();
  });

  it("picks the most recent among several dated backups", () => {
    const oldest = backupName(new Date("2026-01-01T00:00:00Z"));
    const middle = backupName(new Date("2026-02-01T00:00:00Z"));
    const newest = backupName(new Date("2026-03-01T00:00:00Z"));
    expect(pickMostRecentBackup([oldest, newest, middle])).toBe(newest);
  });

  it("ignores .sha256 sidecar files when picking", () => {
    const newest = backupName(new Date("2026-03-01T00:00:00Z"));
    const sidecar = `${newest}.sha256`;
    // If the sidecar were mistakenly treated as a backup, it would still
    // parse to the same date and not change the outcome here — the real
    // regression this guards is a sidecar being returned as a "backup
    // identifier" that pg_restore would then be handed directly.
    expect(pickMostRecentBackup([newest, sidecar])).toBe(newest);
  });
});

describe("runIntegrityChecks", () => {
  it("queries a row count for each core table and returns them keyed by table name", async () => {
    const queried = [];
    const fakeClient = {
      async query(sql) {
        queried.push(sql);
        return { rows: [{ count: 3 }] };
      },
    };
    const result = await runIntegrityChecks(fakeClient);
    expect(result).toEqual({
      tenant: 3,
      student_profile: 3,
      staff_account: 3,
      learning_attempt: 3,
      audit_event: 3,
    });
    expect(queried).toHaveLength(5);
    expect(queried.every((sql) => sql.includes("count(*)"))).toBe(true);
  });

  it("propagates a query failure rather than swallowing it (a missing table must fail the drill loudly)", async () => {
    const fakeClient = {
      async query() {
        throw new Error("relation \"tenant\" does not exist");
      },
    };
    await expect(runIntegrityChecks(fakeClient)).rejects.toThrow(/does not exist/);
  });
});
