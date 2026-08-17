import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, requireIdempotencyKey, validateOptionalEnumQueryParam } from "../../../../../lib/staff-validation";
import { getObservationService } from "../../../../../lib/staff-identity-context";

const SUPPORT_TYPE_VALUES = [
  "COMMUNICATION_SUPPORT", "COMPREHENSION_SUPPORT", "ATTENTION_SUPPORT", "MOTOR_INTERACTION_SUPPORT",
  "NAVIGATION_SUPPORT", "EMOTIONAL_REGULATION_SUPPORT", "TASK_ORGANIZATION_SUPPORT", "ACCESSIBILITY_FACILITATION", "OTHER_STRUCTURED",
] as const;

/** `POST /asacom/observations/{id}/supersede` (02_26 v1.16 §37.5) -- author-only, creates a new observation with superseded_by pointing back, original never mutated. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { id } = await params;
    const body = await parseStaffJsonBody(request);
    const category = body.category !== undefined && body.category !== null
      ? validateOptionalEnumQueryParam(typeof body.category === "string" ? body.category : null, SUPPORT_TYPE_VALUES, "category")
      : undefined;
    const noteStructuredRef = typeof body.noteStructuredRef === "string" ? body.noteStructuredRef : null;

    const created = await getObservationService().supersede({ identity, originalId: id, category, noteStructuredRef, idempotencyKey });

    return NextResponse.json(
      {
        data: { id: created.publicId, category: created.category, observedAt: created.observedAt.toISOString(), createdAt: created.createdAt.toISOString() },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
