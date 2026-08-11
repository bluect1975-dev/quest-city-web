import { NextResponse } from "next/server";
import { getPlatformAuthService } from "../../../../lib/platform-identity-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { parsePlatformJsonBody, validatePlatformEmail, validatePlatformPassword } from "../../../../lib/platform-validation";
import { getClientIp } from "../../../../lib/client-ip";
import { buildPlatformSessionSetCookie } from "../../../../lib/platform-session-cookie";
import { loadEnv } from "../../../../lib/env";

/**
 * `POST /platform-auth/session/start` (School Pilot Readiness Tranche A,
 * 02_38 §4.1/§20). No authentication. Sets the `qc_platform_session`
 * cookie -- distinct from `qc_staff_session`/`qc_web_session` -- and
 * returns the CSRF token and the actor's effective capability set once
 * in the body.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const body = await parsePlatformJsonBody(request);
    const email = validatePlatformEmail(body.email);
    const password = validatePlatformPassword(body.password);
    const clientIp = getClientIp(request);

    const result = await getPlatformAuthService().start({ email, password, clientIp });
    const env = loadEnv();

    const response = NextResponse.json(
      {
        data: { csrfToken: result.csrfToken, capabilities: result.capabilities },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
    response.headers.append("Set-Cookie", buildPlatformSessionSetCookie(env, result.sessionToken, result.absoluteExpiresAt));
    return response;
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
