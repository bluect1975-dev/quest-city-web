import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateNonEmptyString, requireIdempotencyKey } from "../../../lib/staff-validation";
import { getFacilitationService } from "../../../lib/staff-identity-context";

/**
 * `POST /support-teacher/difficulty-overrides` (02_26 v1.16 §37.6, new
 * v1.16) -- per-student, motivated/audited override (02_39 §7.2), own
 * assigned students only. Reuses the `difficulty_override_create`
 * idempotency scope (02_16, existing).
 */
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
    const targetRef = validateNonEmptyString(body.targetRef, "targetRef");
    const reason = validateNonEmptyString(body.reason, "reason");

    const created = await getFacilitationService().supportTeacherCreateDifficultyOverride({ identity, studentPublicId, targetRef, reason, idempotencyKey });

    return NextResponse.json(
      {
        data: { id: created.id, targetRef: created.targetRef, reason: created.reason, status: created.status, createdAt: created.createdAt.toISOString() },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
