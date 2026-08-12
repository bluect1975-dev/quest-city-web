import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import { requireIdempotencyKey } from "../../../../lib/staff-validation";
import { getSchoolClassManagementService } from "../../../../lib/staff-identity-context";

/**
 * `POST /classes/{classId}/access-code` (`issueClassAccessCode`, OpenAPI
 * v1.10 — 02_26 v1.12 §34.3). SCHOOL_ADMIN-only (`class.manage`, same
 * capability as `PATCH /classes/{classId}` and `POST .../archive` — no
 * new capability). Revokes any existing ACTIVE code and issues a new
 * one-time plaintext code in the same transaction: at most one ACTIVE
 * code per class. 409 `CLASS_ALREADY_ARCHIVED` if the class is archived.
 */
export async function POST(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { classId } = await params;

    const result = await getSchoolClassManagementService().issueAccessCode({ identity, classId, idempotencyKey });

    return NextResponse.json(
      {
        data: result,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
