import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CORRELATION_HEADER = "x-correlation-id";

/**
 * Assigns a correlation ID to every request (07_05 §12, deliverable 18:
 * "logging strutturato con correlation ID"). Reuses an inbound ID if a
 * trusted upstream (e.g. the reverse proxy) already set one, otherwise
 * mints a new one so every request is traceable end-to-end.
 */
export function proxy(request: NextRequest) {
  const incomingId = request.headers.get(CORRELATION_HEADER);
  const correlationId = incomingId && incomingId.length > 0 ? incomingId : randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(CORRELATION_HEADER, correlationId);
  return response;
}

export const config = {
  matcher: "/:path*",
};
