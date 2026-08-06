import { NextResponse } from "next/server";
import { createLogger } from "@quest-city-web/telemetry";
import { checkDatabaseReachable } from "../../../lib/db";

/**
 * Readiness probe: process is up AND its required dependencies (PostgreSQL)
 * are reachable within budget. Fails closed — an unreachable database is a
 * 503, never a silently-degraded 200, matching 07_05 §16's "School Mode
 * valutativo deve fallire chiuso" principle applied to infra health.
 */
export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? undefined;
  const logger = createLogger(correlationId);

  const db = await checkDatabaseReachable();
  if (!db.ok) {
    logger.error("health/ready check failed: database unreachable", {
      route: "/health/ready",
      reason: db.error,
    });
    return NextResponse.json(
      { status: "unavailable", check: "ready", database: "unreachable", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }

  logger.debug("health/ready check ok", { route: "/health/ready" });
  return NextResponse.json(
    { status: "ok", check: "ready", database: "reachable", timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
