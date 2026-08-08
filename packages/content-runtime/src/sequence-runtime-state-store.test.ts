import { describe, expect, it } from "vitest";
import { InMemorySequenceRuntimeStateStore } from "./sequence-runtime-state-store";
import { initializeSequence } from "./stage-orchestrator";
import type { SequenceDefinition } from "./stage-orchestration-types";

const DEFINITION: SequenceDefinition = {
  contractType: "SEQUENCE_DEFINITION",
  sequenceId: "SEQ-1",
  sequenceVersion: "1.0.0",
  stages: [{ stageId: "s1", stageType: "INTRO_HOOK", order: 0, isInteractive: false }],
};

describe("InMemorySequenceRuntimeStateStore", () => {
  it("returns undefined for an unknown runtimeStateId", async () => {
    const store = new InMemorySequenceRuntimeStateStore();
    expect(await store.get("does-not-exist")).toBeUndefined();
  });

  it("round-trips a saved state by runtimeStateId", async () => {
    const store = new InMemorySequenceRuntimeStateStore();
    const state = initializeSequence(DEFINITION, "rts-1");
    await store.save(state);
    expect(await store.get("rts-1")).toEqual(state);
  });

  it("save overwrites the previous state for the same runtimeStateId", async () => {
    const store = new InMemorySequenceRuntimeStateStore();
    const initial = initializeSequence(DEFINITION, "rts-1");
    await store.save(initial);
    const updated = { ...initial, sequenceCompletionState: "ABANDONED" as const };
    await store.save(updated);
    expect((await store.get("rts-1"))?.sequenceCompletionState).toBe("ABANDONED");
  });
});
