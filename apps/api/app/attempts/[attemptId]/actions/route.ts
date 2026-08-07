import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { validateAgainst } from "@quest-city-web/content-schema";
import { getSessionService } from "../../../../lib/identity-context";
import { getLearningAttemptRepository, getSemanticActionLogRepository } from "../../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../../lib/attempt-error-response";
import { readSessionToken } from "../../../../lib/session-cookie";
import { getCsrfTokenHeader, isTrustedOrigin } from "../../../../lib/csrf-guard";
import { loadEnv } from "../../../../lib/env";
import type { ErrorEnvelope } from "@quest-city-web/attempts";

/**
 * `POST /attempts/{attemptId}/actions` (02_26 v1.6 §18.3). Dedup by
 * (attemptId, actionId) and (attemptId, clientSequence) — no
 * Idempotency-Key header on this endpoint (AGENTS.md v4.30, one
 * idempotency mechanism per operation).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const { attemptId } = await params;
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    const csrfToken = getCsrfTokenHeader(request);
    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }
    if (!isTrustedOrigin(request, env) || !csrfToken) {
      throw new IdentityError("CSRF_INVALID");
    }

    const body = await request.json().catch(() => null);
    const validation = body ? validateAgainst("semanticAction", body) : { valid: false, errors: ["missing body"] };
    if (!validation.valid) {
      return contentRuntimeError(correlationId, "SEMANTIC_ACTION_INVALID", 422, validation.errors.join("; "), false);
    }
    const action = body as {
      actionId: string;
      attemptId: string;
      activityId: string;
      actionType: string;
      targetRole?: string;
      payload: Record<string, unknown>;
      clientSequence: number;
      runtimeChannel: "WEB" | "ROBLOX";
      adapterVersion?: string;
      occurredAt: string;
    };

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const attempts = getLearningAttemptRepository();
    const actions = getSemanticActionLogRepository();

    const attempt = await attempts.findByIdAndTenant(attemptId, identity.tenantId);
    if (!attempt || attempt.studentProfileId !== identity.studentProfileId) {
      return NextResponse.json(
        { domain: "PLATFORM", code: "RESOURCE_NOT_FOUND", httpStatus: 404, message: "Attempt not found", correlationId: correlationId ?? "", retryable: false } satisfies ErrorEnvelope,
        { status: 404 },
      );
    }

    // Dedup first — a legitimate retry of an already-logged action_id is
    // accepted idempotently, never a unique-constraint error surfaced to
    // the client.
    const alreadyLogged = await actions.findByAttemptAndActionId(attemptId, identity.tenantId, action.actionId);
    if (alreadyLogged) {
      return NextResponse.json(
        { data: { actionId: alreadyLogged.actionId, accepted: true }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
        { status: 202 },
      );
    }

    if (attempt.attemptState === "CREATED") {
      await attempts.transitionToInProgress(attemptId, identity.tenantId);
    } else if (attempt.attemptState !== "IN_PROGRESS") {
      // CONTENT_RUNTIME domain (07_08 §18 ATTEMPT_RUNTIME_MISMATCH) — not
      // implemented as a package export (out of WEB-M2 scope, see
      // docs/adr/0003); constructed inline here, the one call site that
      // needs it.
      return contentRuntimeError(
        correlationId,
        "ATTEMPT_RUNTIME_MISMATCH",
        409,
        `Attempt is ${attempt.attemptState}, not accepting new actions.`,
        false,
      );
    }

    const inserted = await actions.insert({
      tenantId: identity.tenantId,
      attemptId,
      actionId: action.actionId,
      actionType: action.actionType as never,
      targetRole: action.targetRole ?? null,
      payload: action.payload,
      clientSequence: action.clientSequence,
      runtimeChannel: action.runtimeChannel,
      adapterVersion: action.adapterVersion ?? null,
      occurredAt: new Date(action.occurredAt),
    });

    return NextResponse.json(
      { data: { actionId: inserted.actionId, accepted: true }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 202 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}

function contentRuntimeError(
  correlationId: string | null,
  code: string,
  httpStatus: number,
  message: string,
  retryable: boolean,
): NextResponse {
  const envelope: ErrorEnvelope = {
    domain: "CONTENT_RUNTIME",
    code,
    httpStatus,
    message,
    correlationId: correlationId ?? "",
    retryable,
  };
  return NextResponse.json(envelope, { status: httpStatus });
}
