/**
 * Positive/negative fixture coverage for the 5 vendored R3A schemas,
 * through this package's own Ajv pipeline (validate.ts) — not just a
 * standalone parse, but the same code path apps/api or packages/learning-engines
 * will actually call.
 */
import { describe, expect, it } from "vitest";
import { validateAgainst } from "./validate";

describe("vendored R3A schemas — positive and negative fixtures", () => {
  it("r3aCapabilityContract accepts a well-formed Axis A/B contract", () => {
    const result = validateAgainst("r3aCapabilityContract", {
      contractVersion: "1.0.0",
      axisA: {
        axisId: "AXIS_A_INTERACTION_ACTIVITY",
        authorityDocument: "07_08",
        values: ["DRAG_DROP", "TEXT_INPUT"],
      },
      axisB: {
        axisId: "AXIS_B_DEVICE_RUNTIME_PRESENTATION",
        referencedSchema: {
          repository: "quest-city-web",
          path: "packages/content-schema/schemas/capability-profile.schema.json",
          verifiedAtCommit: "b9a73dd8e1bbaf00501a282211af2216e6098cd8",
        },
        fields: ["input", "rendering"],
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("r3aCapabilityContract rejects a non-canonical Axis A value", () => {
    const result = validateAgainst("r3aCapabilityContract", {
      contractVersion: "1.0.0",
      axisA: {
        axisId: "AXIS_A_INTERACTION_ACTIVITY",
        values: ["NOT_A_REAL_CAPABILITY"],
      },
      axisB: {
        axisId: "AXIS_B_DEVICE_RUNTIME_PRESENTATION",
        referencedSchema: {
          repository: "quest-city-web",
          path: "packages/content-schema/schemas/capability-profile.schema.json",
          verifiedAtCommit: "b9a73dd8e1bbaf00501a282211af2216e6098cd8",
        },
      },
    });
    expect(result.valid).toBe(false);
  });

  it("r3aEngineRegistry rejects a malformed canonicalEngineId", () => {
    const result = validateAgainst("r3aEngineRegistry", {
      canonicalEngineId: "not-a-valid-id",
      version: "1.0.0",
      lifecycleStatus: "ACTIVE",
      capabilities: { required: [], optional: [] },
      semanticActions: ["PLACE_ITEM"],
      configurationSchemaRef: "x@1.0.0",
      validatorRequirements: [],
      accessibilityRequirements: [],
      persistenceRequirements: {},
      scoringEvidenceRequirements: {},
      runtimeAdapters: [],
      publicationRequirements: {},
    });
    expect(result.valid).toBe(false);
  });

  it("r3aTemplateContract rejects an out-of-vocabulary semantic action", () => {
    const result = validateAgainst("r3aTemplateContract", {
      templateId: "TMPL-TEST-FIXTURE",
      templateVersion: "1.0.0",
      canonicalEngineId: "ENG-TEST-FIXTURE",
      requiredCapabilities: ["DRAG_DROP"],
      configurationSchemaRef: "x@1.0.0",
      defaultConfiguration: {},
      semanticActions: ["NOT_A_REAL_ACTION"],
      validatorRequirements: [],
      accessibilityRequirements: [],
    });
    expect(result.valid).toBe(false);
  });

  it("r3aEngineGapReport rejects an invalid recommendedResolution", () => {
    const result = validateAgainst("r3aEngineGapReport", {
      activityId: "TEST-FIXTURE",
      subject: "MAT",
      pedagogicalObjective: "x",
      requiredCapabilities: ["DRAG_DROP"],
      evaluatedEngines: [],
      evaluatedTemplates: [],
      incompatibilityReasons: ["reason"],
      pedagogicalImpact: "impact",
      recommendedResolution: "JUST_DO_IT_SOMEHOW",
    });
    expect(result.valid).toBe(false);
  });

  it("r3aSupportEvaluation rejects ENGINE_GAP without engineGapReportRef", () => {
    const result = validateAgainst("r3aSupportEvaluation", {
      activityId: "TEST-FIXTURE",
      outcome: "ENGINE_GAP",
      evaluatedEngines: [],
      evaluatedTemplates: [],
      evaluationTimestamp: "2026-08-08T12:00:00.000Z",
      evaluationVersion: "1.0.0",
    });
    expect(result.valid).toBe(false);
  });
});
