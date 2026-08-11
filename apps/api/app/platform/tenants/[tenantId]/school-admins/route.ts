import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../../../lib/platform-error-response";
import { getSchoolAdminActivationService } from "../../../../../lib/platform-identity-context";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../../../lib/platform-csrf-guard";
import { parsePlatformJsonBody, validatePlatformEmail } from "../../../../../lib/platform-validation";

/**
 * `POST /platform/tenants/{tenantId}/school-admins` (capability
 * `school_admin.activate`). Preserves ONE HUMAN -> ONE PLATFORM IDENTITY
 * (02_38 §9): reuses an existing `staff_account` by email rather than
 * ever duplicating it. `temporaryPassword` is present only when a
 * brand-new identity was created, returned exactly once.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    if (!isTrustedPlatformOrigin(request, env) || !isValidPlatformCsrfToken(request, identity)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    const { tenantId } = await params;
    const body = await parsePlatformJsonBody(request);
    const email = validatePlatformEmail(body.email);

    const result = await getSchoolAdminActivationService().activate(identity, { tenantId, email });

    return NextResponse.json(
      {
        data: {
          staffAccountId: result.staffAccountId,
          email: result.email,
          temporaryPassword: result.temporaryPassword ?? null,
          identityReused: result.identityReused,
          reactivated: result.reactivated,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
