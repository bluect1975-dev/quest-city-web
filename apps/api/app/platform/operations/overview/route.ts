import { NextResponse } from "next/server";
import { assertCapability } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { getOverviewService } from "../../../../lib/operations-context";

/**
 * `GET /platform/operations/overview` (capability `operations.dashboard.view`,
 * 02_42 v1.1 §39). Read-only aggregation -- global health banner, KPI
 * counts, open incidents, last backup status.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    assertCapability(identity, "operations.dashboard.view");

    const overview = await getOverviewService().getOverview();

    return NextResponse.json(
      { data: overview, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
