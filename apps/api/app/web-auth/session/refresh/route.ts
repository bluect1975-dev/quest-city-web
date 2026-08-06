import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { getSessionService } from "../../../../lib/identity-context";
import { identityErrorResponse } from "../../../../lib/identity-error-response";
import { readSessionToken, buildSessionSetCookie } from "../../../../lib/session-cookie";
import { getCsrfTokenHeader, isTrustedOrigin } from "../../../../lib/csrf-guard";
import { loadEnv } from "../../../../lib/env";

/**
 * `POST /web-auth/session/refresh` (02_26 §30.1/§30.3). Requires a valid
 * session cookie and `X-CSRF-Token`. Full rotation: a new session row is
 * created, the previous one revoked `ROTATED`, and the absolute expiry is
 * carried over unchanged — refresh never extends it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    const csrfToken = getCsrfTokenHeader(request);

    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }
    if (!isTrustedOrigin(request, env) || !csrfToken) {
      throw new IdentityError("CSRF_INVALID");
    }

    const result = await getSessionService().refresh({ sessionToken, csrfToken });

    const response = NextResponse.json(
      {
        data: {
          sessionExpiresAt: result.sessionExpiresAt.toISOString(),
          csrfToken: result.csrfToken,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
    response.headers.append("Set-Cookie", buildSessionSetCookie(env, result.sessionToken, result.sessionExpiresAt));
    return response;
  } catch (error) {
    return identityErrorResponse(error, correlationId);
  }
}
