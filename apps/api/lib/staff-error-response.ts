import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { StaffIdentityError, type ErrorEnvelope } from "@quest-city-web/staff-identity";
import { createLogger } from "@quest-city-web/telemetry";

/**
 * Maps a thrown error to the WEB-M3B ErrorEnvelope response body (02_26
 * v1.8 §31.8, 02_35 §13) — same shape as `attemptErrorResponse` (02_26
 * v1.6 §18.7), a separate function per staff-facing routes since
 * `StaffIdentityError` is a distinct class from `CrossRuntimeError`/
 * `IdentityError`. `retryAfterSeconds`, when present, becomes the
 * `Retry-After` header (RATE_LIMITED).
 */
export function staffErrorResponse(error: unknown, correlationId?: string | null): NextResponse {
  const requestId = correlationId ?? randomUUID();

  if (error instanceof StaffIdentityError) {
    const envelope = error.toEnvelope(requestId);
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds !== undefined) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(envelope, { status: envelope.httpStatus, headers });
  }

  const logger = createLogger(requestId);
  logger.error("unhandled error in staff route", {
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
