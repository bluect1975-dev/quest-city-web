import { NextResponse } from "next/server";
import { StaffIdentityError, assertClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { getSchoolClassRepository } from "../../../lib/staff-identity-context";

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
        data: { classId: schoolClass.id, name: schoolClass.name },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
