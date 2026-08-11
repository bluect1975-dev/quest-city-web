import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { getPlatformAuthService } from "../../../lib/platform-identity-context";
import { platformErrorResponse } from "../../../lib/platform-error-response";
import { readPlatformSessionToken, buildClearPlatformSessionCookie } from "../../../lib/platform-session-cookie";
import { getPlatformCsrfTokenHeader, isTrustedPlatformOrigin } from "../../../lib/platform-csrf-guard";
import { loadEnv } from "../../../lib/env";

/** `POST /platform-auth/logout`. Always `200 {loggedOut:true}` regardless of prior session state. Idempotent. */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readPlatformSessionToken(request, env);
    const csrfToken = getPlatformCsrfTokenHeader(request);

    if (sessionToken && !isTrustedPlatformOrigin(request, env)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }

    await getPlatformAuthService().logout({ sessionToken, csrfToken });

    const response = NextResponse.json(
      { data: { loggedOut: true }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
    response.headers.append("Set-Cookie", buildClearPlatformSessionCookie(env));
    return response;
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
