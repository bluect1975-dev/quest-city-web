import { NextResponse } from "next/server";
import { loadEnv } from "../../lib/env";
import { requireStaffIdentity } from "../../lib/staff-request-context";
import { staffErrorResponse } from "../../lib/staff-error-response";
import { getSchoolClassRepository } from "../../lib/staff-identity-context";

/** `GET /classes` (02_35 §5, §3.2). TEACHER sees its explicit class scope; SCHOOL_ADMIN sees the whole tenant. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const classes = getSchoolClassRepository();

    const schoolClasses =
      identity.role === "TEACHER"
        ? await classes.findByIds(identity.classScope ?? [], identity.tenantId)
        : await classes.findByTenant(identity.tenantId);

    return NextResponse.json(
      {
        data: schoolClasses.map((c) => ({ classId: c.id, name: c.name })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
