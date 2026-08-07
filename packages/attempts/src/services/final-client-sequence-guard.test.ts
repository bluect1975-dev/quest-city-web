import { describe, expect, it } from "vitest";
import { checkFinalClientSequence } from "./final-client-sequence-guard";
import type { SemanticActionLogEntry } from "../repository/semantic-action-log-repository";

function action(clientSequence: number): SemanticActionLogEntry {
  return {
    id: `id-${clientSequence}`,
    tenantId: "tenant-1",
    attemptId: "attempt-1",
    actionId: `action-${clientSequence}`,
    actionType: "PLACE_ITEM",
    targetRole: "weight-token",
    payload: {},
    clientSequence,
    runtimeChannel: "WEB",
    adapterVersion: null,
    occurredAt: new Date(),
    createdAt: new Date(),
  };
}

describe("checkFinalClientSequence", () => {
  it("is ok when finalClientSequence is not provided (optional field, nothing to verify)", () => {
    expect(checkFinalClientSequence(undefined, [action(0), action(1)])).toEqual({ ok: true });
    expect(checkFinalClientSequence(null, [action(0), action(1)])).toEqual({ ok: true });
  });

  it("is ok when finalClientSequence equals the max persisted clientSequence", () => {
    expect(checkFinalClientSequence(2, [action(0), action(1), action(2)])).toEqual({ ok: true });
  });

  it("is ok when finalClientSequence is behind the max persisted clientSequence (client conservative, not missing anything)", () => {
    expect(checkFinalClientSequence(0, [action(0), action(1), action(2)])).toEqual({ ok: true });
  });

  it("returns MISSING_ACTION when finalClientSequence is ahead of the max persisted clientSequence", () => {
    expect(checkFinalClientSequence(5, [action(0), action(1)])).toEqual({ ok: false, reason: "MISSING_ACTION" });
  });

  it("returns MISSING_ACTION when finalClientSequence is 0 but no action has been persisted at all", () => {
    expect(checkFinalClientSequence(0, [])).toEqual({ ok: false, reason: "MISSING_ACTION" });
  });
});
