import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../../lib/platform-csrf-guard";
import { parsePlatformJsonBody } from "../../../../lib/platform-validation";
import { getConvergenceRollbackReviewService } from "../../../../lib/platform-identity-context";
import { toConvergenceRequestSummary } from "../../../../lib/convergence-serialization";

const ROLLBACK_REVIEW_DECISIONS = new Set(["ACCEPT_PARTIAL", "RETRY_REMAINING"]);

function validateRollbackReviewDecision(value: unknown): "ACCEPT_PARTIAL" | "RETRY_REMAINING" {
  if (typeof value !== "string" || !ROLLBACK_REVIEW_DECISIONS.has(value)) {
    throw new PlatformAdminError("VALIDATION_ERROR", "decision must be one of ACCEPT_PARTIAL, RETRY_REMAINING");
  }
  return value as "ACCEPT_PARTIAL" | "RETRY_REMAINING";
}

/**
 * `POST /convergence-requests/{id}/rollback-review` (02_38 v1.4 §10.5,
 * 02_26 v1.14 §36.8). PLATFORM_ADMIN-only. `ACCEPT_PARTIAL` closes the
 * request with the partial migration state as final; `RETRY_REMAINING`
 * reopens execution for a fresh `execute()` call.
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
    const body = await parsePlatformJsonBody(request);
    const decision = validateRollbackReviewDecision(body.decision);

    const result = await getConvergenceRollbackReviewService().resolve(identity, id, decision);

    return NextResponse.json(
      {
        data: toConvergenceRequestSummary(result),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
