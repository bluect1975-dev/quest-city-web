import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../lib/env";
import { requireStaffIdentity } from "../../lib/staff-request-context";
import { staffErrorResponse } from "../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../lib/staff-csrf-guard";
import {
  parseStaffJsonBody,
  requireIdempotencyKey,
  validateNonEmptyString,
  validateOptionalEnumQueryParam,
  validateOptionalString,
  validateStaffPaginationQuery,
} from "../../lib/staff-validation";
import { getLearningPathPolicyService } from "../../lib/staff-identity-context";

const SCOPE_VALUES = ["PLATFORM", "SCHOOL", "CLASS", "STUDENT"] as const;
const RESOURCE_TYPE_VALUES = ["SUBJECT", "TRACK", "YEAR", "MODULE", "UNIT", "UNIT_ELEMENT"] as const;
const STATE_VALUES = ["ENABLED", "DISABLED", "DISABLED_AND_WAIVED", "DISABLED_WITH_ALTERNATIVE", "UNAVAILABLE_FOR_USE"] as const;
const REASON_CATEGORY_VALUES = [
  "PEDAGOGICAL",
  "ACCESSIBILITY",
  "TEMPORARY_SUPPORT",
  "ALTERNATIVE_ACTIVITY",
  "CURRICULUM_SCHEDULING",
  "SCHOOL_POLICY",
  "TEACHER_DECISION",
  "OTHER_STRUCTURED",
] as const;

function toResponseData(policy: {
  publicId: string;
  tenantId: string;
  scope: string;
  scopeClassId: string | null;
  scopeStudentProfileId: string | null;
  resourceType: string;
  resourceRef: string;
  state: string;
  reasonCategory: string;
  reasonNotes: string | null;
  alternativeContentRef: string | null;
  deploymentYear: string | null;
  createdByStaffAccountId: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  shadowed?: boolean;
}) {
  return {
    id: policy.publicId,
    tenantId: policy.tenantId,
    scope: policy.scope,
    scopeRef: policy.scopeClassId ?? policy.scopeStudentProfileId ?? undefined,
    resourceType: policy.resourceType,
    resourceRef: policy.resourceRef,
    state: policy.state,
    reasonCategory: policy.reasonCategory,
    reasonNotes: policy.reasonNotes,
    alternativeContentRef: policy.alternativeContentRef,
    deploymentYear: policy.deploymentYear,
    createdByStaffAccountId: policy.createdByStaffAccountId,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
    version: policy.version,
    shadowed: policy.shadowed ?? false,
  };
}

/** `POST /learning-path-policies` (OpenAPI v1.15.0 createOrUpdateLearningPathPolicy, 02_41 §10/§42). */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const body = await parseStaffJsonBody(request);

    const scope = validateOptionalEnumQueryParam(typeof body.scope === "string" ? body.scope : null, SCOPE_VALUES, "scope");
    if (!scope) throw new StaffIdentityError("VALIDATION_ERROR", "scope is required.");
    const resourceType = validateOptionalEnumQueryParam(typeof body.resourceType === "string" ? body.resourceType : null, RESOURCE_TYPE_VALUES, "resourceType");
    if (!resourceType) throw new StaffIdentityError("VALIDATION_ERROR", "resourceType is required.");
    const resourceRef = validateNonEmptyString(body.resourceRef, "resourceRef");
    const state = validateOptionalEnumQueryParam(typeof body.state === "string" ? body.state : null, STATE_VALUES, "state");
    if (!state) throw new StaffIdentityError("VALIDATION_ERROR", "state is required.");
    const reasonCategory = validateOptionalEnumQueryParam(typeof body.reasonCategory === "string" ? body.reasonCategory : null, REASON_CATEGORY_VALUES, "reasonCategory");
    if (!reasonCategory) throw new StaffIdentityError("VALIDATION_ERROR", "reasonCategory is required.");
    const scopeRef = validateOptionalString(body.scopeRef, "scopeRef", 200);
    const reasonNotes = validateOptionalString(body.reasonNotes, "reasonNotes", 2000);
    const alternativeContentRef = validateOptionalString(body.alternativeContentRef, "alternativeContentRef", 500);
    const deploymentYear = validateOptionalString(body.deploymentYear, "deploymentYear", 20);

    const created = await getLearningPathPolicyService().create({
      identity,
      scope,
      scopeClassId: scope === "CLASS" ? scopeRef : undefined,
      scopeStudentPublicId: scope === "STUDENT" ? scopeRef : undefined,
      resourceType,
      resourceRef,
      state,
      reasonCategory,
      reasonNotes: reasonNotes ?? null,
      alternativeContentRef: alternativeContentRef ?? null,
      deploymentYear: deploymentYear ?? null,
      idempotencyKey,
    });

    return NextResponse.json(
      { data: toResponseData({ ...created, shadowed: false }), meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}

/** `GET /learning-path-policies` (OpenAPI v1.15.0 listLearningPathPolicies). */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const url = new URL(request.url);
    const pagination = validateStaffPaginationQuery(url);
    const scope = validateOptionalEnumQueryParam(url.searchParams.get("scope"), SCOPE_VALUES, "scope");
    const resourceType = validateOptionalEnumQueryParam(url.searchParams.get("resourceType"), RESOURCE_TYPE_VALUES, "resourceType");
    const scopeRef = url.searchParams.get("scopeRef") ?? undefined;
    const resourceRef = url.searchParams.get("resourceRef") ?? undefined;

    const items = await getLearningPathPolicyService().list(identity, { scope, scopeRef, resourceType, resourceRef }, pagination);

    return NextResponse.json(
      { data: items.map(toResponseData), meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
