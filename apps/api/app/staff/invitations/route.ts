import { NextResponse } from "next/server";
import { StaffIdentityError, INVITABLE_STAFF_ROLES, type InvitableStaffRole } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateStaffEmail, requireIdempotencyKey } from "../../../lib/staff-validation";
import { getStaffInvitationService } from "../../../lib/staff-identity-context";

/**
 * `POST /staff/invitations` (02_35 v1.2 §11bis.3, §11bis.14, extended by
 * v1.7 §11quinquies.6/§11sexies.6). SCHOOL_ADMIN-only (staff.invite).
 * `role` now accepts TEACHER (default)/SUPPORT_TEACHER/ASACOM -- never
 * SCHOOL_ADMIN or INDEPENDENT_EDUCATOR through this tenant-scoped flow.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const body = await parseStaffJsonBody(request);
    const email = validateStaffEmail(body.email);
    if (body.role !== undefined && !INVITABLE_STAFF_ROLES.includes(body.role as InvitableStaffRole)) {
      throw new StaffIdentityError("VALIDATION_ERROR", `role must be one of ${INVITABLE_STAFF_ROLES.join(", ")}`);
    }

    const result = await getStaffInvitationService().createInvitation({
      identity,
      email,
      idempotencyKey,
      ...(body.role !== undefined ? { role: body.role as InvitableStaffRole } : {}),
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
