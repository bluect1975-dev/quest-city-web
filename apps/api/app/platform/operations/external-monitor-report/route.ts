import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { checkFixedWindow, type RateLimitDimension } from "@quest-city-web/identity";
import { loadEnv } from "../../../../lib/env";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { verifyExternalMonitorRequest } from "../../../../lib/external-monitor-request-context";
import { validateExternalMonitorReportBody } from "../../../../lib/external-monitor-validation";
import { getExternalMonitorReportService, getOperationsPoolForQueries } from "../../../../lib/operations-context";

/**
 * 02_42 v1.2 §68 -- dedicated, tighter rate limit than the general
 * `/platform/operations/...` surface, independent from replay protection
 * (§59.A). E-PILOT reference value, recalibratable without a contract
 * change. Keyed by the AUTHENTICATED keyId (post-verification), never the
 * raw presented header value -- an unauthenticated caller cannot burn a
 * legitimate keyId's rate-limit budget with garbage requests.
 */
const EXTERNAL_MONITOR_RATE_LIMIT: RateLimitDimension = {
  scope: "EXTERNAL_MONITOR_REPORT_KEY_ID",
  limit: 30,
  windowMs: 5 * 60 * 1000,
};

/**
 * `POST /platform/operations/external-monitor-report` (02_42 v1.2 PARTE U
 * §55, OpenAPI v1.19 `submitExternalMonitorReport`). Machine-to-machine
 * only -- no Platform Admin session cookie, no CSRF, no
 * `PlatformCapability` (02_42 §55, §72 principle 1). Level 2 of the
 * two-level design (02_42 §52); Level 1 direct Telegram fallback and its
 * GitHub Actions workflow are out of scope for this endpoint entirely
 * (02_42 §61-62, not implemented by this change set).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();

    // Auth first (02_42 §53.4, all four checks fail-closed) -- reads and
    // bounds the raw body itself; nothing below re-reads request.text().
    const { verified, rawBody } = await verifyExternalMonitorRequest(request, env);

    const rateLimit = await checkFixedWindow(getOperationsPoolForQueries(), EXTERNAL_MONITOR_RATE_LIMIT, verified.keyId);
    if (!rateLimit.allowed) {
      throw new PlatformAdminError("EXTERNAL_MONITOR_RATE_LIMITED", "external-monitor-report rate limit exceeded", {
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    let parsedBody: unknown;
    try {
      parsedBody = rawBody.length > 0 ? JSON.parse(rawBody) : {};
    } catch {
      throw new PlatformAdminError("EXTERNAL_MONITOR_PAYLOAD_INVALID", "Request body is not valid JSON.");
    }
    const body = validateExternalMonitorReportBody(parsedBody);

    const result = await getExternalMonitorReportService().submit(body);

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
