import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../lib/env";
import { requireStaffIdentity } from "../../lib/staff-request-context";
import { staffErrorResponse } from "../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../lib/staff-csrf-guard";
import { parseStaffJsonBody, requireIdempotencyKey, validateNonEmptyString, validateOptionalEnumQueryParam } from "../../lib/staff-validation";
import { getLearningPathAlternativeService } from "../../lib/staff-identity-context";

const RESOURCE_TYPE_VALUES = ["SUBJECT", "TRACK", "YEAR", "MODULE", "UNIT", "UNIT_ELEMENT"] as const;

/** `POST /learning-path-alternatives` (OpenAPI v1.15.0 createLearningPathAlternative, 02_41 §27/§34). Capability `learning_path.alternative.assign`. */
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

    const originalResourceType = validateOptionalEnumQueryParam(
      typeof body.originalResourceType === "string" ? body.originalResourceType : null,
      RESOURCE_TYPE_VALUES,
      "originalResourceType",
    );
    if (!originalResourceType) throw new StaffIdentityError("VALIDATION_ERROR", "originalResourceType is required.");
    const originalResourceRef = validateNonEmptyString(body.originalResourceRef, "originalResourceRef");
    const alternativeContentRef = validateNonEmptyString(body.alternativeContentRef, "alternativeContentRef");

    const created = await getLearningPathAlternativeService().create({
      identity,
      originalResourceType,
      originalResourceRef,
      alternativeContentRef,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        data: {
          id: created.publicId,
          tenantId: created.tenantId,
          originalResourceType: created.originalResourceType,
          originalResourceRef: created.originalResourceRef,
          alternativeContentRef: created.alternativeContentRef,
          createdByStaffAccountId: created.createdByStaffAccountId,
          createdAt: created.createdAt.toISOString(),
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
