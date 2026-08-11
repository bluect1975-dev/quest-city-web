import { NextResponse } from "next/server";
import { StaffIdentityError, assertClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../lib/staff-csrf-guard";
import {
  parseStaffJsonBody,
  requireIdempotencyKey,
  validateRosterMode,
  validateNonEmptyString,
  validateOptionalString,
} from "../../../../lib/staff-validation";
import { getSchoolEnrollmentRepository, getRosterManagementService } from "../../../../lib/staff-identity-context";

/**
 * `GET /classes/{classId}/students` (02_35 §5). Read-only roster — no
 * student access credentials (PIN hash, class access code) are ever
 * projected into the response.
 */
export async function GET(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { classId } = await params;
    assertClassInScope(identity, classId);

    const enrollments = await getSchoolEnrollmentRepository().findByClass(classId, identity.tenantId);

    return NextResponse.json(
      {
        data: enrollments.map((e) => ({
          studentProfileId: e.studentProfileId,
          accessAlias: e.accessAlias,
          enrollmentStatus: e.status,
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}

/** `POST /classes/{classId}/students` (02_35 v1.2 §11bis.7). roster.manage. mode=NEW creates a fresh student_profile; mode=EXISTING attaches an operator-named existing one. */
export async function POST(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
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
    const mode = validateRosterMode(body.mode);
    const studentPublicId = validateOptionalString(body.studentPublicId, "studentPublicId", 128);
    const accessAlias = validateNonEmptyString(body.accessAlias, "accessAlias");
    const pin = validateOptionalString(body.pin, "pin", 32);

    const result = await getRosterManagementService().addStudent({
      identity,
      classId,
      mode,
      studentPublicId,
      accessAlias,
      pin,
      idempotencyKey,
    });

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
