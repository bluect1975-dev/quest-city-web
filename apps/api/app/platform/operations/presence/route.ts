import { NextResponse } from "next/server";
import { assertCapability, PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../lib/platform-error-response";
import { getPresenceService, getOperationalMetricSampleRepository, getOperationsPoolForQueries } from "../../../../lib/operations-context";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `GET /platform/operations/presence` (capability `operations.presence.view`,
 * 02_42 v1.1 §14-17,§42). Aggregate counts only -- never a named-student
 * list. Optional `tenantId` scopes the per-school drill-down.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    assertCapability(identity, "operations.presence.view");

    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenantId");
    if (tenantId) {
      const result = await getOperationsPoolForQueries().query("SELECT 1 FROM tenant WHERE id = $1", [tenantId]);
      if (result.rowCount === 0) {
        throw new PlatformAdminError("TENANT_NOT_FOUND", `Tenant ${tenantId} not found.`);
      }
    }

    const presence = getPresenceService();
    const counts = await presence.concurrentCounts(tenantId ?? undefined);

    const metrics = getOperationalMetricSampleRepository();
    const now = new Date();
    const [peakStudentsToday, peakStudents7d, peakStudents30d, peakStaffToday, peakStaff7d, peakStaff30d, peakTotalToday, peakTotal7d, peakTotal30d] =
      await Promise.all([
        metrics.maxValue("concurrent_students", new Date(now.getTime() - DAY_MS), now),
        metrics.maxValue("concurrent_students", new Date(now.getTime() - 7 * DAY_MS), now),
        metrics.maxValue("concurrent_students", new Date(now.getTime() - 30 * DAY_MS), now),
        metrics.maxValue("concurrent_staff", new Date(now.getTime() - DAY_MS), now),
        metrics.maxValue("concurrent_staff", new Date(now.getTime() - 7 * DAY_MS), now),
        metrics.maxValue("concurrent_staff", new Date(now.getTime() - 30 * DAY_MS), now),
        metrics.maxValue("concurrent_total", new Date(now.getTime() - DAY_MS), now),
        metrics.maxValue("concurrent_total", new Date(now.getTime() - 7 * DAY_MS), now),
        metrics.maxValue("concurrent_total", new Date(now.getTime() - 30 * DAY_MS), now),
      ]);

    return NextResponse.json(
      {
        data: {
          concurrentStudents: counts.concurrentStudents,
          concurrentStaff: counts.concurrentStaff,
          concurrentTotal: counts.concurrentTotal,
          tenantId: tenantId ?? null,
          peak: {
            peakStudentsToday, peakStudents7d, peakStudents30d,
            peakStaffToday, peakStaff7d, peakStaff30d,
            peakTotalToday, peakTotal7d, peakTotal30d,
          },
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
