import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { CrossRuntimeError, type ErrorEnvelope } from "@quest-city-web/attempts";
import { createLogger } from "@quest-city-web/telemetry";

/**
 * Maps a thrown error to the WEB-M2 ErrorEnvelope response body (02_26
 * v1.6 §18.7) — `domain`/`code`/`httpStatus`/`message`/`correlationId`/
 * `retryable`/`safeDetails?`, distinct from WEB-M1's `{error,meta}` shape.
 * `IdentityError` (session/CSRF failures on these authenticated routes)
 * maps into the PLATFORM domain. An unrecognized error is logged with
 * full detail server-side but never leaks its message to the client.
 */
export function attemptErrorResponse(error: unknown, correlationId?: string | null): NextResponse {
  const requestId = correlationId ?? randomUUID();

  if (error instanceof CrossRuntimeError) {
    const envelope = error.toEnvelope(requestId);
    return NextResponse.json(envelope, { status: envelope.httpStatus });
  }

  if (error instanceof IdentityError) {
    const envelope: ErrorEnvelope = {
      domain: "PLATFORM",
      code: error.code,
      httpStatus: error.httpStatus,
      message: error.message,
      correlationId: requestId,
      retryable: error.code === "RATE_LIMITED",
    };
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds !== undefined) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(envelope, { status: error.httpStatus, headers });
  }

  const logger = createLogger(requestId);
  logger.error("unhandled error in attempts route", {
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
