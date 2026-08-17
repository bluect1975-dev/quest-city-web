import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateNonEmptyString, requireIdempotencyKey, validateOptionalEnumQueryParam } from "../../../lib/staff-validation";
import { getSupportEventService } from "../../../lib/staff-identity-context";

const SUPPORT_TYPE_VALUES = [
  "COMMUNICATION_SUPPORT", "COMPREHENSION_SUPPORT", "ATTENTION_SUPPORT", "MOTOR_INTERACTION_SUPPORT",
  "NAVIGATION_SUPPORT", "EMOTIONAL_REGULATION_SUPPORT", "TASK_ORGANIZATION_SUPPORT", "ACCESSIBILITY_FACILITATION", "OTHER_STRUCTURED",
] as const;
const INTENSITY_VALUES = ["NONE", "MINIMAL", "MODERATE", "SIGNIFICANT"] as const;

/** `POST /support-teacher/support-events` (02_26 v1.16 §37.4, new v1.16, capability support_teacher.support.record, attore SUPPORT_TEACHER o TEACHER). */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const body = await parseStaffJsonBody(request);
    const studentPublicId = validateNonEmptyString(body.studentPublicId, "studentPublicId");
    const learningAttemptId = validateNonEmptyString(body.learningAttemptId, "learningAttemptId");
    const supportType = validateOptionalEnumQueryParam(typeof body.supportType === "string" ? body.supportType : null, SUPPORT_TYPE_VALUES, "supportType");
    const intensity = validateOptionalEnumQueryParam(typeof body.intensity === "string" ? body.intensity : null, INTENSITY_VALUES, "intensity");
    if (!supportType || !intensity) {
      throw new StaffIdentityError("VALIDATION_ERROR", "supportType and intensity are required.");
    }
    const durationSeconds = typeof body.durationSeconds === "number" ? body.durationSeconds : null;
    const noteStructuredRef = typeof body.noteStructuredRef === "string" ? body.noteStructuredRef : null;

    const created = await getSupportEventService().create({
      identity, studentPublicId, learningAttemptId, supportType, intensity, durationSeconds, noteStructuredRef, idempotencyKey,
    });

    return NextResponse.json(
      {
        data: {
          id: created.publicId,
          studentProfileId: created.studentProfileId,
          actorRole: created.actorRole,
          supportType: created.supportType,
          intensity: created.intensity,
          occurredAt: created.occurredAt.toISOString(),
          createdAt: created.createdAt.toISOString(),
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
