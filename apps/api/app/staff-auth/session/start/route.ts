import { NextResponse } from "next/server";
import { getStaffAuthService } from "../../../../lib/staff-identity-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { parseStaffJsonBody, validateStaffEmail, validateStaffPassword, validateOptionalTenantId } from "../../../../lib/staff-validation";
import { getClientIp } from "../../../../lib/client-ip";
import { buildStaffSessionSetCookie } from "../../../../lib/staff-session-cookie";
import { loadEnv } from "../../../../lib/env";

/**
 * `POST /staff-auth/session/start` (02_35 §4.1, §4.4). No authentication.
 * `tenantId` is required only when the account has more than one active
 * `staff_tenant_membership`. Sets the `qc_staff_session` cookie — distinct
 * from `qc_web_session` — and returns the CSRF token once in the body.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const body = await parseStaffJsonBody(request);
    const email = validateStaffEmail(body.email);
    const password = validateStaffPassword(body.password);
    const tenantId = validateOptionalTenantId(body.tenantId);
    const clientIp = getClientIp(request);

    const result = await getStaffAuthService().start({ email, password, tenantId, clientIp });
    const env = loadEnv();

    const response = NextResponse.json(
      {
        data: { csrfToken: result.csrfToken, tenantId: result.tenantId, role: result.role },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
    response.headers.append("Set-Cookie", buildStaffSessionSetCookie(env, result.sessionToken, result.absoluteExpiresAt));
    return response;
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
