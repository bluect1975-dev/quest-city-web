import { NextResponse } from "next/server";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { requirePlatformAdminIdentity } from "../../../lib/platform-request-context";
import { readPlatformSessionToken } from "../../../lib/platform-session-cookie";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { platformErrorResponse } from "../../../lib/platform-error-response";
import { getConvergenceRequestService } from "../../../lib/staff-identity-context";
import { toConvergenceRequestSummary, toConvergenceRequestSummaryWithPlan } from "../../../lib/convergence-serialization";

/**
 * `GET /convergence-requests/{id}` (02_26 v1.14 §36.3, OpenAPI v1.12
 * operationId getConvergenceRequest -- one declared path, one operation).
 * Dual-auth by design, not by accident: the canonical contract's
 * `convergence.read` capability is held by BOTH the staff party
 * (INDEPENDENT_EDUCATOR/SCHOOL_ADMIN, party-scoped) AND PLATFORM_ADMIN
 * (cross-tenant, `getByIdForPlatformAdmin` -- already implemented and
 * covered by tests/integration/account-tenant-convergence-security.test.ts,
 * but never wired to an HTTP route before this fix: the Platform Admin
 * dashboard page called this exact path expecting it to work with only a
 * platform session cookie, which `requireStaffIdentity` alone can never
 * satisfy). Branches on which session cookie is actually present rather
 * than on caller-supplied input, so this cannot be used to escalate --
 * same discipline as every other identity resolution in this codebase.
 * The staff branch additionally includes `migrationPlan` (see
 * `toConvergenceRequestSummaryWithPlan`) for the per-class approval UI;
 * platform admin already has full plan detail via `POST .../preview`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  const env = loadEnv();
  const { id } = await params;

  if (readPlatformSessionToken(request, env)) {
    try {
      const identity = await requirePlatformAdminIdentity(request, env);
      const result = await getConvergenceRequestService().getByIdForPlatformAdmin(identity, id);
      return NextResponse.json(
        {
          data: toConvergenceRequestSummary(result),
          meta: { request_id: correlationId ?? undefined, api_version: "v1" },
        },
        { status: 200 },
      );
    } catch (error) {
      return platformErrorResponse(error, correlationId);
    }
  }

  try {
    const identity = await requireStaffIdentity(request, env);
    const result = await getConvergenceRequestService().getByIdForStaffWithPlan(identity, id);

    return NextResponse.json(
      {
        data: toConvergenceRequestSummaryWithPlan(result.request, result.migrationPlan),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
