import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { PlatformAdminError, type ErrorEnvelope } from "@quest-city-web/platform-admin";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { createLogger } from "@quest-city-web/telemetry";

/**
 * Maps a thrown error to the ErrorEnvelope response body (domain
 * `PLATFORM`, same shape as `staffErrorResponse`/`attemptErrorResponse`).
 * Also handles `StaffIdentityError` (`TENANT_SUSPENDED` in particular)
 * since `TenantStatusService`'s own callers never throw it, but a
 * platform route composing staff-identity repositories directly could.
 */
export function platformErrorResponse(error: unknown, correlationId?: string | null): NextResponse {
  const requestId = correlationId ?? randomUUID();

  if (error instanceof PlatformAdminError || error instanceof StaffIdentityError) {
    const envelope = error.toEnvelope(requestId);
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds !== undefined) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(envelope, { status: envelope.httpStatus, headers });
  }

  const logger = createLogger(requestId);
  logger.error("unhandled error in platform route", {
    message: error instanceof Error ? error.message : String(error),
  });
  const envelope: ErrorEnvelope = {
    domain: "PLATFORM",
    code: "INTERNAL_ERROR",
    httpStatus: 500,
    message: "Unexpected error",
    correlationId: requestId,
    retryable: false,
  };
  return NextResponse.json(envelope, { status: 500 });
}
