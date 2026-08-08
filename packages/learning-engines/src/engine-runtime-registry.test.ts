import { describe, expect, it } from "vitest";
import { EngineAlreadyRegisteredError, EngineRuntimeRegistry } from "./engine-runtime-registry";
import { createDefaultEngineRuntimeRegistry } from "./default-engines";

describe("EngineRuntimeRegistry", () => {
  it("starts empty", () => {
    expect(new EngineRuntimeRegistry().list()).toHaveLength(0);
  });

  it("throws on duplicate runtimeAdapterId registration", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    const dupe = registry.getByRuntimeAdapterId("QC-WEB-ENGINE-BALANCE-MACHINE");
    expect(dupe).toBeDefined();
    expect(() => registry.register(dupe!)).toThrow(EngineAlreadyRegisteredError);
  });

  it("returns undefined for an unknown runtimeAdapterId", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    expect(registry.getByRuntimeAdapterId("QC-WEB-ENGINE-NUMERIC-INPUT")).toBeUndefined();
    expect(registry.getByRuntimeAdapterId("QC-WEB-ENGINE-GUIDED-PRACTICE")).toBeUndefined();
  });
});

describe("createDefaultEngineRuntimeRegistry", () => {
  it("registers exactly the 3 P0 engines, keyed by their ratified runtimeAdapterId", () => {
    const registry = createDefaultEngineRuntimeRegistry();
    expect(registry.list()).toHaveLength(3);
    expect(registry.getByRuntimeAdapterId("QC-WEB-ENGINE-BALANCE-MACHINE")?.canonicalEngineId).toBe("ENG-BALANCE");
    expect(registry.getByRuntimeAdapterId("QC-WEB-ENGINE-QUICK-QUESTION")?.canonicalEngineId).toBe("ENG-QUICK");
    expect(registry.getByRuntimeAdapterId("QC-WEB-ENGINE-DRAG-DROP")?.canonicalEngineId).toBe("ENG-DRAG");
  });
});
