import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { getSessionService, getSchoolEnrollmentRepository, getSchoolClassRepository, getTenantRepository } from "../../../lib/identity-context";
import { getStaffClassAssignmentRepository } from "../../../lib/staff-identity-context";
import { identityErrorResponse } from "../../../lib/identity-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /me/class` (Pilot Product Experience Remediation G2 — "La mia
 * classe" student surface, closing `UX-CLASS-ASSIGNMENT-LIST-01`'s sibling
 * gap: a student had no way to see their own class's name or school, only
 * the opaque `classPublicId` from `GET /me/student-context`).
 *
 * Scope is resolved ENTIRELY server-side from the student session cookie,
 * same anti-enumeration discipline as `GET /me/assignments` — no
 * `classId`/`tenantId` accepted from the client.
 *
 * Deliberately returns only `assignedTeacherCount`, never teacher names or
 * emails: `staff_account` has no display-name field (only `email`, a
 * credential, not a presentable identity) — see
 * `NEW-GAP-STAFF-DISPLAY-NAME-01` in the mission report. Showing the email
 * would violate the mission's own "no technical/internal identity leaked
 * to students" rule (§13); showing nothing at all would silently regress
 * from "does the student have a class with a teacher" to no information.
 * The count is real, non-fabricated data that satisfies neither more nor
 * less than what the schema actually supports today.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);

    const [enrollment, schoolClass, tenant, teacherAssignments] = await Promise.all([
      getSchoolEnrollmentRepository().findById(identity.enrollmentId, identity.tenantId),
      getSchoolClassRepository().findById(identity.classId, identity.tenantId),
      getTenantRepository().findById(identity.tenantId),
      getStaffClassAssignmentRepository().findByClass(identity.classId, identity.tenantId),
    ]);
    if (!enrollment || !schoolClass || !tenant) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    const data = {
      classPublicId: schoolClass.publicId,
      className: schoolClass.name,
      schoolName: tenant.name,
      enrollmentStatus: enrollment.status === "ACTIVE" ? ("ACTIVE" as const) : ("SUSPENDED" as const),
      assignedTeacherCount: teacherAssignments.length,
    };

    return NextResponse.json(
      { data, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return identityErrorResponse(error, correlationId);
  }
}
