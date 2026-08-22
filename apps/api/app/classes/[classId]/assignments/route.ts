import { NextResponse } from "next/server";
import { assertClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { getAssignmentRepository } from "../../../../lib/attempts-context";

/**
 * `GET /classes/{classId}/assignments` (Pilot Product Experience
 * Remediation Tranche G8, `UX-CLASS-ASSIGNMENT-LIST-01`) — closes the gap
 * where a teacher who assigned content had no way to see it again short of
 * remembering it themselves. Read-only, same class-scope authorization as
 * `GET /classes/{classId}` (`assertClassInScope`). Never exposes
 * `contentBundleId`/internal ids to the client — title/status/origin/date
 * only (mission §32).
 */
export async function GET(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { classId } = await params;
    assertClassInScope(identity, classId);

    const assignments = await getAssignmentRepository().findByClassIdForStaff(classId, identity.tenantId);

    const data = assignments.map((assignment) => ({
      assignmentId: assignment.publicId,
      title: assignment.title,
      status: assignment.status,
      originType: assignment.originType,
      createdAt: assignment.createdAt.toISOString(),
      dueAt: assignment.dueAt?.toISOString() ?? null,
    }));

    return NextResponse.json(
      { data, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
