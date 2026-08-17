import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, requireIdempotencyKey, requireIfMatchVersion, validateOptionalEnumQueryParam } from "../../../../lib/staff-validation";
import { getFacilitationProposalService } from "../../../../lib/staff-identity-context";

const DECISION_VALUES = ["ACCEPT", "REJECT"] as const;

/**
 * `POST /facilitation-proposals/{id}/review` (02_26 v1.16 §37.7) --
 * reserved for the TEACHER with class access, or the SUPPORT_TEACHER with
 * an ACTIVE support_student_assignment on the student (resolution: the
 * assigned SUPPORT_TEACHER if present, otherwise the class TEACHER,
 * 02_39 §6ter). No new capability. Anti-self-approval: STAFF_FORBIDDEN if
 * the caller authored the proposal.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const { id } = await params;
    const ifMatchVersion = requireIfMatchVersion(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = await parseStaffJsonBody(request);
    const decision = validateOptionalEnumQueryParam(typeof body.decision === "string" ? body.decision : null, DECISION_VALUES, "decision");
    if (!decision) {
      throw new StaffIdentityError("VALIDATION_ERROR", "decision is required (ACCEPT|REJECT).");
    }
    const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote : null;

    const updated = await getFacilitationProposalService().review({ identity, id, decision, reviewNote, ifMatchVersion, idempotencyKey });

    return NextResponse.json(
      {
        data: {
          id: updated.publicId,
          status: updated.status,
          reviewedByStaffAccountId: updated.reviewedByStaffAccountId,
          reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
          reviewNote: updated.reviewNote,
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
