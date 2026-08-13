import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateOptionalFreeText } from "../../../../lib/staff-validation";
import { getConvergenceApprovalService } from "../../../../lib/staff-identity-context";
import { toConvergenceRequestSummary } from "../../../../lib/convergence-serialization";

/**
 * `POST /convergence-requests/{id}/reject` (02_38 v1.4 §10.3, 02_26
 * v1.14 §36.6). Unified teacher/school rejection endpoint -- which side
 * rejected is resolved server-side from the caller's tenant.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const { id } = await params;
    const body = await parseStaffJsonBody(request);
    const rejectionReason = validateOptionalFreeText(body.rejectionReason);

    const result = await getConvergenceApprovalService().reject(identity, id, rejectionReason);

    return NextResponse.json(
      {
        data: toConvergenceRequestSummary(result),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
