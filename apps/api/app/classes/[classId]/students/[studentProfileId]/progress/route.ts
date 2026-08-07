import { NextResponse } from "next/server";
import { StaffIdentityError, assertClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../../lib/staff-error-response";
import { getSchoolEnrollmentRepository, getStudentProfileRepository } from "../../../../../../lib/staff-identity-context";
import { getLearningAttemptRepository } from "../../../../../../lib/attempts-context";

/** `GET /classes/{classId}/students/{studentProfileId}/progress` (02_35 §6), staff-scoped equivalent of `GET /progress/summary`. */
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
    const profile = await getStudentProfileRepository().findById(studentProfileId, identity.tenantId);
    if (!profile) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }

    const aggregate = await getLearningAttemptRepository().summarizeForStudent(identity.tenantId, studentProfileId, {});

    return NextResponse.json(
      {
        data: { studentPublicId: profile.studentPublicId, aggregate },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
