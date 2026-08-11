import { NextResponse } from "next/server";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { loadEnv } from "../../../lib/env";
import { requirePlatformAdminIdentity } from "../../../lib/platform-request-context";
import { platformErrorResponse } from "../../../lib/platform-error-response";
import { getTenantProvisioningService } from "../../../lib/platform-identity-context";
import { isTrustedPlatformOrigin, isValidPlatformCsrfToken } from "../../../lib/platform-csrf-guard";
import {
  parsePlatformJsonBody,
  validateTenantName,
  validatePaginationQuery,
  requirePlatformIdempotencyKey,
} from "../../../lib/platform-validation";

/** `GET /platform/tenants` (capability `tenant.read`). Paginated list, no didactic data. */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requirePlatformAdminIdentity(request, env);
    const { limit, offset } = validatePaginationQuery(new URL(request.url));

    const tenants = await getTenantProvisioningService().listTenants(identity, { limit, offset });

    return NextResponse.json(
      {
        data: tenants.map((t) => ({
          id: t.id,
          publicId: t.publicId,
          type: t.type,
          status: t.status,
          name: t.name,
          createdAt: t.createdAt.toISOString(),
        })),
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}

/**
 * `POST /platform/tenants` (capability `tenant.create`). Creates only the
 * tenant row -- no classes/students/demo content. Critical write,
 * `Idempotency-Key` required (02_26 v1.10 §32.4): a retry with the same
 * key and the same payload replays this exact 201 response, byte-for-byte
 * -- no second tenant is ever created.
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
    const name = validateTenantName(body.name);

    const result = await getTenantProvisioningService().createSchoolTenant(identity, { name, idempotencyKey });

    return NextResponse.json(
      {
        data: result,
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 201 },
    );
  } catch (error) {
    return platformErrorResponse(error, correlationId);
  }
}
