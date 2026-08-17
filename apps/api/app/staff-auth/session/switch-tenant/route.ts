import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateNonEmptyString } from "../../../../lib/staff-validation";
import { buildStaffSessionSetCookie } from "../../../../lib/staff-session-cookie";
import { getTenantContextService } from "../../../../lib/staff-identity-context";

/**
 * `POST /staff-auth/session/switch-tenant` (02_35 v1.5 §11quater.5,
 * 02_26 v1.14 §36.10, extended by v1.7 §11sexies.7 / v1.16 §37bis). Full
 * session rotation onto a different one of the caller's own ACTIVE
 * memberships (`TenantContextService.switchTenant` verifies membership
 * server-side, never trusting the client's `tenantId` as-is). `csrfToken`
 * is returned alongside `tenantId`/`role` -- same as
 * `staff-auth/session/refresh` -- since the new session carries a freshly
 * rotated CSRF token the client needs for its next mutating request; the
 * brief's envelope shape ({tenantId, role}) is extended with it for that
 * reason.
 *
 * `staffTenantMembershipId` (optional body field, new v1.16): required by
 * the service layer only when the identity holds more than one ACTIVE
 * membership on `tenantId` (same-tenant multi-role, e.g. TEACHER +
 * SUPPORT_TEACHER in one school) -- otherwise a 409
 * AMBIGUOUS_TENANT_MEMBERSHIP is raised rather than picking one
 * heuristically.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const body = await parseStaffJsonBody(request);
    const tenantId = validateNonEmptyString(body.tenantId, "tenantId");
    const staffTenantMembershipId =
      body.staffTenantMembershipId !== undefined
        ? validateNonEmptyString(body.staffTenantMembershipId, "staffTenantMembershipId")
        : undefined;

    const result = await getTenantContextService().switchTenant(identity, tenantId, staffTenantMembershipId);

    const response = NextResponse.json(
      {
        data: { tenantId: result.tenantId, role: result.role, csrfToken: result.csrfToken },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
    response.headers.append("Set-Cookie", buildStaffSessionSetCookie(env, result.sessionToken, result.absoluteExpiresAt));
    return response;
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
