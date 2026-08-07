import { NextResponse } from "next/server";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";

/** `GET /me/staff-context` (02_35 §3.2). Minimal profile of the authenticated staff session — tenant, role, class scope. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    return NextResponse.json(
      {
        data: {
          staffAccountId: identity.staffAccountId,
          tenantId: identity.tenantId,
          role: identity.role,
          classScope: identity.classScope,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
