import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, requireIdempotencyKey, validateMembershipStatusAction } from "../../../../lib/staff-validation";
import { getStaffMembershipService } from "../../../../lib/staff-identity-context";

/** `PATCH /staff/members/{staffTenantMembershipId}` (02_35 v1.2 §11bis.2). SUSPEND/REACTIVATE (staff.membership.suspend) or REVOKE (staff.membership.revoke). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ staffTenantMembershipId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { staffTenantMembershipId } = await params;
    const body = await parseStaffJsonBody(request);
    const action = validateMembershipStatusAction(body.action);

    const result = await getStaffMembershipService().updateStatus({
      identity,
      staffTenantMembershipId,
      action,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        data: result,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
