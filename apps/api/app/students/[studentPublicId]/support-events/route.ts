import { NextResponse } from "next/server";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { validateStaffPaginationQuery } from "../../../../lib/staff-validation";
import { getSupportEventService } from "../../../../lib/staff-identity-context";

/** `GET /students/{studentPublicId}/support-events` (02_26 v1.16 §37.4) -- one shared endpoint for TEACHER/SUPPORT_TEACHER/ASACOM, not one per role. */
export async function GET(request: Request, { params }: { params: Promise<{ studentPublicId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { studentPublicId } = await params;
    const url = new URL(request.url);
    const pagination = validateStaffPaginationQuery(url);

    const events = await getSupportEventService().listByStudent(identity, studentPublicId, pagination);

    return NextResponse.json(
      {
        data: events.map((event) => ({
          id: event.publicId,
          tenantId: event.tenantId,
          studentProfileId: event.studentProfileId,
          actorStaffAccountId: event.actorStaffAccountId,
          actorRole: event.actorRole,
          supportType: event.supportType,
          intensity: event.intensity,
          occurredAt: event.occurredAt.toISOString(),
          durationSeconds: event.durationSeconds,
          createdAt: event.createdAt.toISOString(),
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
