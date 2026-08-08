/**
 * Engine Gap Report producer (02_36 §10, engine-gap-report.schema.json).
 * ENGINE_GAP is a design-time compatibility result, never an HTTP error,
 * attemptState or completionStatus (02_36 §10, §13). This module only
 * builds the structured report; it does not decide the outcome — see
 * support-evaluator.ts.
 */
import type {
  ActivitySpecification,
  AxisAValue,
  EngineGapReport,
  RecommendedResolution,
} from "./types";

export interface BuildEngineGapReportInput {
  spec: ActivitySpecification;
  evaluatedEngines: string[];
  evaluatedTemplates: string[];
  incompatibilityReasons: string[];
  pedagogicalImpact: string;
  recommendedResolution: RecommendedResolution;
  proposedEngineId?: string;
  proposedCapabilities?: AxisAValue[];
  reportVersion: string;
  generatedAt: string;
}

export function buildEngineGapReport(input: BuildEngineGapReportInput): EngineGapReport {
  if (input.incompatibilityReasons.length === 0) {
    throw new Error("EngineGapReport requires at least one incompatibilityReason");
  }
  return {
    activityId: input.spec.activityId,
    ...(input.spec.subject !== undefined ? { subject: input.spec.subject } : {}),
    ...(input.spec.curriculumRef !== undefined ? { curriculumRef: input.spec.curriculumRef } : {}),
    ...(input.spec.moduleRef !== undefined ? { moduleRef: input.spec.moduleRef } : {}),
    ...(input.spec.unitRef !== undefined ? { unitRef: input.spec.unitRef } : {}),
    pedagogicalObjective: input.spec.pedagogicalObjective,
    requiredCapabilities: input.spec.requiredCapabilities,
    evaluatedEngines: input.evaluatedEngines,
    evaluatedTemplates: input.evaluatedTemplates,
    incompatibilityReasons: input.incompatibilityReasons,
    pedagogicalImpact: input.pedagogicalImpact,
    recommendedResolution: input.recommendedResolution,
    ...(input.proposedEngineId !== undefined ? { proposedEngineId: input.proposedEngineId } : {}),
    ...(input.proposedCapabilities !== undefined
      ? { proposedCapabilities: input.proposedCapabilities }
      : {}),
    reportVersion: input.reportVersion,
    generatedAt: input.generatedAt,
  };
}
