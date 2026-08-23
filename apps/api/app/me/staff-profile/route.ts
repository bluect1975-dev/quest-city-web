import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateDisplayName } from "../../../lib/staff-validation";
import { getStaffAccountRepository } from "../../../lib/staff-identity-context";

/**
 * `GET`/`PATCH /me/staff-profile` (Pilot Product Experience Residual
 * Closure, Tranche H1) — closes `NEW-GAP-STAFF-DISPLAY-NAME-01`'s missing
 * self-service surface (no `profile`/`settings` route existed anywhere in
 * `apps/dashboard` before this tranche). Self-service only: a staff member
 * can read and set their own `display_name`, never anyone else's — there
 * is deliberately no `staffAccountId` in the request body of the PATCH,
 * `identity.staffAccountId` (from the session) is the only account this
 * route ever writes to.
 *
 * `email` is included in the GET response because this is the account's
 * own self-view (not a third party read, unlike `GET /me/class`'s
 * `teachers[]`, which never includes email).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const account = await getStaffAccountRepository().findById(identity.staffAccountId);
    if (!account) {
      throw new StaffIdentityError("STAFF_AUTH_REQUIRED");
    }
    return NextResponse.json(
      {
        data: { email: account.email, displayName: account.displayName },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const body = await parseStaffJsonBody(request);
    const displayName = validateDisplayName(body.displayName);

    const account = await getStaffAccountRepository().updateDisplayName(identity.staffAccountId, displayName);
    if (!account) {
      throw new StaffIdentityError("STAFF_AUTH_REQUIRED");
    }

    return NextResponse.json(
      {
        data: { email: account.email, displayName: account.displayName },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
