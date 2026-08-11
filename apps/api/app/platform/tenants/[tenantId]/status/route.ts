import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../../lib/platform-error-response";
import { getTenantStatusService } from "../../../../../lib/platform-identity-context";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../../../lib/platform-csrf-guard";
import { parsePlatformJsonBody, validateTenantStatusInput } from "../../../../../lib/platform-validation";

/**
 * `PATCH /platform/tenants/{tenantId}/status` (capability
 * `tenant.suspend`, governs both directions). Suspension is enforced for
 * real at every subsequent staff/student session read -- this route
 * only changes the row.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    if (!isTrustedPlatformOrigin(request, env) || !isValidPlatformCsrfToken(request, identity)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    const { tenantId } = await params;
    const body = await parsePlatformJsonBody(request);
    const status = validateTenantStatusInput(body.status);

    const updated = await getTenantStatusService().setStatus(identity, { tenantId, status });

    return NextResponse.json(
      {
        data: {
          id: updated.id,
          publicId: updated.publicId,
          status: updated.status,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
