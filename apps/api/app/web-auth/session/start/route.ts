import { NextResponse } from "next/server";
import { getSessionService } from "../../../../lib/identity-context";
import { identityErrorResponse } from "../../../../lib/identity-error-response";
import { parseJsonBody, validateAccessAlias, validateClassCode, validatePin } from "../../../../lib/identity-validation";
import { getClientIp } from "../../../../lib/client-ip";
import { buildSessionSetCookie } from "../../../../lib/session-cookie";
import { loadEnv } from "../../../../lib/env";

/**
 * `POST /web-auth/session/start` (02_26 §30.1). No authentication. Creates
 * the `HttpOnly`/`Secure`/`SameSite=Lax` session cookie and returns the
 * CSRF token once in the response body — the session token itself is
 * never present in the JSON body, only in the `Set-Cookie` header.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const body = await parseJsonBody(request);
    const classCode = validateClassCode(body.classCode);
    const accessAlias = validateAccessAlias(body.accessAlias);
    const pin = validatePin(body.pin);
    const clientIp = getClientIp(request);

    const result = await getSessionService().start({ classCode, accessAlias, pin, clientIp });
    const env = loadEnv();

    const response = NextResponse.json(
      {
        data: {
          studentPublicId: result.studentPublicId,
          tenantPublicId: result.tenantPublicId,
          classPublicId: result.classPublicId,
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
