/**
 * Confirms the runtime's own output actually conforms to the vendored R3A
 * schemas — not just that TypeScript compiles, but that a real AJV
 * validator (already wired in @quest-city-web/content-schema) accepts the
 * shapes this package produces.
 */
import { validateAgainst } from "@quest-city-web/content-schema";
import { describe, expect, it } from "vitest";
import { buildEngineGapReport } from "./engine-gap-report";
import { EngineRegistry } from "./registry";
import { evaluateSupport } from "./support-evaluator";
import { TemplateRegistry } from "./template-registry";
import type { ActivitySpecification, EngineRegistryEntry, TemplateContractEntry } from "./types";

const NOW = "2026-08-08T12:00:00.000Z";

const spec: ActivitySpecification = {
  activityId: "TEST-FIXTURE-ACTIVITY-CONTRACT",
  subject: "MAT",
  pedagogicalObjective: "Solve a two-term balance equation",
  reasoningType: "procedural-manipulation",
  interactionModel: "direct-manipulation",
  evidenceModel: "semantic-evidence",
  evaluationModel: "deterministic-validator",
  requiredCapabilities: ["DRAG_DROP"],
};

describe("Runtime output is schema-valid against the vendored R3A contracts", () => {
  it("an EngineRegistryEntry validates against r3aEngineRegistry", () => {
    const entry: EngineRegistryEntry = {
      canonicalEngineId: "ENG-TEST-FIXTURE-BALANCE",
      version: "0.0.1",
      lifecycleStatus: "ACTIVE",
      capabilities: { required: ["DRAG_DROP"], optional: [] },
      semanticActions: ["PLACE_ITEM", "CONFIRM_SOLUTION"],
      configurationSchemaRef: "test-fixture-config.schema.json@0.0.1",
      validatorRequirements: [],
      accessibilityRequirements: [{ fallback: "select-source-and-target" }],
      persistenceRequirements: {},
      scoringEvidenceRequirements: {},
      runtimeAdapters: [{ runtimeChannel: "WEB", runtimeAdapterId: "QC-WEB-ENGINE-TEST-FIXTURE" }],
      publicationRequirements: { minLifecycleStatus: "ACTIVE", requiresRealTestsPass: true },
    };
    const result = validateAgainst("r3aEngineRegistry", entry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("a TemplateContractEntry validates against r3aTemplateContract", () => {
    const template: TemplateContractEntry = {
      templateId: "TMPL-TEST-FIXTURE-TWO-TERMS",
      templateVersion: "0.0.1",
      canonicalEngineId: "ENG-TEST-FIXTURE-BALANCE",
      requiredCapabilities: ["DRAG_DROP"],
      configurationSchemaRef: "test-fixture-template-config.schema.json@0.0.1",
      defaultConfiguration: { terms: 2 },
      semanticActions: ["PLACE_ITEM", "CONFIRM_SOLUTION"],
      validatorRequirements: [],
      accessibilityRequirements: [{ fallback: "two-column-panel" }],
    };
    const result = validateAgainst("r3aTemplateContract", template);
    expect(result.valid).toBe(true);
  });

  it("an ENGINE_GAP SupportEvaluationResult validates against r3aSupportEvaluation", () => {
    const { result } = evaluateSupport(spec, new EngineRegistry(), new TemplateRegistry(), {
      capabilityContractVersion: "1.0.0",
      registryVersion: "0.0.0-test-fixture",
      evaluationVersion: "1.0.0",
      reportVersion: "1.0.0",
      now: NOW,
    });
    const check = validateAgainst("r3aSupportEvaluation", result);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it("a SUPPORTED SupportEvaluationResult validates against r3aSupportEvaluation", () => {
    const registry = new EngineRegistry();
    registry.register({
      canonicalEngineId: "ENG-TEST-FIXTURE-BALANCE",
      version: "0.0.1",
      lifecycleStatus: "ACTIVE",
      capabilities: { required: ["DRAG_DROP"], optional: [] },
      semanticActions: ["PLACE_ITEM", "CONFIRM_SOLUTION"],
      configurationSchemaRef: "test-fixture-config.schema.json@0.0.1",
      validatorRequirements: [],
      accessibilityRequirements: [{ fallback: "select-source-and-target" }],
      persistenceRequirements: {},
      scoringEvidenceRequirements: {},
      runtimeAdapters: [{ runtimeChannel: "WEB", runtimeAdapterId: "QC-WEB-ENGINE-TEST-FIXTURE" }],
      publicationRequirements: { minLifecycleStatus: "ACTIVE", requiresRealTestsPass: true },
    });
    const { result } = evaluateSupport(spec, registry, new TemplateRegistry(), {
      capabilityContractVersion: "1.0.0",
      registryVersion: "0.0.0-test-fixture",
      evaluationVersion: "1.0.0",
      reportVersion: "1.0.0",
      now: NOW,
    });
    const check = validateAgainst("r3aSupportEvaluation", result);
    expect(check.valid).toBe(true);
  });

  it("a produced EngineGapReport validates against r3aEngineGapReport", () => {
    const report = buildEngineGapReport({
      spec,
      evaluatedEngines: [],
      evaluatedTemplates: [],
      incompatibilityReasons: ["Engine Registry is empty — no canonical engine registered."],
      pedagogicalImpact: "No engine exists yet to serve this capability set.",
      recommendedResolution: "NEW_ENGINE",
      reportVersion: "1.0.0",
      generatedAt: NOW,
    });
    const check = validateAgainst("r3aEngineGapReport", report);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
  });
});
