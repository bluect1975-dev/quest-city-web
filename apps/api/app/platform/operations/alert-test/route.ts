import { NextResponse } from "next/server";
import { assertCapability, PlatformAdminError } from "@quest-city-web/platform-admin";
import { checkFixedWindow, type RateLimitDimension } from "@quest-city-web/identity";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../../lib/platform-csrf-guard";
import { requirePlatformIdempotencyKey } from "../../../../lib/platform-validation";
import { getAlertService } from "../../../../lib/operations-context";
import { getPlatformAdminPoolForQueries } from "../../../../lib/platform-identity-context";

/** Tighter, dedicated rate limit -- repeated test sends are an operator debugging action, not normal traffic (02_42 v1.1 §33). */
const ALERT_TEST_RATE_LIMIT: RateLimitDimension = { scope: "PLATFORM_OPERATIONS_ALERT_TEST", limit: 5, windowMs: 5 * 60 * 1000 };

/**
 * `POST /platform/operations/alert-test` (capability
 * `operations.alerting.manage`, 02_42 v1.1 §33). CSRF + Idempotency-Key +
 * dedicated stricter rate limit + audit. Message is always self-identified
 * as TEST (02_42 §33).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    if (!isTrustedPlatformOrigin(request, env) || !isValidPlatformCsrfToken(request, identity)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    assertCapability(identity, "operations.alerting.manage");
    const idempotencyKey = requirePlatformIdempotencyKey(request);

    const rateLimit = await checkFixedWindow(getPlatformAdminPoolForQueries(), ALERT_TEST_RATE_LIMIT, identity.staffAccountId);
    if (!rateLimit.allowed) {
      throw new PlatformAdminError("RATE_LIMITED", "alert-test rate limit exceeded", { retryAfterSeconds: rateLimit.retryAfterSeconds });
    }

    const delivery = await getAlertService().sendTest(identity.staffAccountId, idempotencyKey);

    return NextResponse.json(
      {
        data: {
          deliveryStatus: delivery.status,
          sentAt: delivery.createdAt.toISOString(),
          failureCategory: delivery.failureCategory,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 202 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
