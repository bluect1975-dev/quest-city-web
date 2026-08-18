import { NextResponse } from "next/server";
import { assertCapability } from "@quest-city-web/platform-admin";
import { aggregatePlatformHealth, CRITICAL_SERVICES } from "@quest-city-web/operations";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { getServiceHealthStateRepository } from "../../../../lib/operations-context";

const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * `GET /platform/operations/services` (capability `operations.infrastructure.view`,
 * 02_42 v1.1 §21-23,§40). Per-service health state, plus deterministic
 * global platform status aggregation (never left to the client).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    assertCapability(identity, "operations.infrastructure.view");

    const services = await getServiceHealthStateRepository().listLatestPerService();
    const now = Date.now();
    const platformStatus = aggregatePlatformHealth(
      services
        .filter((entry) => (CRITICAL_SERVICES as readonly string[]).includes(entry.service))
        .map((entry) => ({
          service: entry.service,
          state: entry.state,
          staleSinceCheckedAt: now - entry.checkedAt.getTime() > STALE_AFTER_MS,
        })),
    );

    return NextResponse.json(
      {
        data: {
          platformStatus,
          services: services.map((entry) => ({
            service: entry.service,
            state: entry.state,
            latencyMs: entry.latencyMs,
            checkedAt: entry.checkedAt.toISOString(),
          })),
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
