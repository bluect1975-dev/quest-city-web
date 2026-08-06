import { NextResponse } from "next/server";
import { createLogger } from "@quest-city-web/telemetry";

/**
 * Liveness probe: process is up and can serve requests. Deliberately has
 * no dependency on the database or any downstream service — a liveness
 * check that depends on external state defeats its own purpose.
 */
export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? undefined;
  const logger = createLogger(correlationId);
  logger.debug("health/live check", { route: "/health/live" });

  return NextResponse.json(
    { status: "ok", check: "live", timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
