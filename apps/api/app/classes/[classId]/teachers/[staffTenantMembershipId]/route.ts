import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../../lib/staff-csrf-guard";
import { requireIdempotencyKey } from "../../../../../lib/staff-validation";
import { getSchoolClassManagementService } from "../../../../../lib/staff-identity-context";

/** `DELETE /classes/{classId}/teachers/{staffTenantMembershipId}` (02_35 v1.2 §11bis.6). class.teacher.assign. Hard delete of the staff_class_assignment row — an access-scope grant, not a historical record. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ classId: string; staffTenantMembershipId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { classId, staffTenantMembershipId } = await params;

    const result = await getSchoolClassManagementService().unassignTeacher({
      identity,
      classId,
      staffTenantMembershipId,
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
