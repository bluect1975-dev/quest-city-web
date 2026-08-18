import { NextResponse } from "next/server";
import { assertCapability, PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../../lib/platform-csrf-guard";
import { parsePlatformJsonBody, requirePlatformIdempotencyKey } from "../../../../lib/platform-validation";
import { validateAlertConfigurationBody } from "../../../../lib/operations-validation";
import { getAlertService } from "../../../../lib/operations-context";

/**
 * `GET /platform/operations/alert-configuration` (capability
 * `operations.alerting.view`, 02_42 v1.1 §30). Never returns the Bot
 * Token -- `CONFIGURED`/`NOT_CONFIGURED` plus masked recipient metadata
 * only.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    assertCapability(identity, "operations.alerting.view");

    const config = await getAlertService().getMaskedConfiguration();

    return NextResponse.json(
      { data: config, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}

/**
 * `PUT /platform/operations/alert-configuration` (capability
 * `operations.alerting.manage`, 02_42 v1.1 §30). CSRF + Idempotency-Key
 * required. The credential itself is never accepted in this request body
 * -- provisioned exclusively through the server-side secret regime
 * (07_06 §9), never through this API.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    if (!isTrustedPlatformOrigin(request, env) || !isValidPlatformCsrfToken(request, identity)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    assertCapability(identity, "operations.alerting.manage");
    const idempotencyKey = requirePlatformIdempotencyKey(request);
    const body = await parsePlatformJsonBody(request);
    const validated = validateAlertConfigurationBody(body);

    const config = await getAlertService().updateConfiguration({
      channel: "TELEGRAM",
      enabled: validated.enabled,
      severityThreshold: validated.severityThreshold,
      cooldownSeconds: validated.cooldownSeconds,
      updatedByStaffAccountId: identity.staffAccountId,
      idempotencyKey,
    });

    return NextResponse.json(
      { data: config, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
