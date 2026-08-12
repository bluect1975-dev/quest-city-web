import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../lib/env";
import { requireStaffIdentity } from "../../lib/staff-request-context";
import { staffErrorResponse } from "../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../lib/staff-csrf-guard";
import {
  parseStaffJsonBody,
  requireIdempotencyKey,
  validateNonEmptyString,
  validateAssignmentTitle,
  validateAllowedRuntimeChannels,
  validateOptionalDateTime,
} from "../../lib/staff-validation";
import { getGeneralAssignmentService } from "../../lib/staff-identity-context";

/**
 * `POST /assignments` (02_35 v1.2 §11bis.8-§11bis.9). assignment.create.
 * The second, narrowly-scoped exception to AGENTS.md rule 16 (§4.21) —
 * limited to assigning already-PUBLISHED content, distinct from and not
 * a replacement for recovery-assignment.
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
    const classId = validateNonEmptyString(body.classId, "classId");
    const contentBundleId = validateNonEmptyString(body.contentBundleId, "contentBundleId");
    const title = validateAssignmentTitle(body.title);
    const allowedRuntimeChannels = validateAllowedRuntimeChannels(body.allowedRuntimeChannels);
    const opensAt = validateOptionalDateTime(body.opensAt, "opensAt");
    const dueAt = validateOptionalDateTime(body.dueAt, "dueAt");

    const result = await getGeneralAssignmentService().create({
      identity,
      classId,
      contentBundleId,
      title,
      allowedRuntimeChannels,
      opensAt,
      dueAt,
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
