import { NextResponse } from "next/server";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { getIndependentEducatorActivationService } from "../../../../lib/platform-identity-context";

/**
 * `GET /platform/independent-educators/{tenantId}` (capability
 * `independent_educator.read`) -- tenant status, resolved staff identity,
 * membership status. No didactic data. `INDEPENDENT_EDUCATOR_NOT_FOUND`
 * uniformly covers both "id does not exist" and "id exists but is not an
 * INDEPENDENT_EDUCATOR tenant" (anti-enumeration).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    const { tenantId } = await params;

    const summary = await getIndependentEducatorActivationService().getById(identity, tenantId);

    return NextResponse.json(
      {
        data: summary,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
