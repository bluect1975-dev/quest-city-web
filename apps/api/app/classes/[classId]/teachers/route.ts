import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, requireIdempotencyKey, validateNonEmptyString } from "../../../../lib/staff-validation";
import { getSchoolClassManagementService } from "../../../../lib/staff-identity-context";

/** `POST /classes/{classId}/teachers` (02_35 v1.2 §11bis.6). class.teacher.assign. Creates a staff_class_assignment row — the target membership must already be role=TEACHER, status=ACTIVE. */
export async function POST(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { classId } = await params;
    const body = await parseStaffJsonBody(request);
    const staffTenantMembershipId = validateNonEmptyString(body.staffTenantMembershipId, "staffTenantMembershipId");

    const result = await getSchoolClassManagementService().assignTeacher({
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
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
