import { NextResponse } from "next/server";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { getConvergenceRequestService } from "../../../lib/staff-identity-context";
import { toConvergenceRequestSummary } from "../../../lib/convergence-serialization";

/** `GET /convergence-requests/{id}` (02_26 v1.14 §36.3). Party-scoped read (source or target tenant of the caller's session). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { id } = await params;

    const result = await getConvergenceRequestService().getByIdForStaff(identity, id);

    return NextResponse.json(
      {
        data: toConvergenceRequestSummary(result),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
