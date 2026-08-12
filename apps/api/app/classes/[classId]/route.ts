import { NextResponse } from "next/server";
import { StaffIdentityError, assertClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, requireIdempotencyKey, validateClassName } from "../../../lib/staff-validation";
import { getSchoolClassRepository, getSchoolClassManagementService } from "../../../lib/staff-identity-context";

/** `GET /classes/{classId}` (02_35 §5). Read-only. */
export async function GET(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { classId } = await params;
    assertClassInScope(identity, classId);

    const schoolClass = await getSchoolClassRepository().findById(classId, identity.tenantId);
    if (!schoolClass) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }

    return NextResponse.json(
      {
        data: {
          classId: schoolClass.id,
          name: schoolClass.name,
          status: schoolClass.status,
          createdAt: schoolClass.createdAt.toISOString(),
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}

/** `PATCH /classes/{classId}` (02_35 v1.2 §11bis.6). class.manage. */
export async function PATCH(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { classId } = await params;
    const body = await parseStaffJsonBody(request);
    const name = validateClassName(body.name);

    const result = await getSchoolClassManagementService().update({ identity, classId, name, idempotencyKey });

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
