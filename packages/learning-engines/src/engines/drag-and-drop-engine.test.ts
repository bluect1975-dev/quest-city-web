import { describe, expect, it } from "vitest";
import { replayActions } from "../engine-runtime";
import {
  DRAG_AND_DROP_CANONICAL_ENGINE_ID,
  DRAG_AND_DROP_RUNTIME_ADAPTER_ID,
  buildDragAndDropRegistryEntry,
  createDragAndDropEngine,
  validateDragDropConfig,
} from "./drag-and-drop-engine";

const VALID_CONFIG = {
  items: [{ itemId: "i1" }, { itemId: "i2" }],
  targets: [{ targetId: "t1" }, { targetId: "t2" }],
  correctMapping: [
    { itemId: "i1", targetId: "t1" },
    { itemId: "i2", targetId: "t2" },
  ],
};

describe("DragAndDropEngine — config validation", () => {
  it("accepts a valid configuration", () => {
    expect(validateDragDropConfig(VALID_CONFIG).valid).toBe(true);
  });

  it("rejects empty items", () => {
    expect(validateDragDropConfig({ ...VALID_CONFIG, items: [] }).valid).toBe(false);
  });

  it("rejects empty targets", () => {
    expect(validateDragDropConfig({ ...VALID_CONFIG, targets: [] }).valid).toBe(false);
  });

  it("rejects a correctMapping referencing an undeclared item", () => {
    expect(
      validateDragDropConfig({
        ...VALID_CONFIG,
        correctMapping: [{ itemId: "does-not-exist", targetId: "t1" }],
      }).valid,
    ).toBe(false);
  });

  it("rejects a correctMapping referencing an undeclared target", () => {
    expect(
      validateDragDropConfig({
        ...VALID_CONFIG,
        correctMapping: [{ itemId: "i1", targetId: "does-not-exist" }],
      }).valid,
    ).toBe(false);
  });

  it("rejects duplicate itemIds", () => {
    expect(
      validateDragDropConfig({ ...VALID_CONFIG, items: [{ itemId: "dup" }, { itemId: "dup" }] }).valid,
    ).toBe(false);
  });
});

describe("DragAndDropEngine — applyAction", () => {
  const engine = createDragAndDropEngine();

  it("PLACE_ITEM records a mapping", () => {
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: "i1", targetId: "t1" },
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.placements["i1"]).toBe("t1");
  });

  it("MOVE_ITEM overwrites a prior placement (pointer or keyboard-fallback path, same semantics)", () => {
    let state = engine.initState(VALID_CONFIG);
    state = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: "i1", targetId: "t1" },
    }).state;
    const moved = engine.applyAction(state, VALID_CONFIG, {
      actionType: "MOVE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: "i1", targetId: "t2" },
    });
    expect(moved.accepted).toBe(true);
    expect(moved.state.placements["i1"]).toBe("t2");
  });

  it("rejects PLACE_ITEM for an unknown itemId", () => {
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: "unknown", targetId: "t1" },
    });
    expect(outcome.accepted).toBe(false);
  });

  it("rejects PLACE_ITEM for an unknown targetId", () => {
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: "i1", targetId: "unknown" },
    });
    expect(outcome.accepted).toBe(false);
  });

  it("keyboard-fallback source->destination->confirm produces the same PLACE_ITEM action shape as pointer drag", () => {
    // The engine has no separate "keyboard mode" — the UI layer is
    // responsible for translating a select-source/select-destination/place
    // sequence into the same PLACE_ITEM action a pointer drag would emit.
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: "i1", targetId: "t1" },
    });
    expect(outcome.accepted).toBe(true);
  });

  it("RESET_STAGE clears all placements", () => {
    let state = engine.initState(VALID_CONFIG);
    state = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "drop-target",
      payload: { itemId: "i1", targetId: "t1" },
    }).state;
    const reset = engine.applyAction(state, VALID_CONFIG, { actionType: "RESET_STAGE", targetRole: null, payload: {} });
    expect(reset.state.placements).toEqual({});
  });

  it("CONFIRM_SOLUTION with no placements is rejected", () => {
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
    });
    expect(outcome.accepted).toBe(false);
  });
});

describe("DragAndDropEngine — evaluate", () => {
  const engine = createDragAndDropEngine();

  it("scores CORRECT for the exact correct mapping", () => {
    const { state } = replayActions(engine, VALID_CONFIG, [
      { actionType: "PLACE_ITEM", targetRole: "drop-target", payload: { itemId: "i1", targetId: "t1" } },
      { actionType: "PLACE_ITEM", targetRole: "drop-target", payload: { itemId: "i2", targetId: "t2" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, VALID_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) expect(result.correctness).toBe("CORRECT");
  });

  it("scores INCORRECT for a wrong mapping", () => {
    const { state } = replayActions(engine, VALID_CONFIG, [
      { actionType: "PLACE_ITEM", targetRole: "drop-target", payload: { itemId: "i1", targetId: "t2" } },
      { actionType: "PLACE_ITEM", targetRole: "drop-target", payload: { itemId: "i2", targetId: "t1" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, VALID_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) expect(result.correctness).toBe("INCORRECT");
  });

  it("never fabricates a score from a malformed action log", () => {
    const { state } = replayActions(engine, VALID_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "irrelevant", payload: {} },
    ]);
    const result = engine.evaluate(state, VALID_CONFIG);
    expect(result.evaluated).toBe(false);
  });
});

describe("DragAndDropEngine — identity and registry entry", () => {
  it("declares the ratified identity (07_10 v1.0, unchanged in R3C.0A)", () => {
    const engine = createDragAndDropEngine();
    expect(engine.canonicalEngineId).toBe(DRAG_AND_DROP_CANONICAL_ENGINE_ID);
    expect(engine.runtimeAdapterId).toBe(DRAG_AND_DROP_RUNTIME_ADAPTER_ID);
    expect(engine.canonicalEngineId).toBe("ENG-DRAG");
    expect(engine.runtimeAdapterId).toBe("QC-WEB-ENGINE-DRAG-DROP");
  });

  it("builds a registry entry without Balance-specific semantics", () => {
    const entry = buildDragAndDropRegistryEntry();
    expect(entry.semanticActions).not.toContain("PLACE_ITEM_ON_SCALE" as never);
    expect(entry.runtimeAdapters).toEqual([{ runtimeChannel: "WEB", runtimeAdapterId: "QC-WEB-ENGINE-DRAG-DROP" }]);
  });
});
