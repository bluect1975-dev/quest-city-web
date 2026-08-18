import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { validateOptionalEnumQueryParam } from "./staff-validation";

const RESOURCE_TYPE_VALUES = ["SUBJECT", "TRACK", "YEAR", "MODULE", "UNIT", "UNIT_ELEMENT"] as const;
const TARGET_STATE_VALUES = ["ENABLED", "DISABLED", "DISABLED_AND_WAIVED", "DISABLED_WITH_ALTERNATIVE"] as const;

export interface ParsedTargetLearningPath {
  resourceType: (typeof RESOURCE_TYPE_VALUES)[number];
  resourceRef: string;
  requestedState: (typeof TARGET_STATE_VALUES)[number];
  requestedAlternativeContentRef?: string | undefined;
}

/**
 * `TargetLearningPath` (OpenAPI v1.15.0, 02_41 §23) -- shared by both
 * `POST /asacom/facilitation-proposals` and `POST
 * /support-teacher/facilitation-proposals`. Returns `undefined` when the
 * request body carries no `targetLearningPath` object at all (valid for
 * FACILITATION/DIFFICULTY); the service layer is what enforces "required
 * exactly when proposalType=LEARNING_PATH_ADJUSTMENT".
 */
export function parseTargetLearningPath(body: Record<string, unknown>): ParsedTargetLearningPath | undefined {
  const raw = body.targetLearningPath;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new StaffIdentityError("VALIDATION_ERROR", "targetLearningPath must be a JSON object.");
  }
  const value = raw as Record<string, unknown>;
  const resourceType = validateOptionalEnumQueryParam(typeof value.resourceType === "string" ? value.resourceType : null, RESOURCE_TYPE_VALUES, "targetLearningPath.resourceType");
  if (!resourceType) {
    throw new StaffIdentityError("VALIDATION_ERROR", "targetLearningPath.resourceType is required.");
  }
  if (typeof value.resourceRef !== "string" || value.resourceRef.length === 0) {
    throw new StaffIdentityError("VALIDATION_ERROR", "targetLearningPath.resourceRef must be a non-empty string.");
  }
  const requestedState = validateOptionalEnumQueryParam(typeof value.requestedState === "string" ? value.requestedState : null, TARGET_STATE_VALUES, "targetLearningPath.requestedState");
  if (!requestedState) {
    throw new StaffIdentityError("VALIDATION_ERROR", "targetLearningPath.requestedState is required.");
  }
  const requestedAlternativeContentRef = typeof value.requestedAlternativeContentRef === "string" ? value.requestedAlternativeContentRef : undefined;
  return { resourceType, resourceRef: value.resourceRef, requestedState, requestedAlternativeContentRef };
}

/** Projects a stored proposal's flat `target*` columns back into the OpenAPI `TargetLearningPath` response shape, or `undefined` if unset. */
export function toTargetLearningPathResponse(proposal: {
  targetResourceType: string | null;
  targetResourceRef: string | null;
  targetRequestedState: string | null;
  targetRequestedAlternativeContentRef: string | null;
}) {
  if (!proposal.targetResourceType || !proposal.targetResourceRef || !proposal.targetRequestedState) {
    return undefined;
  }
  return {
    resourceType: proposal.targetResourceType,
    resourceRef: proposal.targetResourceRef,
    requestedState: proposal.targetRequestedState,
    requestedAlternativeContentRef: proposal.targetRequestedAlternativeContentRef ?? undefined,
  };
}
