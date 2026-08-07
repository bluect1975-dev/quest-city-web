import { NextResponse } from "next/server";
import { assertClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { getSchoolEnrollmentRepository } from "../../../../lib/staff-identity-context";

/**
 * `GET /classes/{classId}/students` (02_35 §5). Read-only roster — no
 * student access credentials (PIN hash, class access code) are ever
 * projected into the response.
 */
export async function GET(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { classId } = await params;
    assertClassInScope(identity, classId);

    const enrollments = await getSchoolEnrollmentRepository().findByClass(classId, identity.tenantId);

    return NextResponse.json(
      {
        data: enrollments.map((e) => ({
          studentProfileId: e.studentProfileId,
          accessAlias: e.accessAlias,
          enrollmentStatus: e.status,
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
