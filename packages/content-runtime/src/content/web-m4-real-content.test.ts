import { describe, expect, it } from "vitest";
import { createDefaultEngineRuntimeRegistry } from "@quest-city-web/learning-engines";
import { loadBundleManifest } from "../bundle-loader";
import {
  WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST,
  WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG,
  WEB_M4_BALANCE_MACHINE_SOLUTION,
  WEB_M4_ACTIVITY_SEQUENCE_DEFINITION,
  WEB_M4_ACTIVITY_STAGE_ID,
} from "./web-m4-real-content";

describe("WEB-M4 real content (07_25 v1.0 §16)", () => {
  it("the bundle manifest is a real, schema-valid, non-fixture bundle (ACTIVITY_BUNDLE, PUBLISHED)", () => {
    expect(WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST.bundleType).toBe("ACTIVITY_BUNDLE");
    expect(WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST.status).toBe("PUBLISHED");
    const result = loadBundleManifest(WEB_M4_BALANCE_MACHINE_BUNDLE_MANIFEST);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("the engine config is valid against BalanceMachineEngine's own validator", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-BALANCE-MACHINE")!;
    const result = engine.validateConfig(WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG);
    expect(result.valid).toBe(true);
  });

  it("the declared solution actually evaluates as CORRECT through the real engine (15 = 11 + 4, per 03_14 §12 VS-A)", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-BALANCE-MACHINE");
    expect(engine).toBeDefined();
    const validation = engine!.validateConfig(WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;

    let state = engine!.initState(validation.config);
    for (const [tokenId, side] of Object.entries(WEB_M4_BALANCE_MACHINE_SOLUTION)) {
      const outcome = engine!.applyAction(state, validation.config, {
        actionType: "PLACE_ITEM",
        targetRole: "weight-token",
        payload: { tokenId, side },
      });
      expect(outcome.accepted).toBe(true);
      state = outcome.state;
    }
    const confirmOutcome = engine!.applyAction(state, validation.config, {
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
    });
    expect(confirmOutcome.accepted).toBe(true);
    const result = engine!.evaluate(confirmOutcome.state, validation.config);
    expect(result).toMatchObject({ evaluated: true, correctness: "CORRECT", score: 1 });
  });

  it("an unbalanced placement (only the constant-11 token) evaluates as INCORRECT — the deliberate wrong-answer path is real, not simulated", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const engine = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-BALANCE-MACHINE")!;
    const validation = engine.validateConfig(WEB_M4_BALANCE_MACHINE_ENGINE_CONFIG);
    if (!validation.valid) throw new Error("unreachable");
    let state = engine.initState(validation.config);
    state = engine.applyAction(state, validation.config, {
      actionType: "PLACE_ITEM",
      targetRole: "weight-token",
      payload: { tokenId: "constant-11", side: "right" },
    }).state;
    const confirmed = engine.applyAction(state, validation.config, {
      actionType: "CONFIRM_SOLUTION",
      targetRole: "confirm-button",
      payload: {},
    });
    const result = engine.evaluate(confirmed.state, validation.config);
    expect(result).toMatchObject({ evaluated: true, correctness: "INCORRECT", score: 0 });
  });

  it("the single-stage sequence definition wires the real activity to ENG-BALANCE via RUNTIME_ADAPTER_ID resolution", () => {
    expect(WEB_M4_ACTIVITY_SEQUENCE_DEFINITION.stages).toHaveLength(1);
    const stage = WEB_M4_ACTIVITY_SEQUENCE_DEFINITION.stages[0]!;
    expect(stage.stageId).toBe(WEB_M4_ACTIVITY_STAGE_ID);
    expect(stage.engineDispatchRef).toMatchObject({
      resolutionMode: "RUNTIME_ADAPTER_ID",
      runtimeAdapterId: "QC-WEB-ENGINE-BALANCE-MACHINE",
    });
  });
});
