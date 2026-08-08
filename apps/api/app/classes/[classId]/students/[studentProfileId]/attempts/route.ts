import { NextResponse } from "next/server";
import { StaffIdentityError, assertClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../../lib/staff-error-response";
import { getSchoolEnrollmentRepository } from "../../../../../../lib/staff-identity-context";
import { getLearningAttemptRepository } from "../../../../../../lib/attempts-context";

/**
 * `GET /classes/{classId}/students/{studentProfileId}/attempts` (02_35
 * §6). `runtimeChannel`/`reconciliationStatus` (completionStatus) are
 * diagnostic provenance only (07_15_01 §6.2) — never a delivery signal.
 */
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

    const attempts = await getLearningAttemptRepository().findByStudentProfile(identity.tenantId, studentProfileId);

    return NextResponse.json(
      {
        data: attempts.map((a) => ({
          attemptId: a.id,
          attemptState: a.attemptState,
          completionStatus: a.completionStatus,
          runtimeChannel: a.runtimeChannel,
          startedAt: a.startedAt.toISOString(),
          completedAt: a.completedAt ? a.completedAt.toISOString() : null,
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
