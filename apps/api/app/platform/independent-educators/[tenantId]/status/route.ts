import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../../lib/platform-error-response";
import { getIndependentEducatorStatusService } from "../../../../../lib/platform-identity-context";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../../../lib/platform-csrf-guard";
import { parsePlatformJsonBody, validateTenantStatusInput } from "../../../../../lib/platform-validation";

/**
 * `PATCH /platform/independent-educators/{tenantId}/status` (capability
 * `independent_educator.status.manage`, governs both directions). A
 * single transaction sets both `tenant.status` and every
 * `role=INDEPENDENT_EDUCATOR` membership's status on that tenant (02_35
 * v1.4 §11ter.8) -- staff login blocked, existing sessions revoked,
 * student access blocked by the pre-existing `tenant.status=SUSPENDED`
 * enforcement, unmodified. Never a hard delete.
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

    const updated = await getIndependentEducatorStatusService().setStatus(identity, { tenantId, status });

    return NextResponse.json(
      {
        data: updated,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
