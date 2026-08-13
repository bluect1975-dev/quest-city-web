import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, requireIdempotencyKey, validateNonEmptyString } from "../../../../lib/staff-validation";
import { getContentPromotionService } from "../../../../lib/staff-identity-context";

/**
 * `POST /content/{contentId}/promote` (02_38 v1.4 §14, 02_26 v1.14
 * §36.11). `ContentPromotionService.promote` always throws
 * `CONTENT_NOT_FOUND` by design -- this Tranche has no owned-content
 * table yet (disclosed gap, not a silent stub). This route enforces the
 * full contract up to that point and lets `staffErrorResponse` convert
 * the thrown error into the 404 JSON response, same as any other route.
 */
export async function POST(request: Request, { params }: { params: Promise<{ contentId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { contentId } = await params;
    const body = await parseStaffJsonBody(request);
    const convergenceRequestId = validateNonEmptyString(body.convergenceRequestId, "convergenceRequestId");

    const result = await getContentPromotionService().promote(identity, contentId, convergenceRequestId, idempotencyKey);

    return NextResponse.json(
      {
        data: result,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
