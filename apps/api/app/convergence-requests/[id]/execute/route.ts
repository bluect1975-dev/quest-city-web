import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../../lib/platform-csrf-guard";
import { requirePlatformIdempotencyKey } from "../../../../lib/platform-validation";
import { getConvergenceExecutionService } from "../../../../lib/platform-identity-context";
import { toMigrationExecutionResponse } from "../../../../lib/convergence-serialization";

/**
 * `POST /convergence-requests/{id}/execute` (02_38 v1.4 §10.4/§10.5,
 * 02_26 v1.14 §36.7). PLATFORM_ADMIN-only, per-unit transactional
 * migration execution. Idempotency-Key required -- a critical write.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    if (!isTrustedPlatformOrigin(request, env) || !isValidPlatformCsrfToken(request, identity)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requirePlatformIdempotencyKey(request);
    const { id } = await params;

    const result = await getConvergenceExecutionService().execute(identity, id, idempotencyKey);

    return NextResponse.json(
      {
        data: toMigrationExecutionResponse(result),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
