import { describe, expect, it } from "vitest";
import { EngineRegistry } from "./registry";
import { TemplateRegistry } from "./template-registry";
import { evaluateSupport, type EvaluateSupportOptions } from "./support-evaluator";
import type { ActivitySpecification, EngineRegistryEntry, FidelityAssessment, TemplateContractEntry } from "./types";

const NOW = "2026-08-08T12:00:00.000Z";

const OPTIONS: EvaluateSupportOptions = {
  capabilityContractVersion: "1.0.0",
  registryVersion: "0.0.0-test-fixture",
  evaluationVersion: "1.0.0",
  reportVersion: "1.0.0",
  now: NOW,
};

function activeEngine(overrides: Partial<EngineRegistryEntry> = {}): EngineRegistryEntry {
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

function testSpec(overrides: Partial<ActivitySpecification> = {}): ActivitySpecification {
  return {
    activityId: "TEST-FIXTURE-ACTIVITY-001",
    subject: "MAT",
    pedagogicalObjective: "Solve a two-term balance equation",
    reasoningType: "procedural-manipulation",
    interactionModel: "direct-manipulation",
    evidenceModel: "semantic-evidence",
    evaluationModel: "deterministic-validator",
    requiredCapabilities: ["DRAG_DROP"],
    ...overrides,
  };
}

describe("Support Evaluator — engine selection order and four canonical outcomes", () => {
  // Scenario A: empty registry -> ENGINE_GAP
  it("A. empty registry produces ENGINE_GAP deterministically, never SUPPORTED or a technical error", () => {
    const { result, engineGapReport } = evaluateSupport(
      testSpec(),
      new EngineRegistry(),
      new TemplateRegistry(),
      OPTIONS,
    );
    expect(result.outcome).toBe("ENGINE_GAP");
    expect(result.publicationEligibility).toBe("NOT_PUBLISHABLE");
    expect(engineGapReport).toBeDefined();
    expect(engineGapReport?.incompatibilityReasons.length).toBeGreaterThan(0);
  });

  // Scenario B: exact capability match -> SUPPORTED
  it("B. an ACTIVE engine whose capabilities exactly cover the requirement yields SUPPORTED", () => {
    const registry = new EngineRegistry();
    registry.register(activeEngine());
    const { result } = evaluateSupport(testSpec(), registry, new TemplateRegistry(), OPTIONS);
    expect(result.outcome).toBe("SUPPORTED");
    expect(result.selectedEngine).toBe("ENG-TEST-FIXTURE-BALANCE");
    expect(result.publicationEligibility).toBe("ELIGIBLE");
  });

  // Scenario C: engine + compatible template -> SUPPORTED_WITH_TEMPLATE
  it("C. a template layered on an ACTIVE engine yields SUPPORTED_WITH_TEMPLATE when no plain engine covers the requirement", () => {
    const registry = new EngineRegistry();
    registry.register(activeEngine({ capabilities: { required: [], optional: [] } })); // engine alone does not cover DRAG_DROP
    const templates = new TemplateRegistry();
    templates.register(testTemplate());
    const { result } = evaluateSupport(testSpec(), registry, templates, OPTIONS);
    expect(result.outcome).toBe("SUPPORTED_WITH_TEMPLATE");
    expect(result.selectedEngine).toBe("ENG-TEST-FIXTURE-BALANCE");
    expect(result.selectedTemplate).toBe("TMPL-TEST-FIXTURE-TWO-TERMS");
    expect(result.publicationEligibility).toBe("ELIGIBLE");
  });

  // Scenario D: explicit non-substantial limitation -> SUPPORTED_WITH_LIMITATIONS
  it("D. an explicit, non-substantial limitation against an ACTIVE engine yields SUPPORTED_WITH_LIMITATIONS", () => {
    const registry = new EngineRegistry();
    registry.register(activeEngine({ capabilities: { required: [], optional: [] } }));
    const assessment: FidelityAssessment = {
      canonicalEngineId: "ENG-TEST-FIXTURE-BALANCE",
      preservesPedagogicalObjective: true,
      preservesReasoningType: true,
      preservesInteractionModel: true,
      preservesEvidenceModel: true,
      preservesEvaluationModel: true,
      limitations: [
        { description: "No animated feedback on drop, static highlight only", pedagogicallySubstantial: false },
      ],
    };
    const { result } = evaluateSupport(testSpec(), registry, new TemplateRegistry(), {
      ...OPTIONS,
      fidelityAssessments: [assessment],
    });
    expect(result.outcome).toBe("SUPPORTED_WITH_LIMITATIONS");
    expect(result.limitations).toHaveLength(1);
    expect(result.publicationEligibility).toBe("ELIGIBLE");
  });

  // Scenario E: substantial pedagogical loss declared -> ENGINE_GAP even though capability matches
  it("E. a fidelity assessment declaring a substantial loss forces ENGINE_GAP even with full capability coverage", () => {
    const registry = new EngineRegistry();
    registry.register(activeEngine());
    const assessment: FidelityAssessment = {
      canonicalEngineId: "ENG-TEST-FIXTURE-BALANCE",
      preservesPedagogicalObjective: true,
      preservesReasoningType: false, // substantial loss
      preservesInteractionModel: true,
      preservesEvidenceModel: true,
      preservesEvaluationModel: true,
    };
    const { result, engineGapReport } = evaluateSupport(testSpec(), registry, new TemplateRegistry(), {
      ...OPTIONS,
      fidelityAssessments: [assessment],
    });
    expect(result.outcome).toBe("ENGINE_GAP");
    expect(result.publicationEligibility).toBe("NOT_PUBLISHABLE");
    expect(engineGapReport?.incompatibilityReasons.join(" ")).toContain("reasoningType");
  });

  // Scenario F: DEPRECATED/RETIRED engine is not eligible, even with matching capabilities
  it("F. a DEPRECATED engine with matching capabilities is not eligible — ENGINE_GAP, not silently reused", () => {
    const registry = new EngineRegistry();
    registry.register(activeEngine({ lifecycleStatus: "DEPRECATED" }));
    const { result } = evaluateSupport(testSpec(), registry, new TemplateRegistry(), OPTIONS);
    expect(result.outcome).toBe("ENGINE_GAP");

    const registryRetired = new EngineRegistry();
    registryRetired.register(activeEngine({ lifecycleStatus: "RETIRED" }));
    const { result: resultRetired } = evaluateSupport(
      testSpec(),
      registryRetired,
      new TemplateRegistry(),
      OPTIONS,
    );
    expect(resultRetired.outcome).toBe("ENGINE_GAP");
  });

  it("evaluatedEngines/evaluatedTemplates always report everything considered, not just the winner", () => {
    const registry = new EngineRegistry();
    registry.register(activeEngine());
    registry.register(activeEngine({ canonicalEngineId: "ENG-TEST-FIXTURE-OTHER", capabilities: { required: [], optional: [] } }));
    const { result } = evaluateSupport(testSpec(), registry, new TemplateRegistry(), OPTIONS);
    expect(result.evaluatedEngines.sort()).toEqual(
      ["ENG-TEST-FIXTURE-BALANCE", "ENG-TEST-FIXTURE-OTHER"].sort(),
    );
  });

  it("respects preferredCanonicalEngineIds ordering among otherwise-equal exact-match candidates", () => {
    const registry = new EngineRegistry();
    registry.register(activeEngine({ canonicalEngineId: "ENG-TEST-FIXTURE-A" }));
    registry.register(activeEngine({ canonicalEngineId: "ENG-TEST-FIXTURE-B" }));
    const { result } = evaluateSupport(
      testSpec({ preferredCanonicalEngineIds: ["ENG-TEST-FIXTURE-B", "ENG-TEST-FIXTURE-A"] }),
      registry,
      new TemplateRegistry(),
      OPTIONS,
    );
    expect(result.selectedEngine).toBe("ENG-TEST-FIXTURE-B");
  });
});

describe("Support Evaluator — Pedagogical Fidelity Rule (02_36 §8.1), tested per dimension", () => {
  const dimensions: Array<keyof Pick<
    FidelityAssessment,
    | "preservesPedagogicalObjective"
    | "preservesReasoningType"
    | "preservesInteractionModel"
    | "preservesEvidenceModel"
    | "preservesEvaluationModel"
  >> = [
    "preservesPedagogicalObjective",
    "preservesReasoningType",
    "preservesInteractionModel",
    "preservesEvidenceModel",
    "preservesEvaluationModel",
  ];

  for (const dimension of dimensions) {
    it(`a false ${dimension} alone forces ENGINE_GAP, never SUPPORTED_WITH_LIMITATIONS`, () => {
      const registry = new EngineRegistry();
      registry.register(activeEngine());
      const assessment: FidelityAssessment = {
        canonicalEngineId: "ENG-TEST-FIXTURE-BALANCE",
        preservesPedagogicalObjective: true,
        preservesReasoningType: true,
        preservesInteractionModel: true,
        preservesEvidenceModel: true,
        preservesEvaluationModel: true,
        [dimension]: false,
      };
      const { result } = evaluateSupport(testSpec(), registry, new TemplateRegistry(), {
        ...OPTIONS,
        fidelityAssessments: [assessment],
      });
      expect(result.outcome).toBe("ENGINE_GAP");
    });
  }
});

describe("Support Evaluator — publication block (02_36 §9)", () => {
  it("ENGINE_GAP always carries engineGapReportRef and NOT_PUBLISHABLE together", () => {
    const { result } = evaluateSupport(testSpec(), new EngineRegistry(), new TemplateRegistry(), OPTIONS);
    expect(result.outcome).toBe("ENGINE_GAP");
    expect(result.engineGapReportRef).toBeDefined();
    expect(result.publicationEligibility).toBe("NOT_PUBLISHABLE");
  });

  it("every non-ENGINE_GAP outcome is ELIGIBLE", () => {
    const registry = new EngineRegistry();
    registry.register(activeEngine());
    const { result } = evaluateSupport(testSpec(), registry, new TemplateRegistry(), OPTIONS);
    expect(result.outcome).not.toBe("ENGINE_GAP");
    expect(result.publicationEligibility).toBe("ELIGIBLE");
  });
});
