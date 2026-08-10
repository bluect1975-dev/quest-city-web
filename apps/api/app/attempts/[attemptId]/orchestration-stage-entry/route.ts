import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { isWhollyNonInteractiveContentBundle } from "@quest-city-web/attempts";
import { getSessionService } from "../../../../lib/identity-context";
import { getLearningAttemptRepository, getAuditRepository } from "../../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../../lib/attempt-error-response";
import { readSessionToken } from "../../../../lib/session-cookie";
import { getCsrfTokenHeader, isTrustedOrigin } from "../../../../lib/csrf-guard";
import { loadEnv } from "../../../../lib/env";
import type { ErrorEnvelope } from "@quest-city-web/attempts";

/**
 * `POST /attempts/{attemptId}/orchestration-stage-entry` (07_15_01 v1.3
 * §11-bis.2-bis, 02_36 v1.4 §20-bis.12). Orchestration-layer-owned second
 * trigger for `attemptState: CREATED -> IN_PROGRESS`, for an attempt whose
 * entire content bundle is `isInteractive: false` with no
 * `engineDispatchRef` (today: INTRO_HOOK) — the sequence's own semantic-
 * action-less stage can never call `POST /attempts/{attemptId}/actions`
 * (02_26 v1.9 §18.3), so no attempt on such a bundle could otherwise ever
 * leave CREATED.
 *
 * NOT a semantic action: no request body vocabulary from
 * `@quest-city-web/learning-engines`, never inserted into
 * `semantic_action_log` (SemanticActionLogRepository is never imported
 * here). The server never trusts a client-declared stage — eligibility is
 * decided purely from `attempt.contentId` against the static registry in
 * `isWhollyNonInteractiveContentBundle` (see that function's own doc
 * comment for why no client-declared `stageId` is needed).
 *
 * Idempotent by construction: `transitionToInProgress` only ever mutates a
 * `CREATED` row (07_15_01 §11-bis.2-bis "Idempotenza") — repeated calls
 * against an attempt already past `CREATED` (via this trigger, via the
 * semantic-action trigger, or any later state) are a silent no-op, and no
 * second `audit_event` is written for a call that did not actually
 * transition anything (only the call that flips CREATED -> IN_PROGRESS is
 * audited, per §11-bis.2-bis "Audit").
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

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const attempts = getLearningAttemptRepository();

    const attempt = await attempts.findByIdAndTenant(attemptId, identity.tenantId);
    if (!attempt || attempt.studentProfileId !== identity.studentProfileId) {
      return NextResponse.json(
        { domain: "PLATFORM", code: "RESOURCE_NOT_FOUND", httpStatus: 404, message: "Attempt not found", correlationId: correlationId ?? "", retryable: false } satisfies ErrorEnvelope,
        { status: 404 },
      );
    }

    if (!isWhollyNonInteractiveContentBundle(attempt.contentId)) {
      // A client/programming defect (calling this endpoint for an
      // attempt whose content is actually interactive) — never a normal
      // runtime condition, so this is an error, not a silent no-op.
      return contentRuntimeError(
        correlationId,
        "ORCHESTRATION_STAGE_ENTRY_NOT_APPLICABLE",
        422,
        "This attempt's content is not a wholly non-interactive, engine-less sequence.",
      );
    }

    const wasCreated = attempt.attemptState === "CREATED";
    const updated = wasCreated ? await attempts.transitionToInProgress(attemptId, identity.tenantId) : attempt;

    if (wasCreated && updated?.attemptState === "IN_PROGRESS") {
      await getAuditRepository().record({
        tenantId: identity.tenantId,
        actorType: "SYSTEM",
        action: "orchestration_stage_entry_attempt_transitioned",
        targetType: "learning_attempt",
        targetId: attemptId,
        result: "SUCCESS",
        metadataRedacted: { fromState: "CREATED", toState: "IN_PROGRESS" },
      });
    }

    return NextResponse.json(
      {
        data: { attemptId, attemptState: updated?.attemptState ?? attempt.attemptState },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}

function contentRuntimeError(correlationId: string | null, code: string, httpStatus: number, message: string): NextResponse {
  const envelope: ErrorEnvelope = {
    domain: "CONTENT_RUNTIME",
    code,
    httpStatus,
    message,
    correlationId: correlationId ?? "",
    retryable: false,
  };
  return NextResponse.json(envelope, { status: httpStatus });
}
