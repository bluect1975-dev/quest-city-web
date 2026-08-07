import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { createLogger } from "@quest-city-web/telemetry";

/**
 * Maps a thrown error to the API's standard `{data|error, meta}` envelope
 * (02_26 §4, `contracts/quest-city-platform-openapi-v1_3.yaml` examples).
 * An unrecognized error is logged with full detail server-side but never
 * leaks its message to the client — only a generic `INTERNAL_ERROR`.
 */
export function identityErrorResponse(error: unknown, correlationId?: string | null): NextResponse {
  const requestId = correlationId ?? randomUUID();
  if (error instanceof IdentityError) {
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds !== undefined) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(
      { error: { code: error.code, message: error.message }, meta: { request_id: requestId, api_version: "v1" } },
      { status: error.httpStatus, headers },
    );
  }

  const logger = createLogger(requestId);
  logger.error("unhandled error in web-auth route", {
    message: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Unexpected error" }, meta: { request_id: requestId, api_version: "v1" } },
    { status: 500 },
  );
}
