import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../lib/env";
import { requireStaffIdentity } from "../../lib/staff-request-context";
import { staffErrorResponse } from "../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../lib/staff-csrf-guard";
import { parseStaffJsonBody, requireIdempotencyKey, validateClassName } from "../../lib/staff-validation";
import { getSchoolClassRepository, getSchoolClassManagementService } from "../../lib/staff-identity-context";

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

/**
 * `POST /classes` (02_35 v1.2 §11bis.6, response shape superseded by
 * OpenAPI v1.10 `SchoolClassCreatedResponse` — 02_26 v1.12 §34.2).
 * SCHOOL_ADMIN-only (class.create). `school_class` is the sole canonical
 * class model. The response now also carries a one-time `accessCode`:
 * the class is immediately usable for student login, no manual seeding.
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
    const name = validateClassName(body.name);

    const result = await getSchoolClassManagementService().create({ identity, name, idempotencyKey });

    return NextResponse.json(
      {
        data: result,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
