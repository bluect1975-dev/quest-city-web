import { NextResponse } from "next/server";
import { loadEnv } from "../../lib/env";
import { requireStaffIdentity } from "../../lib/staff-request-context";
import { staffErrorResponse } from "../../lib/staff-error-response";
import { getReviewService } from "../../lib/staff-identity-context";
import { validateOptionalEnumQueryParam } from "../../lib/staff-validation";

const STATUS_VALUES = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const;
const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH"] as const;

/** `GET /review` (02_35 §7). Lists review_queue_item in scope for the authenticated staff session. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const url = new URL(request.url);
    const classId = url.searchParams.get("classId") ?? undefined;
    const status = validateOptionalEnumQueryParam(url.searchParams.get("status"), STATUS_VALUES, "status");
    const priority = validateOptionalEnumQueryParam(url.searchParams.get("priority"), PRIORITY_VALUES, "priority");

    const items = await getReviewService().list(identity, { classId, status, priority });

    return NextResponse.json(
      {
        data: items.map((item) => ({
          id: item.id,
          tenantId: item.tenantId,
          classId: item.classId,
          studentProfileId: item.studentProfileId,
          learningAttemptId: item.learningAttemptId,
          reason: item.reason,
          priority: item.priority,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          reviewedAt: item.reviewedAt ? item.reviewedAt.toISOString() : null,
          reviewerStaffId: item.reviewerStaffAccountId,
          version: item.version,
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
