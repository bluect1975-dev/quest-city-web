import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { validatePaginationQuery } from "../../../../lib/platform-validation";
import { validateMetricSource, validateDateRangeQuery } from "../../../../lib/operations-validation";
import { getOperationalMetricSampleRepository } from "../../../../lib/operations-context";

/**
 * `GET /platform/operations/metrics` (02_42 v1.1 §14,§17-19,§36). One
 * generic metric surface for infrastructure/usage/error-aggregate metrics
 * alike -- the capability required depends on `source`:
 * `operations.infrastructure.view` for HOST/CONTAINER/DATABASE/
 * REVERSE_PROXY/BACKUP/TLS, `operations.usage.view` OR
 * `operations.errors.view` for APPLICATION (accepted from either
 * dashboard section) -- never a single blanket metrics-read capability.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    const url = new URL(request.url);
    const source = validateMetricSource(url.searchParams.get("source"));

    const hasInfraCapability = identity.capabilities.includes("operations.infrastructure.view");
    const hasUsageOrErrorsCapability =
      identity.capabilities.includes("operations.usage.view") || identity.capabilities.includes("operations.errors.view");
    const authorized = source === "APPLICATION" ? hasUsageOrErrorsCapability || hasInfraCapability : hasInfraCapability;
    if (!authorized) {
      throw new PlatformAdminError("CAPABILITY_DENIED", `Missing required capability to read ${source} metrics.`, {
        safeDetails: { source },
      });
    }

    const metricKey = url.searchParams.get("metricKey");
    const { from, to } = validateDateRangeQuery(url);
    const { limit } = validatePaginationQuery(url);

    const samples = await getOperationalMetricSampleRepository().list({
      source,
      ...(metricKey ? { metricKey } : {}),
      from,
      to,
      limit,
    });

    return NextResponse.json(
      {
        data: samples.map((sample) => ({
          source: sample.source,
          metricKey: sample.metricKey,
          value: sample.value,
          unit: sample.unit,
          sampledAt: sample.sampledAt.toISOString(),
          status: sample.status,
          threshold: sample.threshold,
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
