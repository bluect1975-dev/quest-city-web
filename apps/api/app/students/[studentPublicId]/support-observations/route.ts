import { NextResponse } from "next/server";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { validateStaffPaginationQuery, validateOptionalEnumQueryParam } from "../../../../lib/staff-validation";
import { getObservationService } from "../../../../lib/staff-identity-context";

const SUPPORT_TYPE_VALUES = [
  "COMMUNICATION_SUPPORT", "COMPREHENSION_SUPPORT", "ATTENTION_SUPPORT", "MOTOR_INTERACTION_SUPPORT",
  "NAVIGATION_SUPPORT", "EMOTIONAL_REGULATION_SUPPORT", "TASK_ORGANIZATION_SUPPORT", "ACCESSIBILITY_FACILITATION", "OTHER_STRUCTURED",
] as const;

/**
 * `GET /students/{studentPublicId}/support-observations` (`contracts/quest-city-platform-openapi-v1_14.yaml`,
 * 02_26 v1.17 §38.1). Shared read endpoint, historyStatus/supersedesId
 * computed at read time (never persisted).
 */
export async function GET(request: Request, { params }: { params: Promise<{ studentPublicId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { studentPublicId } = await params;
    const url = new URL(request.url);
    const pagination = validateStaffPaginationQuery(url);
    const category = validateOptionalEnumQueryParam(url.searchParams.get("category"), SUPPORT_TYPE_VALUES, "category");
    const includeSuperseded = url.searchParams.get("includeSuperseded") === "true";

    const entries = await getObservationService().listByStudent(identity, studentPublicId, { category, includeSuperseded }, pagination);

    return NextResponse.json(
      {
        data: entries.map((entry) => ({
          id: entry.publicId,
          tenantId: entry.tenantId,
          studentProfileId: entry.studentProfileId,
          supportStudentAssignmentId: entry.supportStudentAssignmentId,
          actorStaffAccountId: entry.actorStaffAccountId,
          actorRole: entry.actorRole,
          observedAt: entry.observedAt.toISOString(),
          category: entry.category,
          createdAt: entry.createdAt.toISOString(),
          historyStatus: entry.historyStatus,
          supersededById: entry.supersededById,
          supersedesId: entry.supersedesId,
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
