import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../../lib/platform-csrf-guard";
import { getConvergencePreviewService } from "../../../../lib/platform-identity-context";

/**
 * `POST /convergence-requests/{id}/preview` (02_38 v1.4 §9/§10.2bis,
 * 02_26 v1.14 §36.4). PLATFORM_ADMIN-only, integrated identity
 * verification + migration plan generation. No request body, no
 * Idempotency-Key -- a preview is safely regenerable.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    if (!isTrustedPlatformOrigin(request, env) || !isValidPlatformCsrfToken(request, identity)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    const { id } = await params;

    const result = await getConvergencePreviewService().preview(identity, id);

    return NextResponse.json(
      {
        data: result,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
