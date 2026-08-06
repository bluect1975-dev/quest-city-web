import { describe, expect, it } from "vitest";
import { EngineRegistry } from "./registry";

describe("EngineRegistry", () => {
  it("starts empty — no engine is implemented at WEB-M0", () => {
    const registry = new EngineRegistry();
    expect(registry.list()).toHaveLength(0);
  });

  it("registers and retrieves an engine", () => {
    const registry = new EngineRegistry();
    registry.register({
      engineId: "ENG-BALANCE",
      engineVersion: "0.0.1",
      supportedActivityTypes: ["balance-equation"],
      capabilityRequirements: ["html", "keyboard"],
    });
    expect(registry.get("ENG-BALANCE")?.engineId).toBe("ENG-BALANCE");
  });

  it("rejects a duplicate registration", () => {
    const registry = new EngineRegistry();
    const engine = {
      engineId: "ENG-BALANCE",
      engineVersion: "0.0.1",
      supportedActivityTypes: ["balance-equation"],
      capabilityRequirements: ["html"],
    };
    registry.register(engine);
    expect(() => registry.register(engine)).toThrow();
  });
});
