import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { getRecoveryAssignmentService } from "../../../../lib/staff-identity-context";
import { isTrustedStaffOrigin, isValidStaffCsrfToken } from "../../../../lib/staff-csrf-guard";
import {
  parseStaffJsonBody,
  requireIdempotencyKey,
  validateNonEmptyString,
  validateAllowedRuntimeChannels,
} from "../../../../lib/staff-validation";

/**
 * `POST /attempts/{attemptId}/recovery-assignment` (02_35 §11). NOT
 * generic assignment authoring — the sole path is a recovery derived
 * from a PUBLISHED teacher_feedback (02_35 §11.1-11.2, AGENTS.md rule 16
 * boundary).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const { attemptId } = await params;
    const idempotencyKey = requireIdempotencyKey(request);
    const body = await parseStaffJsonBody(request);
    const originTeacherFeedbackId = validateNonEmptyString(body.originTeacherFeedbackId, "originTeacherFeedbackId");
    const contentBundleId = validateNonEmptyString(body.contentBundleId, "contentBundleId");
    const allowedRuntimeChannels = validateAllowedRuntimeChannels(body.allowedRuntimeChannels);

    const result = await getRecoveryAssignmentService().create({
      identity,
      attemptId,
      originTeacherFeedbackId,
      contentBundleId,
      allowedRuntimeChannels,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        data: {
          assignmentId: result.assignmentId,
          originTeacherFeedbackId: result.originTeacherFeedbackId,
          studentProfileId: result.studentProfileId,
          contentBundleId: result.contentBundleId,
          allowedRuntimeChannels: result.allowedRuntimeChannels,
          status: result.status,
          createdByStaffId: result.createdByStaffId,
          createdAt: new Date(result.createdAt).toISOString(),
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
