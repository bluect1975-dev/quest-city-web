import { NextResponse } from "next/server";
import { assertCapability, PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../../lib/platform-error-response";
import { getIncidentService } from "../../../../../lib/operations-context";

/**
 * `GET /platform/operations/incidents/{incidentId}` (capability
 * `operations.incidents.view`, 02_42 v1.1 §25). Incident detail plus its
 * append-only timeline.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    assertCapability(identity, "operations.incidents.view");
    const { incidentId } = await params;

    const detail = await getIncidentService().detail(incidentId);
    if (!detail) {
      throw new PlatformAdminError("INCIDENT_NOT_FOUND", `Incident ${incidentId} not found.`);
    }

    return NextResponse.json(
      {
        data: {
          incident: {
            id: detail.incident.id,
            publicId: detail.incident.publicId,
            type: detail.incident.type,
            severity: detail.incident.severity,
            source: detail.incident.source,
            service: detail.incident.service,
            summary: detail.incident.summary,
            status: detail.incident.status,
            firstSeenAt: detail.incident.firstSeenAt.toISOString(),
            lastSeenAt: detail.incident.lastSeenAt.toISOString(),
            occurrenceCount: detail.incident.occurrenceCount,
            acknowledgedAt: detail.incident.acknowledgedAt?.toISOString() ?? null,
            acknowledgedBy: detail.incident.acknowledgedByStaffAccountId,
            resolvedAt: detail.incident.resolvedAt?.toISOString() ?? null,
            resolutionType: detail.incident.resolutionType,
            tenantId: detail.incident.tenantId,
          },
          events: detail.events.map((event) => ({
            id: event.id,
            eventType: event.eventType,
            detail: event.detail,
            actorType: event.actorType,
            actorId: event.actorId,
            createdAt: event.createdAt.toISOString(),
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
