import { describe, expect, it } from "vitest";
import { replayActions } from "../engine-runtime";
import {
  BALANCE_MACHINE_CANONICAL_ENGINE_ID,
  BALANCE_MACHINE_RUNTIME_ADAPTER_ID,
  buildBalanceMachineRegistryEntry,
  createBalanceMachineEngine,
  validateBalanceMachineConfig,
} from "./balance-machine-engine";

const VALID_CONFIG = { tokens: [{ tokenId: "w5", weight: 5 }, { tokenId: "w5b", weight: 5 }] };

describe("BalanceMachineEngine — config validation", () => {
  it("accepts a valid configuration", () => {
    const result = validateBalanceMachineConfig(VALID_CONFIG);
    expect(result.valid).toBe(true);
  });

  it("rejects a configuration with no tokens", () => {
    const result = validateBalanceMachineConfig({ tokens: [] });
    expect(result.valid).toBe(false);
  });

  it("rejects a configuration with a non-positive weight", () => {
    const result = validateBalanceMachineConfig({ tokens: [{ tokenId: "w0", weight: 0 }] });
    expect(result.valid).toBe(false);
  });

  it("rejects a configuration with duplicate tokenIds", () => {
    const result = validateBalanceMachineConfig({
      tokens: [
        { tokenId: "dup", weight: 1 },
        { tokenId: "dup", weight: 2 },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a non-object configuration", () => {
    expect(validateBalanceMachineConfig(null).valid).toBe(false);
    expect(validateBalanceMachineConfig("not-an-object").valid).toBe(false);
  });
});

describe("BalanceMachineEngine — state initialization", () => {
  it("initializes with no placements and not confirmed", () => {
    const engine = createBalanceMachineEngine();
    const state = engine.initState(VALID_CONFIG);
    expect(state.placements).toEqual({});
    expect(state.confirmed).toBe(false);
  });
});

describe("BalanceMachineEngine — applyAction", () => {
  const engine = createBalanceMachineEngine();

  it("accepts PLACE_ITEM on the left side", () => {
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w5", side: "left" },
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.placements["w5"]).toBe("left");
  });

  it("accepts PLACE_ITEM on the right side", () => {
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w5b", side: "right" },
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.placements["w5b"]).toBe("right");
  });

  it("re-placing a token (MOVE semantics) overwrites its side", () => {
    let state = engine.initState(VALID_CONFIG);
    state = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w5", side: "left" },
    }).state;
    const moved = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w5", side: "right" },
    });
    expect(moved.accepted).toBe(true);
    expect(moved.state.placements["w5"]).toBe("right");
  });

  it("rejects PLACE_ITEM for an unknown tokenId", () => {
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "does-not-exist", side: "left" },
    });
    expect(outcome.accepted).toBe(false);
  });

  it("rejects PLACE_ITEM with malformed side", () => {
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w5", side: "up" },
    });
    expect(outcome.accepted).toBe(false);
  });

  it("RESET_STAGE clears placements and confirmation", () => {
    let state = engine.initState(VALID_CONFIG);
    state = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w5", side: "left" },
    }).state;
    const reset = engine.applyAction(state, VALID_CONFIG, {
      actionType: "RESET_STAGE",
      targetRole: null,
      payload: {},
    });
    expect(reset.accepted).toBe(true);
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

  it("CONFIRM_SOLUTION with a wrong targetRole is rejected", () => {
    let state = engine.initState(VALID_CONFIG);
    state = engine.applyAction(state, VALID_CONFIG, {
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "w5", side: "left" },
    }).state;
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "CONFIRM_SOLUTION",
      targetRole: "not-the-confirm-button",
      payload: {},
    });
    expect(outcome.accepted).toBe(false);
  });

  it("rejects an unsupported semantic action (e.g. SELECT_OPTION)", () => {
    const state = engine.initState(VALID_CONFIG);
    const outcome = engine.applyAction(state, VALID_CONFIG, {
      actionType: "SELECT_OPTION",
      targetRole: "weight-token",
      payload: {},
    });
    expect(outcome.accepted).toBe(false);
  });
});

describe("BalanceMachineEngine — evaluate", () => {
  const engine = createBalanceMachineEngine();

  it("is evaluated=false when not confirmed", () => {
    const state = engine.initState(VALID_CONFIG);
    const result = engine.evaluate(state, VALID_CONFIG);
    expect(result.evaluated).toBe(false);
  });

  it("scores CORRECT for equal weights on each side", () => {
    const { state } = replayActions(engine, VALID_CONFIG, [
      { actionType: "PLACE_ITEM", targetRole: "weight-token", payload: { tokenId: "w5", side: "left" } },
      { actionType: "PLACE_ITEM", targetRole: "weight-token", payload: { tokenId: "w5b", side: "right" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, VALID_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) {
      expect(result.correctness).toBe("CORRECT");
      expect(result.score).toBe(1);
    }
  });

  it("scores INCORRECT for unequal weights", () => {
    const config = { tokens: [{ tokenId: "w5", weight: 5 }, { tokenId: "w3", weight: 3 }] };
    const { state } = replayActions(engine, config, [
      { actionType: "PLACE_ITEM", targetRole: "weight-token", payload: { tokenId: "w5", side: "left" } },
      { actionType: "PLACE_ITEM", targetRole: "weight-token", payload: { tokenId: "w3", side: "right" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    const result = engine.evaluate(state, config);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) {
      expect(result.correctness).toBe("INCORRECT");
      expect(result.score).toBe(0);
    }
  });

  it("never fabricates a score from a malformed action log (client-supplied weight is ignored)", () => {
    // A client cannot influence weight via payload — only config (server/content-owned) does.
    const { state, rejectedCount } = replayActions(engine, VALID_CONFIG, [
      {
        actionType: "PLACE_ITEM",
        targetRole: "weight-token",
        payload: { tokenId: "w5", side: "left", weight: 9999 },
      },
      { actionType: "PLACE_ITEM", targetRole: "weight-token", payload: { tokenId: "w5b", side: "right" } },
      { actionType: "CONFIRM_SOLUTION", targetRole: "confirm-button", payload: {} },
    ]);
    expect(rejectedCount).toBe(0); // extra payload fields are simply ignored, not rejected
    const result = engine.evaluate(state, VALID_CONFIG);
    expect(result.evaluated).toBe(true);
    if (result.evaluated) {
      expect(result.correctness).toBe("CORRECT"); // 5 == 5, not influenced by the bogus 9999
    }
  });

  it("a fully malformed/empty action log never evaluates to a score", () => {
    const { state } = replayActions(engine, VALID_CONFIG, [
      { actionType: "SELECT_OPTION", targetRole: "irrelevant", payload: {} },
    ]);
    const result = engine.evaluate(state, VALID_CONFIG);
    expect(result.evaluated).toBe(false);
  });
});

describe("BalanceMachineEngine — identity and registry entry", () => {
  it("declares the ratified R3C.0A identity", () => {
    const engine = createBalanceMachineEngine();
    expect(engine.canonicalEngineId).toBe(BALANCE_MACHINE_CANONICAL_ENGINE_ID);
    expect(engine.runtimeAdapterId).toBe(BALANCE_MACHINE_RUNTIME_ADAPTER_ID);
    expect(engine.canonicalEngineId).toBe("ENG-BALANCE");
    expect(engine.runtimeAdapterId).toBe("QC-WEB-ENGINE-BALANCE-MACHINE");
  });

  it("builds a registry entry matching the engine's declared semantic actions and capabilities", () => {
    const entry = buildBalanceMachineRegistryEntry();
    expect(entry.semanticActions).toEqual(["PLACE_ITEM", "RESET_STAGE", "CONFIRM_SOLUTION"]);
    expect(entry.runtimeAdapters).toEqual([{ runtimeChannel: "WEB", runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE" }]);
  });
});
