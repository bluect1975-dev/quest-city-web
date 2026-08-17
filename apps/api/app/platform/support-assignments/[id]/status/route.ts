import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateOptionalEnumQueryParam } from "../../../../../lib/staff-validation";
import { getSupportAssignmentService } from "../../../../../lib/staff-identity-context";

const TARGET_STATUS_VALUES = ["ENDED", "REVOKED"] as const;

/** `PATCH /platform/support-assignments/{id}/status` (02_26 v1.16 §37.2). ACTIVE -> ENDED or ACTIVE -> REVOKED. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const { id } = await params;
    const body = await parseStaffJsonBody(request);
    const targetStatus = validateOptionalEnumQueryParam(
      typeof body.targetStatus === "string" ? body.targetStatus : null,
      TARGET_STATUS_VALUES,
      "targetStatus",
    );
    if (!targetStatus) {
      throw new StaffIdentityError("VALIDATION_ERROR", "targetStatus is required");
    }

    const updated = await getSupportAssignmentService().transitionStatus({ identity, id, targetStatus });

    return NextResponse.json(
      {
        data: {
          id: updated.publicId,
          status: updated.status,
          endsAt: updated.endsAt ? updated.endsAt.toISOString() : null,
          revokedAt: updated.revokedAt ? updated.revokedAt.toISOString() : null,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
