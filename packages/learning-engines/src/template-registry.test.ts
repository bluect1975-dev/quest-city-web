import { describe, expect, it } from "vitest";
import { TemplateAlreadyRegisteredError, TemplateRegistry } from "./template-registry";
import type { TemplateContractEntry } from "./types";

function testTemplate(overrides: Partial<TemplateContractEntry> = {}): TemplateContractEntry {
  return {
    templateId: "TMPL-TEST-FIXTURE-TWO-TERMS",
    templateVersion: "0.0.1",
    canonicalEngineId: "ENG-TEST-FIXTURE-BALANCE",
    requiredCapabilities: ["DRAG_DROP"],
    configurationSchemaRef: "test-fixture-template-config.schema.json@0.0.1",
    defaultConfiguration: { terms: 2 },
    semanticActions: ["PLACE_ITEM", "CONFIRM_SOLUTION"],
    validatorRequirements: [],
    accessibilityRequirements: [{ fallback: "two-column-panel" }],
    ...overrides,
  };
}

describe("TemplateRegistry", () => {
  it("starts empty — no production template registered at R3B", () => {
    expect(new TemplateRegistry().list()).toHaveLength(0);
  });

  it("registers and retrieves by templateId + templateVersion", () => {
    const registry = new TemplateRegistry();
    registry.register(testTemplate());
    expect(registry.get("TMPL-TEST-FIXTURE-TWO-TERMS", "0.0.1")?.templateId).toBe(
      "TMPL-TEST-FIXTURE-TWO-TERMS",
    );
    expect(registry.get("TMPL-TEST-FIXTURE-TWO-TERMS", "9.9.9")).toBeUndefined();
  });

  it("rejects a duplicate templateId+templateVersion registration", () => {
    const registry = new TemplateRegistry();
    const template = testTemplate();
    registry.register(template);
    expect(() => registry.register(template)).toThrow(TemplateAlreadyRegisteredError);
  });

  it("allows two versions of the same templateId to coexist", () => {
    const registry = new TemplateRegistry();
    registry.register(testTemplate({ templateVersion: "0.0.1" }));
    registry.register(testTemplate({ templateVersion: "0.0.2" }));
    expect(registry.list()).toHaveLength(2);
  });

  it("findByCanonicalEngineId returns templates layered on that engine only", () => {
    const registry = new TemplateRegistry();
    registry.register(testTemplate());
    registry.register(
      testTemplate({ templateId: "TMPL-TEST-FIXTURE-OTHER", canonicalEngineId: "ENG-TEST-FIXTURE-OTHER" }),
    );
    expect(registry.findByCanonicalEngineId("ENG-TEST-FIXTURE-BALANCE")).toHaveLength(1);
  });

  it("findByCapabilities requires every requested capability to be in requiredCapabilities", () => {
    const registry = new TemplateRegistry();
    registry.register(testTemplate());
    expect(registry.findByCapabilities(["DRAG_DROP"])).toHaveLength(1);
    expect(registry.findByCapabilities(["DRAG_DROP", "VOICE_INPUT"])).toHaveLength(0);
  });
});
