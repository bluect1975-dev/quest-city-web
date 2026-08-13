import { NextResponse } from "next/server";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { getTenantContextService } from "../../../lib/staff-identity-context";

/** `GET /me/tenant-memberships` (02_35 v1.5 §11quater.5, 02_26 v1.14 §36.9). Every ACTIVE tenant membership of the authenticated staff account -- no capability check, valid session only. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);

    const memberships = await getTenantContextService().listMyMemberships(identity);

    return NextResponse.json(
      {
        data: memberships,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
