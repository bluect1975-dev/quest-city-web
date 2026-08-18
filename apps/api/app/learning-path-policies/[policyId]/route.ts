import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { requireIdempotencyKey } from "../../../lib/staff-validation";
import { getLearningPathPolicyService } from "../../../lib/staff-identity-context";

/** `DELETE /learning-path-policies/{policyId}` (OpenAPI v1.15.0 deleteLearningPathPolicy) -- reverts to INHERIT (02_41 §9). */
export async function DELETE(request: Request, { params }: { params: Promise<{ policyId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const { policyId } = await params;
    const idempotencyKey = requireIdempotencyKey(request);

    await getLearningPathPolicyService().delete(identity, policyId, idempotencyKey);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
