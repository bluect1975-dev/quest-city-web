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
import { getSchoolEnrollmentRepository, getRosterManagementService, getStudentProfileRepository } from "../../../../lib/staff-identity-context";

/**
 * `GET /classes/{classId}/students` (02_35 §5). Read-only roster — no
 * student access credentials (PIN hash, class access code) are ever
 * projected into the response. `studentPublicId` (GLPC, 02_41 v1.1,
 * contracts/quest-city-platform-openapi-v1_15.yaml) is an additive field
 * -- the roster's own `studentProfileId` stays the internal id it always
 * was, unchanged; `studentPublicId` is added so the dashboard can link
 * into the `studentPublicId`-keyed GLPC student preview/customization
 * surface without a second roster lookup.
 */
export async function GET(request: Request, { params }: { params: Promise<{ classId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { classId } = await params;
    assertClassInScope(identity, classId);

    const enrollments = await getSchoolEnrollmentRepository().findByClass(classId, identity.tenantId);
    const students = await getStudentProfileRepository().findByIds(
      enrollments.map((e) => e.studentProfileId),
      identity.tenantId,
    );
    const publicIdByProfileId = new Map(students.map((s) => [s.id, s.studentPublicId]));

    return NextResponse.json(
      {
        data: enrollments.map((e) => ({
          studentProfileId: e.studentProfileId,
          studentPublicId: publicIdByProfileId.get(e.studentProfileId) ?? null,
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
