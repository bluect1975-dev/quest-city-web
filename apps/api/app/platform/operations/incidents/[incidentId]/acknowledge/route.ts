import { NextResponse } from "next/server";
import { assertCapability, PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../../../lib/platform-error-response";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../../../../lib/platform-csrf-guard";
import { requirePlatformIdempotencyKey } from "../../../../../../lib/platform-validation";
import { getIncidentService } from "../../../../../../lib/operations-context";

/**
 * `POST /platform/operations/incidents/{incidentId}/acknowledge`
 * (capability `operations.incidents.manage`, 02_42 v1.1 §27). CSRF +
 * Idempotency-Key required (tenant-less mutation, same pattern as
 * `POST /platform/tenants`).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    if (!isTrustedPlatformOrigin(request, env) || !isValidPlatformCsrfToken(request, identity)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    assertCapability(identity, "operations.incidents.manage");
    const { incidentId } = await params;
    const idempotencyKey = requirePlatformIdempotencyKey(request);

    const updated = await getIncidentService().acknowledge(incidentId, identity.staffAccountId, idempotencyKey);

    return NextResponse.json(
      {
        data: {
          id: updated.id,
          publicId: updated.publicId,
          status: updated.status,
          acknowledgedAt: updated.acknowledgedAt?.toISOString() ?? null,
          acknowledgedBy: updated.acknowledgedByStaffAccountId,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
