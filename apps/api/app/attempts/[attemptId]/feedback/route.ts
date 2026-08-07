import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { getFeedbackService } from "../../../../lib/staff-identity-context";
import { isTrustedStaffOrigin, isValidStaffCsrfToken } from "../../../../lib/staff-csrf-guard";
import {
  parseStaffJsonBody,
  requireIdempotencyKey,
  validateStructuredFeedback,
  validateOptionalFreeText,
  validateOptionalReviewQueueItemId,
} from "../../../../lib/staff-validation";
import { toTeacherFeedbackResponseData } from "../../../../lib/teacher-feedback-dto";

/** `POST /attempts/{attemptId}/feedback` (02_35 §9). Creates a teacher_feedback in DRAFT. */
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
    const structuredFeedback = validateStructuredFeedback(body.structuredFeedback);
    const freeText = validateOptionalFreeText(body.freeText);
    const originReviewQueueItemId = validateOptionalReviewQueueItemId(body.originReviewQueueItemId);

    const created = await getFeedbackService().create({
      identity,
      attemptId,
      structuredFeedback,
      freeText,
      originReviewQueueItemId,
      idempotencyKey,
    });

    return NextResponse.json(
      { data: toTeacherFeedbackResponseData(created), meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
