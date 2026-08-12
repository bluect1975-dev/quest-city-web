import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../lib/platform-error-response";
import { getIndependentEducatorActivationService } from "../../../lib/platform-identity-context";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../lib/platform-csrf-guard";
import {
  parsePlatformJsonBody,
  validatePlatformEmail,
  validateTenantName,
  validatePaginationQuery,
  requirePlatformIdempotencyKey,
} from "../../../lib/platform-validation";

/** `GET /platform/independent-educators` (capability `independent_educator.read`). Paginated list, no didactic data. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    const { limit, offset } = validatePaginationQuery(new URL(request.url));

    const educators = await getIndependentEducatorActivationService().list(identity, { limit, offset });

    return NextResponse.json(
      {
        data: educators,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}

/**
 * `POST /platform/independent-educators` (capability
 * `independent_educator.activate`). Identity resolution (reuse or
 * create), tenant provisioning (`type=INDEPENDENT_EDUCATOR`, no
 * classes/students/demo content), membership creation
 * (`role=INDEPENDENT_EDUCATOR`, `status=ACTIVE`), credential bootstrap,
 * audit, in a single transaction. Critical write, `Idempotency-Key`
 * required (02_26 v1.13 §35.9): a retry with the same key and the same
 * payload replays this exact 201 response, byte-for-byte -- no second
 * tenant or membership is ever created.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    if (!isTrustedPlatformOrigin(request, env) || !isValidPlatformCsrfToken(request, identity)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    const idempotencyKey = requirePlatformIdempotencyKey(request);
    const body = await parsePlatformJsonBody(request);
    const email = validatePlatformEmail(body.email);
    const tenantName = validateTenantName(body.tenantName);

    const result = await getIndependentEducatorActivationService().activate(identity, {
      email,
      tenantName,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        data: {
          tenantId: result.tenantId,
          tenantPublicId: result.tenantPublicId,
          staffAccountId: result.staffAccountId,
          email: result.email,
          temporaryPassword: result.temporaryPassword ?? null,
          identityReused: result.identityReused,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
