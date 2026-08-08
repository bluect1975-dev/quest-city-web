import { describe, expect, it } from "vitest";
import { validateAgainst } from "@quest-city-web/content-schema";
import { buildBalanceMachineRegistryEntry, validateBalanceMachineConfig } from "./balance-machine-engine";
import { buildDragAndDropRegistryEntry, validateDragDropConfig } from "./drag-and-drop-engine";
import { buildQuickQuestionRegistryEntry, validateQuickQuestionConfig } from "./quick-question-engine";

/**
 * Confirms each engine's runtime `validateConfig()` and its declared
 * `configurationSchemaRef` (a real, registered JSON schema in
 * `@quest-city-web/content-schema`) agree on the same example
 * configuration — the Registry Update Gate's "CONFIG SCHEMA: PASS" line
 * item (R3C.1 §65), verified with real Ajv validation, not assumed.
 */
describe("engine configuration <-> content-schema conformance", () => {
  it("BalanceMachineConfig conforms to balance-machine-config.schema.json", () => {
    const config = { tokens: [{ tokenId: "a", weight: 3 }, { tokenId: "b", weight: 3 }] };
    expect(validateBalanceMachineConfig(config).valid).toBe(true);
    const schemaResult = validateAgainst("balanceMachineConfig", config);
    expect(schemaResult.valid).toBe(true);
    expect(buildBalanceMachineRegistryEntry().configurationSchemaRef).toBe("balance-machine-config.schema.json@1.0.0");
  });

  it("rejects a BalanceMachineConfig with a client-declared negative weight against the schema too", () => {
    const config = { tokens: [{ tokenId: "a", weight: -1 }] };
    expect(validateAgainst("balanceMachineConfig", config).valid).toBe(false);
  });

  it("QuickQuestionConfig (OPTION_SELECTION) conforms to quick-question-config.schema.json", () => {
    const config = { mode: "OPTION_SELECTION", options: [{ optionId: "a" }, { optionId: "b" }], correctOptionId: "a" };
    expect(validateQuickQuestionConfig(config).valid).toBe(true);
    expect(validateAgainst("quickQuestionConfig", config).valid).toBe(true);
    expect(buildQuickQuestionRegistryEntry().configurationSchemaRef).toBe("quick-question-config.schema.json@1.0.0");
  });

  it("QuickQuestionConfig (ENTER_VALUE) conforms to quick-question-config.schema.json", () => {
    const config = { mode: "ENTER_VALUE", expectedValue: 7, tolerance: 0 };
    expect(validateQuickQuestionConfig(config).valid).toBe(true);
    expect(validateAgainst("quickQuestionConfig", config).valid).toBe(true);
  });

  it("DragDropConfig conforms to drag-drop-config.schema.json", () => {
    const config = {
      items: [{ itemId: "i1" }],
      targets: [{ targetId: "t1" }],
      correctMapping: [{ itemId: "i1", targetId: "t1" }],
    };
    expect(validateDragDropConfig(config).valid).toBe(true);
    expect(validateAgainst("dragDropConfig", config).valid).toBe(true);
    expect(buildDragAndDropRegistryEntry().configurationSchemaRef).toBe("drag-drop-config.schema.json@1.0.0");
  });
});
