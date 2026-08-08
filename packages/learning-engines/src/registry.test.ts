import { describe, expect, it } from "vitest";
import { EngineAlreadyRegisteredError, EngineRegistry } from "./registry";
import type { EngineRegistryEntry } from "./types";

function testEngine(overrides: Partial<EngineRegistryEntry> = {}): EngineRegistryEntry {
  return {
    canonicalEngineId: "ENG-TEST-FIXTURE-BALANCE",
    version: "0.0.1",
    lifecycleStatus: "ACTIVE",
    capabilities: { required: ["DRAG_DROP"], optional: ["ANIMATED_SCENE"] },
    semanticActions: ["PLACE_ITEM", "CONFIRM_SOLUTION"],
    templates: [],
    configurationSchemaRef: "test-fixture-config.schema.json@0.0.1",
    validatorRequirements: [],
    accessibilityRequirements: [{ fallback: "select-source-and-target" }],
    persistenceRequirements: {},
    scoringEvidenceRequirements: {},
    runtimeAdapters: [{ runtimeChannel: "WEB", runtimeAdapterId: "QC-WEB-ENGINE-TEST-FIXTURE" }],
    publicationRequirements: { minLifecycleStatus: "ACTIVE", requiresRealTestsPass: true },
    ...overrides,
  };
}

describe("EngineRegistry", () => {
  it("starts empty — no production engine is registered at R3B", () => {
    const registry = new EngineRegistry();
    expect(registry.list()).toHaveLength(0);
  });

  it("registers and retrieves an engine by canonicalEngineId", () => {
    const registry = new EngineRegistry();
    registry.register(testEngine());
    expect(registry.get("ENG-TEST-FIXTURE-BALANCE")?.canonicalEngineId).toBe(
      "ENG-TEST-FIXTURE-BALANCE",
    );
  });

  it("retrieves an engine by runtimeAdapterId (distinct identity from canonicalEngineId, D9)", () => {
    const registry = new EngineRegistry();
    registry.register(testEngine());
    const found = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-TEST-FIXTURE");
    expect(found?.canonicalEngineId).toBe("ENG-TEST-FIXTURE-BALANCE");
  });

  it("returns undefined for an unregistered runtimeAdapterId", () => {
    const registry = new EngineRegistry();
    expect(registry.getByRuntimeAdapterId("QC-WEB-ENGINE-DRAG-DROP")).toBeUndefined();
  });

  it("rejects a duplicate canonicalEngineId registration", () => {
    const registry = new EngineRegistry();
    const engine = testEngine();
    registry.register(engine);
    expect(() => registry.register(engine)).toThrow(EngineAlreadyRegisteredError);
  });

  it("filters by lifecycle status — DEPRECATED/RETIRED excluded from findByCapabilities", () => {
    const registry = new EngineRegistry();
    registry.register(testEngine({ canonicalEngineId: "ENG-TEST-FIXTURE-ACTIVE" }));
    registry.register(
      testEngine({ canonicalEngineId: "ENG-TEST-FIXTURE-DEPRECATED", lifecycleStatus: "DEPRECATED" }),
    );
    registry.register(
      testEngine({ canonicalEngineId: "ENG-TEST-FIXTURE-RETIRED", lifecycleStatus: "RETIRED" }),
    );
    const matches = registry.findByCapabilities(["DRAG_DROP"]);
    expect(matches.map((m) => m.canonicalEngineId)).toEqual(["ENG-TEST-FIXTURE-ACTIVE"]);
  });

  it("findByCapabilities requires every requested capability to be declared (required ∪ optional)", () => {
    const registry = new EngineRegistry();
    registry.register(testEngine());
    expect(registry.findByCapabilities(["DRAG_DROP", "ANIMATED_SCENE"])).toHaveLength(1);
    expect(registry.findByCapabilities(["DRAG_DROP", "VOICE_INPUT"])).toHaveLength(0);
  });

  it("hasRuntimeAdapter reflects the declared runtimeAdapters for the given channel", () => {
    const registry = new EngineRegistry();
    registry.register(testEngine());
    expect(registry.hasRuntimeAdapter("ENG-TEST-FIXTURE-BALANCE", "WEB")).toBe(true);
    expect(registry.hasRuntimeAdapter("ENG-TEST-FIXTURE-BALANCE", "ROBLOX")).toBe(false);
    expect(registry.hasRuntimeAdapter("ENG-DOES-NOT-EXIST")).toBe(false);
  });

  it("findByTemplate returns engines that reference the templateId", () => {
    const registry = new EngineRegistry();
    registry.register(testEngine({ templates: ["TMPL-TEST-FIXTURE-TWO-TERMS"] }));
    expect(registry.findByTemplate("TMPL-TEST-FIXTURE-TWO-TERMS")).toHaveLength(1);
    expect(registry.findByTemplate("TMPL-DOES-NOT-EXIST")).toHaveLength(0);
  });
});
