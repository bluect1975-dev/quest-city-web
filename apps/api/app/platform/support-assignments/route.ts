import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../lib/env";
import { requireStaffIdentity } from "../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateNonEmptyString, requireIdempotencyKey, validateStaffPaginationQuery, validateOptionalEnumQueryParam } from "../../../lib/staff-validation";
import { getSupportAssignmentService } from "../../../lib/staff-identity-context";

const STATUS_VALUES = ["ACTIVE", "ENDED", "REVOKED"] as const;

function toResponseData(assignment: { id: string; publicId: string; tenantId: string; staffTenantMembershipId: string; studentProfileId: string; classId: string | null; status: string; startsAt: Date; endsAt: Date | null; assignedByStaffAccountId: string; createdAt: Date; revokedAt: Date | null; revokedByStaffAccountId: string | null }) {
  return {
    id: assignment.publicId,
    tenantId: assignment.tenantId,
    staffTenantMembershipId: assignment.staffTenantMembershipId,
    studentProfileId: assignment.studentProfileId,
    classId: assignment.classId,
    status: assignment.status,
    startsAt: assignment.startsAt.toISOString(),
    endsAt: assignment.endsAt ? assignment.endsAt.toISOString() : null,
    assignedByStaffAccountId: assignment.assignedByStaffAccountId,
    createdAt: assignment.createdAt.toISOString(),
    revokedAt: assignment.revokedAt ? assignment.revokedAt.toISOString() : null,
    revokedByStaffAccountId: assignment.revokedByStaffAccountId,
  };
}

/** `POST /platform/support-assignments` (02_26 v1.16 §37.2, renamed from /platform/asacom-assignments). SCHOOL_ADMIN-only (student_support_assignment.manage). */
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
    const staffTenantMembershipId = validateNonEmptyString(body.staffTenantMembershipId, "staffTenantMembershipId");
    const studentPublicId = validateNonEmptyString(body.studentPublicId, "studentPublicId");
    const classId = typeof body.classId === "string" ? body.classId : null;

    const created = await getSupportAssignmentService().create({ identity, staffTenantMembershipId, studentPublicId, classId, idempotencyKey });

    return NextResponse.json(
      { data: toResponseData(created), meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}

/** `GET /platform/support-assignments` (02_26 v1.16 §37.2). Paginated, filterable by staffAccountId/studentPublicId/status. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const url = new URL(request.url);
    const pagination = validateStaffPaginationQuery(url);
    const status = validateOptionalEnumQueryParam(url.searchParams.get("status"), STATUS_VALUES, "status");
    const staffAccountId = url.searchParams.get("staffAccountId") ?? undefined;
    const studentPublicId = url.searchParams.get("studentPublicId") ?? undefined;

    const items = await getSupportAssignmentService().list(identity, { staffAccountId, studentPublicId, status }, pagination);

    return NextResponse.json(
      { data: items.map(toResponseData), meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
