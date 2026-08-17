import { NextResponse } from "next/server";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../../lib/env";
import { requireStaffIdentity } from "../../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../../lib/staff-error-response";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../../../lib/staff-csrf-guard";
import { parseStaffJsonBody, validateOptionalEnumQueryParam } from "../../../../../lib/staff-validation";
import { getFacilitationService } from "../../../../../lib/staff-identity-context";

const CATEGORY_VALUES = ["PRESENTATION", "TIME_AND_LOAD", "TOOLS", "RESPONSE", "FEEDBACK", "ASSESSMENT", "SUBJECT"] as const;
const LEVEL_VALUES = ["SESSION_ONLY", "PROFILE_LEVEL"] as const;

/**
 * `POST /support-teacher/facilitation/{studentPublicId}/apply` (02_26
 * v1.16 §37.6, new v1.16) -- SESSION_ONLY or PROFILE_LEVEL, any of the
 * seven categories, own assigned students only (02_39 §7.1).
 * Idempotency-Key required only for PROFILE_LEVEL.
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
    const level = validateOptionalEnumQueryParam(typeof body.level === "string" ? body.level : null, LEVEL_VALUES, "level");
    if (!category || !level) {
      throw new StaffIdentityError("VALIDATION_ERROR", "category and level are required.");
    }
    const configJson = typeof body.configJson === "object" && body.configJson !== null ? (body.configJson as Record<string, unknown>) : {};
    const idempotencyKey = level === "PROFILE_LEVEL" ? request.headers.get("idempotency-key") ?? undefined : undefined;
    if (level === "PROFILE_LEVEL" && (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128)) {
      throw new StaffIdentityError("VALIDATION_ERROR", "Idempotency-Key header is required (16-128 chars) for PROFILE_LEVEL apply.");
    }

    const applied = await getFacilitationService().supportTeacherApply({ identity, studentPublicId, category, level, configJson, idempotencyKey });

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
