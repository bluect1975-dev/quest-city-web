import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { getSessionService } from "../../../lib/identity-context";
import { identityErrorResponse } from "../../../lib/identity-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /me/student-context` (02_26 §30.1). Requires the session cookie
 * only — no CSRF, since this is a read with no side effect.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    const context = await getSessionService().getContext(sessionToken);

    return NextResponse.json(
      { data: context, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return identityErrorResponse(error, correlationId);
  }
}
