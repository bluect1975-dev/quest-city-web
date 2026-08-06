import { NextResponse } from "next/server";
import { getClassCodeService } from "../../../../lib/identity-context";
import { identityErrorResponse } from "../../../../lib/identity-error-response";
import { parseJsonBody, validateClassCode } from "../../../../lib/identity-validation";
import { getClientIp } from "../../../../lib/client-ip";

/**
 * `POST /web-auth/class-code/resolve` (02_26 §30.1). No authentication.
 * Never distinguishes an inexistent, expired or revoked code — every
 * failure collapses to the uniform `CLASS_CODE_INVALID`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const body = await parseJsonBody(request);
    const classCode = validateClassCode(body.classCode);
    const clientIp = getClientIp(request);

    const result = await getClassCodeService().resolve(classCode, clientIp);

    return NextResponse.json(
      { data: result, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return identityErrorResponse(error, correlationId);
  }
}
