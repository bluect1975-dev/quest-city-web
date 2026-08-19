import { NextResponse } from "next/server";
import { assertCapability } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { validatePaginationQuery } from "../../../../lib/platform-validation";
import { validateOptionalSeverity, validateOptionalStatus } from "../../../../lib/operations-validation";
import { getIncidentService } from "../../../../lib/operations-context";

/**
 * `GET /platform/operations/incidents` (capability `operations.incidents.view`,
 * 02_42 v1.1 §25,§35). Filterable list, never a per-incident query
 * cascade (single batched query with WHERE filters).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    assertCapability(identity, "operations.incidents.view");

    const url = new URL(request.url);
    const status = validateOptionalStatus(url.searchParams.get("status"));
    const severity = validateOptionalSeverity(url.searchParams.get("severity"));
    const service = url.searchParams.get("service") ?? undefined;
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const { limit, offset } = validatePaginationQuery(url);

    const incidents = await getIncidentService().list({
      ...(status ? { status } : {}),
      ...(severity ? { severity } : {}),
      ...(service ? { service } : {}),
      ...(fromRaw ? { from: new Date(fromRaw) } : {}),
      ...(toRaw ? { to: new Date(toRaw) } : {}),
      limit,
      offset,
    });

    return NextResponse.json(
      {
        data: incidents.map((incident) => ({
          id: incident.id,
          publicId: incident.publicId,
          type: incident.type,
          severity: incident.severity,
          source: incident.source,
          service: incident.service,
          summary: incident.summary,
          status: incident.status,
          firstSeenAt: incident.firstSeenAt.toISOString(),
          lastSeenAt: incident.lastSeenAt.toISOString(),
          occurrenceCount: incident.occurrenceCount,
          acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
          acknowledgedBy: incident.acknowledgedByStaffAccountId,
          resolvedAt: incident.resolvedAt?.toISOString() ?? null,
          resolutionType: incident.resolutionType,
          tenantId: incident.tenantId,
          // Tranche E2 (02_42 v1.2 §60, §63): already-populated on the DTO
          // type (source has always included EXTERNAL_MONITOR since
          // v1.0/v1.1) -- backfilled is newly surfaced here so the Control
          // Center never gives the false impression of real-time
          // observation for a retroactively-recorded incident.
          backfilled: incident.backfilled,
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
