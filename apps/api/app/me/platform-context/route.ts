import { NextResponse } from "next/server";
import { loadEnv } from "../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../lib/platform-error-response";

/** `GET /me/platform-context`. Minimal profile of the authenticated platform admin session -- identity and effective capabilities. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    return NextResponse.json(
      {
        data: { staffAccountId: identity.staffAccountId, capabilities: identity.capabilities },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
