import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { getStaffAuthService } from "../../../../lib/staff-identity-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { readStaffSessionToken, buildStaffSessionSetCookie } from "../../../../lib/staff-session-cookie";
import { getStaffCsrfTokenHeader, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import { loadEnv } from "../../../../lib/env";

/**
 * `POST /staff-auth/session/refresh` (02_35 §4.4). Full rotation; the
 * absolute expiry is carried over unchanged — refresh never extends it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readStaffSessionToken(request, env);
    const csrfToken = getStaffCsrfTokenHeader(request);

    if (!sessionToken) {
      throw new StaffIdentityError("STAFF_AUTH_REQUIRED");
    }
    if (!isTrustedStaffOrigin(request, env) || !csrfToken) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }

    const result = await getStaffAuthService().refresh({ sessionToken, csrfToken });

    const response = NextResponse.json(
      {
        data: { csrfToken: result.csrfToken },
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
