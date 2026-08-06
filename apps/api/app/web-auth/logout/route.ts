import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { getSessionService } from "../../../lib/identity-context";
import { identityErrorResponse } from "../../../lib/identity-error-response";
import { readSessionToken, buildClearSessionCookie } from "../../../lib/session-cookie";
import { getCsrfTokenHeader, isTrustedOrigin } from "../../../lib/csrf-guard";
import { loadEnv } from "../../../lib/env";

/**
 * `POST /web-auth/logout` (02_26 §30.1). Always `200 {loggedOut:true}`
 * regardless of prior session state (valid, already revoked, expired or
 * absent) — never reveals whether a session previously existed. CSRF is
 * checked only when a currently-valid session cookie is presented; with
 * none present there is nothing to protect.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    const csrfToken = getCsrfTokenHeader(request);

    if (sessionToken && !isTrustedOrigin(request, env)) {
      throw new IdentityError("CSRF_INVALID");
    }

    await getSessionService().logout({ sessionToken, csrfToken });

    const response = NextResponse.json(
      { data: { loggedOut: true }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
    response.headers.append("Set-Cookie", buildClearSessionCookie(env));
    return response;
  } catch (error) {
    return identityErrorResponse(error, correlationId);
  }
}
