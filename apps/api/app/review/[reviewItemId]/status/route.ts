import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { getReviewService } from "../../../../lib/staff-identity-context";
import { isTrustedStaffOrigin, isValidStaffCsrfToken } from "../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, requireIdempotencyKey, requireIfMatchVersion, validateOptionalEnumQueryParam } from "../../../../lib/staff-validation";

const STATUS_VALUES = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const;

/**
 * `POST /review/{reviewItemId}/status` (02_35 §7.2). Single parametric
 * endpoint for claim/release/resolve/dismiss/reopen.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewItemId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const { reviewItemId } = await params;
    const ifMatchVersion = requireIfMatchVersion(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = await parseStaffJsonBody(request);
    const targetStatus = validateOptionalEnumQueryParam(
      typeof body.targetStatus === "string" ? body.targetStatus : null,
      STATUS_VALUES,
      "targetStatus",
    );
    if (!targetStatus) {
      throw new StaffIdentityError("VALIDATION_ERROR", "targetStatus is required");
    }

    const updated = await getReviewService().transitionStatus({
      identity,
      reviewItemId,
      targetStatus,
      ifMatchVersion,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        data: {
          id: updated.id,
          tenantId: updated.tenantId,
          classId: updated.classId,
          studentProfileId: updated.studentProfileId,
          learningAttemptId: updated.learningAttemptId,
          reason: updated.reason,
          priority: updated.priority,
          status: updated.status,
          createdAt: new Date(updated.createdAt).toISOString(),
          updatedAt: new Date(updated.updatedAt).toISOString(),
          reviewedAt: updated.reviewedAt ? new Date(updated.reviewedAt).toISOString() : null,
          reviewerStaffId: updated.reviewerStaffAccountId,
          version: updated.version,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
