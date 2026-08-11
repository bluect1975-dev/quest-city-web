import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateStaffEmail, requireIdempotencyKey } from "../../../lib/staff-validation";
import { getStaffInvitationService } from "../../../lib/staff-identity-context";

/** `POST /staff/invitations` (02_35 v1.2 §11bis.3, §11bis.14). SCHOOL_ADMIN-only (staff.invite). */
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
    if (body.role !== undefined && body.role !== "TEACHER") {
      throw new StaffIdentityError("VALIDATION_ERROR", "role must be TEACHER");
    }

    const result = await getStaffInvitationService().createInvitation({ identity, email, idempotencyKey });

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
