import { describe, expect, it } from "vitest";
import { validateAgainst } from "@quest-city-web/content-schema";
import { EngineRegistry } from "./registry";
import { TemplateRegistry } from "./template-registry";
import { evaluateSupport } from "./support-evaluator";
import { createDefaultEngineRuntimeRegistry } from "./default-engines";
import { createP0EngineRegistryEntries } from "./default-engines";
import type { ActivitySpecification, EngineRegistryEntry } from "./types";

const NOW = "2026-08-08T00:00:00.000Z";
const EVAL_OPTIONS = {
  capabilityContractVersion: "1.1",
  registryVersion: "R3C.1",
  evaluationVersion: "1.0.0",
  reportVersion: "1.0.0",
  now: NOW,
};

/** The 3 P0 entries, promoted to ACTIVE after passing the Registry Update Gate (R3C.1 §11, §48). */
function activeP0Entries(): EngineRegistryEntry[] {
  return createP0EngineRegistryEntries();
}

function balanceActivitySpec(overrides: Partial<ActivitySpecification> = {}): ActivitySpecification {
  return {
    activityId: "demo-balance-activity",
    pedagogicalObjective: "richiamo, diagnosi, pratica rapida",
    reasoningType: "equivalence-verification",
    interactionModel: "place-and-confirm",
    evidenceModel: "action-log",
    evaluationModel: "binary-correctness",
    requiredCapabilities: ["OBJECT_MANIPULATION_2D"],
    ...overrides,
  };
}

describe("R3C.1 — Registry Update Gate: registry entry schema validity", () => {
  it("each P0 engine registry entry conforms to the vendored engine-registry.schema.json", () => {
    for (const entry of createP0EngineRegistryEntries()) {
      const result = validateAgainst("r3aEngineRegistry", entry);
      expect(result.valid, `${entry.canonicalEngineId}: ${result.errors.join("; ")}`).toBe(true);
    }
  });

  it("builds exactly 3 P0 entries, matching the ratified R3C.0A identities", () => {
    const entries = createP0EngineRegistryEntries();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.canonicalEngineId).sort()).toEqual(["ENG-BALANCE", "ENG-DRAG", "ENG-QUICK"]);
    expect(entries.map((e) => e.runtimeAdapters[0]?.runtimeAdapterId).sort()).toEqual([
      "QC-WEB-ENGINE-BALANCE-MACHINE",
      "QC-WEB-ENGINE-DRAG-DROP",
      "QC-WEB-ENGINE-QUICK-QUESTION",
    ]);
  });
});

describe("R3C.1 — Support Evaluator sees the 3 P0 engines once ACTIVE", () => {
  it("ENG-BALANCE (OBJECT_MANIPULATION_2D) resolves to SUPPORTED", () => {
    const registry = new EngineRegistry();
    for (const entry of activeP0Entries()) registry.register(entry);
    const templateRegistry = new TemplateRegistry();

    const { result } = evaluateSupport(balanceActivitySpec(), registry, templateRegistry, EVAL_OPTIONS);
    expect(result.outcome).toBe("SUPPORTED");
    expect(result.selectedEngine).toBe("ENG-BALANCE");
    expect(result.publicationEligibility).toBe("ELIGIBLE");
  });

  it("ENG-QUICK (OPTION_SELECTION) resolves to SUPPORTED", () => {
    const registry = new EngineRegistry();
    for (const entry of activeP0Entries()) registry.register(entry);
    const templateRegistry = new TemplateRegistry();

    const spec = balanceActivitySpec({
      activityId: "demo-quick-activity",
      requiredCapabilities: ["OPTION_SELECTION"],
    });
    const { result } = evaluateSupport(spec, registry, templateRegistry, EVAL_OPTIONS);
    expect(result.outcome).toBe("SUPPORTED");
    expect(result.selectedEngine).toBe("ENG-QUICK");
  });

  it("ENG-DRAG (DRAG_DROP) resolves to SUPPORTED", () => {
    const registry = new EngineRegistry();
    for (const entry of activeP0Entries()) registry.register(entry);
    const templateRegistry = new TemplateRegistry();

    const spec = balanceActivitySpec({ activityId: "demo-drag-activity", requiredCapabilities: ["DRAG_DROP"] });
    const { result } = evaluateSupport(spec, registry, templateRegistry, EVAL_OPTIONS);
    expect(result.outcome).toBe("SUPPORTED");
    expect(result.selectedEngine).toBe("ENG-DRAG");
  });

  it("with only the 3 P0 engines registered, an unregistered capability (e.g. GRAPH_PLOT) still produces a real ENGINE_GAP, not a silent fallback", () => {
    const registry = new EngineRegistry();
    for (const entry of activeP0Entries()) registry.register(entry);
    const templateRegistry = new TemplateRegistry();

    const spec = balanceActivitySpec({ activityId: "demo-graph-activity", requiredCapabilities: ["GRAPH_PLOT"] });
    const { result, engineGapReport } = evaluateSupport(spec, registry, templateRegistry, EVAL_OPTIONS);
    expect(result.outcome).toBe("ENGINE_GAP");
    expect(result.publicationEligibility).toBe("NOT_PUBLISHABLE");
    expect(engineGapReport).toBeDefined();
  });
});

describe("R3C.1 §52-53 — numeric activities resolve to ENG-QUICK, never fabricate a NumericInputEngine registration", () => {
  it("a NUMERIC_INPUT-only requirement resolves to SUPPORTED via ENG-QUICK (§8/§22/§53: ENTER_VALUE covers it) — not ENGINE_GAP, not a QC-WEB-ENGINE-NUMERIC-INPUT registration", () => {
    const registry = new EngineRegistry();
    for (const entry of activeP0Entries()) registry.register(entry);
    const templateRegistry = new TemplateRegistry();

    const spec = balanceActivitySpec({ activityId: "demo-numeric-only", requiredCapabilities: ["NUMERIC_INPUT"] });
    const { result } = evaluateSupport(spec, registry, templateRegistry, EVAL_OPTIONS);
    expect(result.outcome).toBe("SUPPORTED");
    expect(result.selectedEngine).toBe("ENG-QUICK");
  });

  it("a capability P0 genuinely does not cover (GRAPH_PLOT) still produces a real ENGINE_GAP with a report", () => {
    const registry = new EngineRegistry();
    for (const entry of activeP0Entries()) registry.register(entry);
    const templateRegistry = new TemplateRegistry();

    const spec = balanceActivitySpec({ activityId: "demo-graph-only", requiredCapabilities: ["GRAPH_PLOT"] });
    const { result, engineGapReport } = evaluateSupport(spec, registry, templateRegistry, EVAL_OPTIONS);
    expect(result.outcome).toBe("ENGINE_GAP");
    expect(engineGapReport?.requiredCapabilities).toEqual(["GRAPH_PLOT"]);
  });
});

describe("R3C.1 §41 — unknown runtimeAdapterId dispatch (Engine Runtime Registry, not Support Evaluator)", () => {
  it("QC-WEB-ENGINE-NUMERIC-INPUT and QC-WEB-ENGINE-GUIDED-PRACTICE are not registered in the runtime dispatcher", () => {
    const runtimeRegistry = createDefaultEngineRuntimeRegistry();
    expect(runtimeRegistry.getByRuntimeAdapterId("QC-WEB-ENGINE-NUMERIC-INPUT")).toBeUndefined();
    expect(runtimeRegistry.getByRuntimeAdapterId("QC-WEB-ENGINE-GUIDED-PRACTICE")).toBeUndefined();
    expect(runtimeRegistry.list()).toHaveLength(3);
  });
});
