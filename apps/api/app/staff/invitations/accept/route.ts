import { NextResponse } from "next/server";
import { parseStaffJsonBody, validateNonEmptyString, validateOptionalString } from "../../../../lib/staff-validation";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { getStaffInvitationService } from "../../../../lib/staff-identity-context";

/**
 * `POST /staff/invitations/accept` (02_35 v1.2 §11bis.3). No staff
 * session required — the token itself is the credential (`security: []`
 * in the canonical contract). Not idempotency-key-gated (§11bis.11): the
 * token's own `consumed_at` already makes a retry naturally rejected.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const body = await parseStaffJsonBody(request);
    const token = validateNonEmptyString(body.token, "token");
    const password = validateOptionalString(body.password, "password", 512);

    const result = await getStaffInvitationService().acceptInvitation({ token, password });

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
