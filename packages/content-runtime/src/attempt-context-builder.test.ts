import { describe, expect, it } from "vitest";
import { buildAttemptContext, type LearningAttemptRow } from "./attempt-context-builder";

function baseRow(overrides: Partial<LearningAttemptRow> = {}): LearningAttemptRow {
  return {
    attemptId: "att_01",
    attemptVersion: 1,
    userPublicId: "usr_01",
    activityId: "MAT-M06-BALANCE-001",
    activityVersion: "1.0.0",
    runtimeChannel: "WEB",
    state: "IN_PROGRESS",
    serverSequence: 2,
    ...overrides,
  };
}

describe("buildAttemptContext", () => {
  it("accepts a well-formed row", () => {
    const result = buildAttemptContext(baseRow());
    expect(result.ok).toBe(true);
    expect(result.context).toBeDefined();
  });

  it("rejects a row with a non-canonical state", () => {
    const result = buildAttemptContext({ ...baseRow(), state: "evaluated" as never });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
