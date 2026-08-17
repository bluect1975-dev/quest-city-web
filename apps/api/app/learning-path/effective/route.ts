import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { validateOptionalEnumQueryParam } from "../../../lib/staff-validation";
import { getLearningPathPolicyService } from "../../../lib/staff-identity-context";

const RESOURCE_TYPE_VALUES = ["SUBJECT", "TRACK", "YEAR", "MODULE", "UNIT", "UNIT_ELEMENT"] as const;

function toResponseData(resolution: {
  resourceType: string;
  resourceRef: string;
  effectiveAvailability: string;
  effectiveRequirement: string;
  sourceScope: string;
  sourcePolicyId: string | null;
  alternativeContentRef: string | null;
  waiverState: boolean;
  reasonCategory: string | null;
}) {
  return {
    resourceType: resolution.resourceType,
    resourceRef: resolution.resourceRef,
    effectiveAvailability: resolution.effectiveAvailability,
    effectiveRequirement: resolution.effectiveRequirement,
    sourceScope: resolution.sourceScope,
    sourcePolicyId: resolution.sourcePolicyId ?? undefined,
    alternativeContentVersion: resolution.alternativeContentRef ?? undefined,
    waiverState: resolution.waiverState,
    reasonCategory: resolution.reasonCategory ?? undefined,
  };
}

/**
 * `GET /learning-path/effective` (OpenAPI v1.15.0
 * getEffectiveLearningPathAvailability, 02_41 §31/§51) -- server-
 * authoritative resolution. Called before every content launch, not only
 * by preview UI (mission §30-32: a direct URL/known public_id must not
 * bypass GLPC).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const url = new URL(request.url);
    const resourceType = validateOptionalEnumQueryParam(url.searchParams.get("resourceType"), RESOURCE_TYPE_VALUES, "resourceType");
    if (!resourceType) throw new StaffIdentityError("VALIDATION_ERROR", "resourceType is required.");
    const resourceRef = url.searchParams.get("resourceRef");
    if (!resourceRef) throw new StaffIdentityError("VALIDATION_ERROR", "resourceRef is required.");
    const classId = url.searchParams.get("classId") ?? undefined;
    const studentPublicId = url.searchParams.get("studentPublicId") ?? undefined;

    const resolution = await getLearningPathPolicyService().resolveEffective(identity, { resourceType, resourceRef, classId, studentPublicId });

    return NextResponse.json(
      { data: toResponseData(resolution), meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
