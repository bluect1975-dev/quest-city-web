import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { parseSequenceRuntimeState } from "@quest-city-web/content-runtime";
import { SequenceRuntimeStateAlreadyExistsError, type ErrorEnvelope } from "@quest-city-web/attempts";
import { getSessionService } from "../../../../lib/identity-context";
import { getSequenceRuntimeStateRepository, getLearningAttemptRepository } from "../../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../../lib/attempt-error-response";
import { readSessionToken } from "../../../../lib/session-cookie";
import { getCsrfTokenHeader, isTrustedOrigin } from "../../../../lib/csrf-guard";
import { loadEnv } from "../../../../lib/env";

/**
 * `GET/POST/PUT /attempts/{attemptId}/sequence-runtime-state` (R3C.3;
 * re-scoped from `/sequence-runtime-state/{sequenceId}` by migration 0019
 * — UAT Failure Remediation, `UAT-RC4-NEW-ASSIGNMENT-LAUNCH-STATE-01`).
 * Load, create and version-guarded save of a student's durable
 * `SequenceRuntimeState`. Ownership is always the server-resolved
 * `resolveInternalIdentity` triple PLUS a real `learning_attempt` row this
 * identity owns — `attemptId` in the URL selects which attempt's runtime
 * state, and every request re-verifies that attempt actually belongs to
 * the caller (same 404-on-mismatch pattern as
 * `POST /attempts/{attemptId}/complete`) before touching any state, so a
 * student can never read or write another student's — or another
 * attempt's — progress by guessing an id.
 */
async function resolveOwnedAttempt(
  attemptId: string,
  tenantId: string,
  studentProfileId: string,
): Promise<{ id: string } | null> {
  const attempt = await getLearningAttemptRepository().findByIdAndTenant(attemptId, tenantId);
  if (!attempt || attempt.studentProfileId !== studentProfileId) {
    return null;
  }
  return { id: attempt.id };
}

export async function GET(request: Request, { params }: { params: Promise<{ attemptId: string }> }): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const { attemptId } = await params;
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const attempt = await resolveOwnedAttempt(attemptId, identity.tenantId, identity.studentProfileId);
    if (!attempt) {
      return contentRuntimeError(correlationId, "RESOURCE_NOT_FOUND", 404, "Attempt not found.", false);
    }

    const persisted = await getSequenceRuntimeStateRepository().findByAttempt(identity.tenantId, attempt.id);
    if (!persisted) {
      return contentRuntimeError(correlationId, "SEQUENCE_RUNTIME_STATE_NOT_FOUND", 404, "No runtime state yet for this attempt.", false);
    }

    return NextResponse.json(
      { data: { state: persisted.state, version: persisted.version }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ attemptId: string }> }): Promise<NextResponse> {
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
    const stateCandidate = body && typeof body === "object" ? (body as { state?: unknown }).state : undefined;
    const parsed = stateCandidate !== undefined ? parseSequenceRuntimeState(stateCandidate) : { valid: false as const, errors: ["missing body.state"] };
    if (!parsed.valid) {
      return contentRuntimeError(correlationId, "SEQUENCE_RUNTIME_STATE_INVALID", 422, parsed.errors.join("; "), false);
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const attempt = await resolveOwnedAttempt(attemptId, identity.tenantId, identity.studentProfileId);
    if (!attempt) {
      return contentRuntimeError(correlationId, "RESOURCE_NOT_FOUND", 404, "Attempt not found.", false);
    }

    try {
      const created = await getSequenceRuntimeStateRepository().create({
        tenantId: identity.tenantId,
        studentProfileId: identity.studentProfileId,
        enrollmentId: identity.enrollmentId,
        learningAttemptId: attempt.id,
        state: parsed.data,
      });
      return NextResponse.json(
        { data: { state: created.state, version: created.version }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
        { status: 201 },
      );
    } catch (error) {
      if (error instanceof SequenceRuntimeStateAlreadyExistsError) {
        return contentRuntimeError(
          correlationId,
          "SEQUENCE_RUNTIME_STATE_ALREADY_EXISTS",
          409,
          "A runtime state already exists for this attempt — GET it and PUT to update instead.",
          false,
        );
      }
      throw error;
    }
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ attemptId: string }> }): Promise<NextResponse> {
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
    const stateCandidate = body && typeof body === "object" ? (body as { state?: unknown }).state : undefined;
    const expectedVersion = body && typeof body === "object" ? (body as { expectedVersion?: unknown }).expectedVersion : undefined;
    const parsed = stateCandidate !== undefined ? parseSequenceRuntimeState(stateCandidate) : { valid: false as const, errors: ["missing body.state"] };
    if (!parsed.valid) {
      return contentRuntimeError(correlationId, "SEQUENCE_RUNTIME_STATE_INVALID", 422, parsed.errors.join("; "), false);
    }
    if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return contentRuntimeError(correlationId, "SEQUENCE_RUNTIME_STATE_INVALID", 422, "body.expectedVersion must be a positive integer.", false);
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const attempt = await resolveOwnedAttempt(attemptId, identity.tenantId, identity.studentProfileId);
    if (!attempt) {
      return contentRuntimeError(correlationId, "RESOURCE_NOT_FOUND", 404, "Attempt not found.", false);
    }

    const saved = await getSequenceRuntimeStateRepository().save(identity.tenantId, attempt.id, expectedVersion, parsed.data);
    if (!saved) {
      return contentRuntimeError(
        correlationId,
        "SEQUENCE_RUNTIME_STATE_VERSION_CONFLICT",
        409,
        "expectedVersion did not match the current stored version — reload the current state and reconcile before retrying.",
        true,
      );
    }

    return NextResponse.json(
      { data: { state: saved.state, version: saved.version }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}

function contentRuntimeError(correlationId: string | null, code: string, httpStatus: number, message: string, retryable: boolean): NextResponse {
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
