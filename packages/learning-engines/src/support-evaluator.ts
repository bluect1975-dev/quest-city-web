/**
 * Support Evaluator (02_36 §8, §16, support-evaluation.schema.json).
 * Deterministic, in-memory, no network/AI calls (R3B §49) — every input is
 * explicit, including the evaluation timestamp, so a given input always
 * produces the same output. Produces only the four canonical outcomes; the
 * Pedagogical Fidelity Rule (02_36 §8.1) is enforced literally: any
 * declared loss on pedagogicalObjective/reasoningType/interactionModel/
 * evidenceModel/evaluationModel forces ENGINE_GAP, never a downgraded
 * SUPPORTED* outcome.
 *
 * Engine selection order (02_36 §16): required capabilities -> existing
 * ACTIVE engines (exact match) -> compatible templates -> limitations ->
 * ENGINE_GAP. A caller must never skip straight to proposing a new engine.
 */
import { buildEngineGapReport } from "./engine-gap-report";
import type { EngineRegistry } from "./registry";
import type { TemplateRegistry } from "./template-registry";
import type {
  ActivitySpecification,
  EngineGapReport,
  FidelityAssessment,
  SupportEvaluationResult,
} from "./types";

export interface EvaluateSupportOptions {
  fidelityAssessments?: FidelityAssessment[];
  capabilityContractVersion: string;
  registryVersion: string;
  evaluationVersion: string;
  reportVersion: string;
  /** ISO-8601 timestamp, supplied by the caller for determinism — this module never reads the clock. */
  now: string;
}

export interface EvaluateSupportResult {
  result: SupportEvaluationResult;
  engineGapReport?: EngineGapReport;
}

function findAssessment(
  assessments: FidelityAssessment[],
  canonicalEngineId: string,
  templateId?: string,
): FidelityAssessment | undefined {
  return assessments.find(
    (a) => a.canonicalEngineId === canonicalEngineId && a.templateId === templateId,
  );
}

function preservesAllDimensions(assessment: FidelityAssessment): boolean {
  return (
    assessment.preservesPedagogicalObjective &&
    assessment.preservesReasoningType &&
    assessment.preservesInteractionModel &&
    assessment.preservesEvidenceModel &&
    assessment.preservesEvaluationModel
  );
}

function violatedDimensions(assessment: FidelityAssessment): string[] {
  const violated: string[] = [];
  if (!assessment.preservesPedagogicalObjective) violated.push("pedagogicalObjective");
  if (!assessment.preservesReasoningType) violated.push("reasoningType");
  if (!assessment.preservesInteractionModel) violated.push("interactionModel");
  if (!assessment.preservesEvidenceModel) violated.push("evidenceModel");
  if (!assessment.preservesEvaluationModel) violated.push("evaluationModel");
  return violated;
}

export function evaluateSupport(
  spec: ActivitySpecification,
  registry: EngineRegistry,
  templateRegistry: TemplateRegistry,
  options: EvaluateSupportOptions,
): EvaluateSupportResult {
  const assessments = options.fidelityAssessments ?? [];
  const evaluatedEngines = registry.list().map((e) => e.canonicalEngineId);
  const evaluatedTemplates = templateRegistry.list().map((t) => t.templateId);
  const incompatibilityReasons: string[] = [];

  const base = {
    activityId: spec.activityId,
    evaluatedEngines,
    evaluatedTemplates,
    capabilityContractVersion: options.capabilityContractVersion,
    registryVersion: options.registryVersion,
    evaluationTimestamp: options.now,
    evaluationVersion: options.evaluationVersion,
  };

  if (evaluatedEngines.length === 0) {
    incompatibilityReasons.push("Engine Registry is empty — no canonical engine registered.");
  }

  // 1. Exact match: an ACTIVE engine's declared capabilities fully cover the requirement.
  const preferredOrder = spec.preferredCanonicalEngineIds ?? [];
  const exactCandidates = registry
    .findByCapabilities(spec.requiredCapabilities)
    .sort((a, b) => {
      const rank = (id: string) => {
        const i = preferredOrder.indexOf(id);
        return i === -1 ? preferredOrder.length : i;
      };
      return rank(a.canonicalEngineId) - rank(b.canonicalEngineId);
    });

  for (const engine of exactCandidates) {
    const assessment = findAssessment(assessments, engine.canonicalEngineId);
    if (assessment && !preservesAllDimensions(assessment)) {
      incompatibilityReasons.push(
        `${engine.canonicalEngineId}: fidelity assessment declares loss on ${violatedDimensions(assessment).join(", ")}.`,
      );
      continue;
    }
    return {
      result: {
        ...base,
        outcome: "SUPPORTED",
        selectedEngine: engine.canonicalEngineId,
        publicationEligibility: "ELIGIBLE",
      },
    };
  }

  // 2. Template match: a template layered on an ACTIVE engine fully covers the requirement.
  for (const template of templateRegistry.findByCapabilities(spec.requiredCapabilities)) {
    const engine = registry.get(template.canonicalEngineId);
    if (!engine || engine.lifecycleStatus !== "ACTIVE") {
      continue;
    }
    const assessment = findAssessment(assessments, template.canonicalEngineId, template.templateId);
    if (assessment && !preservesAllDimensions(assessment)) {
      incompatibilityReasons.push(
        `${template.templateId} (${template.canonicalEngineId}): fidelity assessment declares loss on ${violatedDimensions(assessment).join(", ")}.`,
      );
      continue;
    }
    return {
      result: {
        ...base,
        outcome: "SUPPORTED_WITH_TEMPLATE",
        selectedEngine: template.canonicalEngineId,
        selectedTemplate: template.templateId,
        publicationEligibility: "ELIGIBLE",
      },
    };
  }

  // 3. Limitations: an explicit, non-substantial-limitations assessment against an ACTIVE engine.
  for (const assessment of assessments) {
    if (!assessment.limitations || assessment.limitations.length === 0) {
      continue;
    }
    const engine = registry.get(assessment.canonicalEngineId);
    if (!engine || engine.lifecycleStatus !== "ACTIVE") {
      continue;
    }
    if (!preservesAllDimensions(assessment)) {
      incompatibilityReasons.push(
        `${assessment.canonicalEngineId}: fidelity assessment declares loss on ${violatedDimensions(assessment).join(", ")}, cannot be admitted via limitations.`,
      );
      continue;
    }
    if (assessment.limitations.some((l) => l.pedagogicallySubstantial)) {
      // Schema-level impossible (the field is typed `false`), kept as an explicit guard, not dead code removal.
      continue;
    }
    return {
      result: {
        ...base,
        outcome: "SUPPORTED_WITH_LIMITATIONS",
        selectedEngine: assessment.canonicalEngineId,
        limitations: assessment.limitations,
        publicationEligibility: "ELIGIBLE",
      },
    };
  }

  // 4. ENGINE_GAP — nothing above admitted the activity without a substantial pedagogical loss.
  if (incompatibilityReasons.length === 0) {
    incompatibilityReasons.push(
      `No ACTIVE engine or template declares the required capabilities: ${spec.requiredCapabilities.join(", ")}.`,
    );
  }
  const engineGapReport = buildEngineGapReport({
    spec,
    evaluatedEngines,
    evaluatedTemplates,
    incompatibilityReasons,
    pedagogicalImpact:
      "No existing engine/template can serve this activity without a substantial pedagogical loss on at least one of pedagogicalObjective, reasoningType, interactionModel, evidenceModel or evaluationModel, or the Engine Registry does not yet declare a matching capability set.",
    recommendedResolution: evaluatedEngines.length === 0 ? "NEW_ENGINE" : "NO_RESOLUTION_AVAILABLE",
    reportVersion: options.reportVersion,
    generatedAt: options.now,
  });

  return {
    result: {
      ...base,
      outcome: "ENGINE_GAP",
      engineGapReportRef: `${spec.activityId}/engine-gap-report`,
      publicationEligibility: "NOT_PUBLISHABLE",
    },
    engineGapReport,
  };
}
