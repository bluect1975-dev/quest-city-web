import { NextResponse } from "next/server";
import { loadEnv } from "../../lib/env";
import { requireStaffIdentity } from "../../lib/staff-request-context";
import { staffErrorResponse } from "../../lib/staff-error-response";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../lib/staff-csrf-guard";
import {
  parseStaffJsonBody,
  requireIdempotencyKey,
  validateStaffPaginationQuery,
  validateNonEmptyString,
  validateOptionalString,
} from "../../lib/staff-validation";
import { getConvergenceRequestService } from "../../lib/staff-identity-context";
import { toConvergenceRequestSummary, toConvergenceRequestSummaryList } from "../../lib/convergence-serialization";

/** `GET /convergence-requests` (02_38 v1.4 §10.3, 02_26 v1.14 §36.3). Party-scoped list: source tenant for INDEPENDENT_EDUCATOR, target tenant for SCHOOL_ADMIN. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { limit, offset } = validateStaffPaginationQuery(new URL(request.url));

    const requests = await getConvergenceRequestService().listForStaff(identity, { limit, offset });

    return NextResponse.json(
      {
        data: toConvergenceRequestSummaryList(requests),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}

/**
 * `POST /convergence-requests` (02_38 v1.4 §10.3, 02_26 v1.14 §36.2).
 * INDEPENDENT_EDUCATOR initiates on their own source tenant, or
 * SCHOOL_ADMIN initiates on their own target tenant (and must then also
 * supply `educatorStaffAccountId`) -- enforced inside the service, this
 * route only authenticates and passes the identity through.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const body = await parseStaffJsonBody(request);
    const sourceTenantId = validateNonEmptyString(body.sourceTenantId, "sourceTenantId");
    const targetTenantId = validateNonEmptyString(body.targetTenantId, "targetTenantId");
    const educatorStaffAccountId = validateOptionalString(body.educatorStaffAccountId, "educatorStaffAccountId", 200);

    const result = await getConvergenceRequestService().create(identity, {
      sourceTenantId,
      targetTenantId,
      ...(educatorStaffAccountId !== undefined ? { educatorStaffAccountId } : {}),
      idempotencyKey,
    });

    return NextResponse.json(
      {
        data: toConvergenceRequestSummary(result),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
