import { NextResponse } from "next/server";
import { StaffIdentityError, assertClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../../lib/staff-csrf-guard";
import { requireIdempotencyKey } from "../../../../../lib/staff-validation";
import { getSchoolEnrollmentRepository, getRosterManagementService } from "../../../../../lib/staff-identity-context";

/** `GET /classes/{classId}/students/{studentProfileId}` (02_35 §5). Read-only. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ classId: string; studentProfileId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { classId, studentProfileId } = await params;
    assertClassInScope(identity, classId);

    const enrollment = await getSchoolEnrollmentRepository().findByClassAndStudent(classId, studentProfileId, identity.tenantId);
    if (!enrollment) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }

    return NextResponse.json(
      {
        data: {
          studentProfileId: enrollment.studentProfileId,
          accessAlias: enrollment.accessAlias,
          enrollmentStatus: enrollment.status,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}

/** `DELETE /classes/{classId}/students/{studentProfileId}` (02_35 v1.2 §11bis.7). roster.manage. Always a soft transition to LEFT — never deletes student_profile/learning_attempt/mastery_state. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ classId: string; studentProfileId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { classId, studentProfileId } = await params;

    const result = await getRosterManagementService().removeStudent({ identity, classId, studentProfileId, idempotencyKey });

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
