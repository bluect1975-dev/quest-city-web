import { NextResponse } from "next/server";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { getSupportAssignmentService } from "../../../lib/staff-identity-context";

/**
 * `GET /me/asacom-assigned-students` (02_26 v1.16 §37.3) -- also the
 * SUPPORT_TEACHER per-student "My assigned students" surface (02_39
 * §21bis/§22): the underlying query is identical, generalized rather
 * than duplicated (support_student_assignment applies to both roles).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);

    const assignments = await getSupportAssignmentService().listMine(identity);
    // listMine() already resolves studentProfileId to the client-facing
    // studentPublicId (never the raw internal UUID) -- no further lookup needed here.
    const data = assignments.map((assignment) => ({
      supportStudentAssignmentId: assignment.publicId,
      studentPublicId: assignment.studentProfileId,
      classId: assignment.classId,
      status: assignment.status,
      startsAt: assignment.startsAt.toISOString(),
    }));

    return NextResponse.json({ data, meta: { request_id: correlationId ?? undefined, api_version: "v1" } }, { status: 200 });
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
