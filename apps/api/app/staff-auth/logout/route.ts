import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { getStaffAuthService } from "../../../lib/staff-identity-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { readStaffSessionToken, buildClearStaffSessionCookie } from "../../../lib/staff-session-cookie";
import { getStaffCsrfTokenHeader, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { loadEnv } from "../../../lib/env";

/**
 * `POST /staff-auth/logout` (02_35 §4.4). Always `200 {loggedOut:true}`
 * regardless of prior session state — never reveals whether a session
 * previously existed. Idempotent.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readStaffSessionToken(request, env);
    const csrfToken = getStaffCsrfTokenHeader(request);

    if (sessionToken && !isTrustedStaffOrigin(request, env)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }

    await getStaffAuthService().logout({ sessionToken, csrfToken });

    const response = NextResponse.json(
      { data: { loggedOut: true }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
    response.headers.append("Set-Cookie", buildClearStaffSessionCookie(env));
    return response;
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
