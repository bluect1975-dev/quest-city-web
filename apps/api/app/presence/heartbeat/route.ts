import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { PlatformAdminError, type ErrorEnvelope } from "@quest-city-web/platform-admin";
import { StaffIdentityError } from "@quest-city-web/staff-identity";
import { IdentityError, checkFixedWindow, type RateLimitDimension } from "@quest-city-web/identity";
import { createLogger } from "@quest-city-web/telemetry";
import { loadEnv } from "../../../lib/env";
import { readSessionToken } from "../../../lib/session-cookie";
import { getCsrfTokenHeader, isTrustedOrigin } from "../../../lib/csrf-guard";
import { getSessionService } from "../../../lib/identity-context";
import { readStaffSessionToken } from "../../../lib/staff-session-cookie";
import { isValidStaffCsrfToken, isTrustedStaffOrigin } from "../../../lib/staff-csrf-guard";
import { getStaffAuthService } from "../../../lib/staff-identity-context";
import { readPlatformSessionToken } from "../../../lib/platform-session-cookie";
import { isValidPlatformCsrfToken, isTrustedPlatformOrigin } from "../../../lib/platform-csrf-guard";
import { getPlatformAuthService } from "../../../lib/platform-identity-context";
import { getPresenceService } from "../../../lib/operations-context";
import { getPlatformAdminPoolForQueries } from "../../../lib/platform-identity-context";

const HEARTBEAT_RATE_LIMIT: RateLimitDimension = { scope: "PRESENCE_HEARTBEAT_ACTOR", limit: 30, windowMs: 60 * 1000 };

function heartbeatErrorResponse(error: unknown, correlationId?: string | null): NextResponse {
  const requestId = correlationId ?? randomUUID();

  if (error instanceof PlatformAdminError || error instanceof StaffIdentityError) {
    const envelope = error.toEnvelope(requestId);
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds !== undefined) headers["Retry-After"] = String(error.retryAfterSeconds);
    return NextResponse.json(envelope, { status: envelope.httpStatus, headers });
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
    if (error.retryAfterSeconds !== undefined) headers["Retry-After"] = String(error.retryAfterSeconds);
    return NextResponse.json(envelope, { status: error.httpStatus, headers });
  }

  const logger = createLogger(requestId);
  logger.error("unhandled error in presence heartbeat route", {
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

interface ResolvedHeartbeatActor {
  actorType: "STUDENT" | "STAFF" | "PLATFORM_ADMIN";
  actorId: string;
  tenantId: string | null;
}

/**
 * `POST /presence/heartbeat` (02_42 v1.1 §15, contracts/quest-city-platform-openapi-v1_18.yaml
 * `1.18.0`). Server-side actor resolution: tries each of the three
 * session cookies in turn (whichever is actually present), resolving
 * actorType/actorId/tenantId exclusively from the validated session --
 * the request body never declares the actor, closing the "heartbeat for
 * another user" spoof vector by construction (mission §11). CSRF is
 * required using whichever CSRF mechanism corresponds to the session
 * domain that authenticated the request -- same per-domain check every
 * other mutating endpoint in that domain already uses, not a new one.
 */
async function resolveActor(request: Request, env: ReturnType<typeof loadEnv>): Promise<ResolvedHeartbeatActor> {
  const platformToken = readPlatformSessionToken(request, env);
  if (platformToken) {
    const identity = await getPlatformAuthService().resolveIdentity(platformToken);
    if (!isTrustedPlatformOrigin(request, env) || !isValidPlatformCsrfToken(request, identity)) {
      throw new PlatformAdminError("PLATFORM_FORBIDDEN", "CSRF token non valido.");
    }
    return { actorType: "PLATFORM_ADMIN", actorId: identity.staffAccountId, tenantId: null };
  }

  const staffToken = readStaffSessionToken(request, env);
  if (staffToken) {
    const identity = await getStaffAuthService().resolveInternalIdentity(staffToken);
    if (!isTrustedStaffOrigin(request, env) || !isValidStaffCsrfToken(request, identity)) {
      throw new StaffIdentityError("STAFF_FORBIDDEN", "CSRF token non valido.");
    }
    return { actorType: "STAFF", actorId: identity.staffAccountId, tenantId: identity.tenantId };
  }

  const studentToken = readSessionToken(request, env);
  if (studentToken) {
    const identity = await getSessionService().resolveInternalIdentity(studentToken);
    const csrfToken = getCsrfTokenHeader(request);
    if (!isTrustedOrigin(request, env) || !csrfToken) {
      throw new IdentityError("CSRF_INVALID");
    }
    return { actorType: "STUDENT", actorId: identity.studentProfileId, tenantId: identity.tenantId };
  }

  throw new PlatformAdminError("PLATFORM_AUTH_REQUIRED", "No valid session of any domain was presented.");
}

export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const actor = await resolveActor(request, env);

    const rateLimit = await checkFixedWindow(getPlatformAdminPoolForQueries(), HEARTBEAT_RATE_LIMIT, `${actor.actorType}:${actor.actorId}`);
    if (!rateLimit.allowed) {
      throw new PlatformAdminError("RATE_LIMITED", "presence/heartbeat rate limit exceeded", {
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    await getPresenceService().heartbeat(actor.actorType, actor.actorId, actor.tenantId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return heartbeatErrorResponse(error, correlationId);
  }
}
