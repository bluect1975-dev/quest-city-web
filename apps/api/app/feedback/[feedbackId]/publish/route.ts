import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { getFeedbackService } from "../../../../lib/staff-identity-context";
import { isTrustedStaffOrigin, isValidStaffCsrfToken } from "../../../../lib/staff-csrf-guard";
import { requireIdempotencyKey, requireIfMatchVersion } from "../../../../lib/staff-validation";
import { toTeacherFeedbackResponseData } from "../../../../lib/teacher-feedback-dto";

/** `POST /feedback/{feedbackId}/publish` (02_35 §9.4). DRAFT -> PUBLISHED; implicitly resolves the linked review_queue_item if present. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ feedbackId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const { feedbackId } = await params;
    const ifMatchVersion = requireIfMatchVersion(request);
    const idempotencyKey = requireIdempotencyKey(request);

    const updated = await getFeedbackService().publish({ identity, feedbackId, ifMatchVersion, idempotencyKey });

    return NextResponse.json(
      { data: toTeacherFeedbackResponseData(updated), meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
