import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { getPlatformAuthService } from "../../../../lib/platform-identity-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { readPlatformSessionToken, buildPlatformSessionSetCookie } from "../../../../lib/platform-session-cookie";
import { getPlatformCsrfTokenHeader, isTrustedPlatformOrigin } from "../../../../lib/platform-csrf-guard";
import { loadEnv } from "../../../../lib/env";

/** `POST /platform-auth/session/refresh`. Full rotation; the absolute expiry is carried over unchanged. */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readPlatformSessionToken(request, env);
    const csrfToken = getPlatformCsrfTokenHeader(request);

    if (!sessionToken) {
      throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED");
    }
    if (!isTrustedPlatformOrigin(request, env) || !csrfToken) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }

    const result = await getPlatformAuthService().refresh({ sessionToken, csrfToken });

    const response = NextResponse.json(
      {
        data: { csrfToken: result.csrfToken },
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
