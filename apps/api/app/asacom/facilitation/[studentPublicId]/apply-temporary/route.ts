import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateOptionalEnumQueryParam } from "../../../../../lib/staff-validation";
import { getFacilitationService } from "../../../../../lib/staff-identity-context";

const CATEGORY_VALUES = ["PRESENTATION", "TIME_AND_LOAD", "TOOLS", "RESPONSE", "FEEDBACK", "ASSESSMENT", "SUBJECT"] as const;

/**
 * `POST /asacom/facilitation/{studentPublicId}/apply-temporary` (02_26
 * v1.16 §37.6) -- SESSION_ONLY, TOOLS category only, only if already
 * pre-approved in the student's support_profile (02_39 §7.1). No
 * Idempotency-Key (non-persistent effect, scoped to the current session).
 */
export async function POST(request: Request, { params }: { params: Promise<{ studentPublicId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    const { studentPublicId } = await params;
    const body = await parseStaffJsonBody(request);
    const category = validateOptionalEnumQueryParam(typeof body.category === "string" ? body.category : null, CATEGORY_VALUES, "category");
    if (!category) {
      throw new StaffIdentityError("VALIDATION_ERROR", "category is required.");
    }
    const configJson = typeof body.configJson === "object" && body.configJson !== null ? (body.configJson as Record<string, unknown>) : {};

    const applied = await getFacilitationService().asacomApplyTemporary({ identity, studentPublicId, category, configJson });

    return NextResponse.json(
      {
        data: { category: applied.category, level: applied.level, configJson: applied.configJson, expiresAt: applied.expiresAt ? applied.expiresAt.toISOString() : null },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
