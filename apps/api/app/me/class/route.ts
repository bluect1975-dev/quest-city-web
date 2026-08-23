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
 * `teachers` returns each assigned teacher's real `displayName` (Pilot
 * Product Experience Residual Closure, Tranche H1, closes
 * `NEW-GAP-STAFF-DISPLAY-NAME-01`) — never email or any internal id.
 * `displayName` is `null` for a teacher who has never set one via
 * `PATCH /me/staff-profile` (self-service, no fabricated/default name);
 * the client renders the documented fallback label, never this route.
 * `StaffClassAssignmentRepository.findDisplayNamesByClass` scopes every
 * join hop by `tenant_id`, so a cross-tenant row can never leak through a
 * shared `staff_account_id`.
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

    const [enrollment, schoolClass, tenant, teachers] = await Promise.all([
      getSchoolEnrollmentRepository().findById(identity.enrollmentId, identity.tenantId),
      getSchoolClassRepository().findById(identity.classId, identity.tenantId),
      getTenantRepository().findById(identity.tenantId),
      getStaffClassAssignmentRepository().findDisplayNamesByClass(identity.classId, identity.tenantId),
    ]);
    if (!enrollment || !schoolClass || !tenant) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    const data = {
      classPublicId: schoolClass.publicId,
      className: schoolClass.name,
      schoolName: tenant.name,
      enrollmentStatus: enrollment.status === "ACTIVE" ? ("ACTIVE" as const) : ("SUSPENDED" as const),
      teachers: teachers.map((teacher) => ({ displayName: teacher.displayName })),
    };

    return NextResponse.json(
      { data, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return identityErrorResponse(error, correlationId);
  }
}
