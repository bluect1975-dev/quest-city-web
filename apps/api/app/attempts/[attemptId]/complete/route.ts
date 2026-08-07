import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { CrossRuntimeError, checkFinalClientSequence } from "@quest-city-web/attempts";
import { getSessionService } from "../../../../lib/identity-context";
import {
  getLearningAttemptRepository,
  getSemanticActionLogRepository,
  getIdempotencyService,
  getAttemptConsolidationService,
  getCrossRuntimeReconciliationService,
} from "../../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../../lib/attempt-error-response";
import { readSessionToken } from "../../../../lib/session-cookie";
import { getCsrfTokenHeader, isTrustedOrigin } from "../../../../lib/csrf-guard";
import { loadEnv } from "../../../../lib/env";

interface CompleteAttemptRequestBody {
  finalClientSequence?: number;
}

/**
 * `POST /attempts/{attemptId}/complete` (02_26 v1.6 §18.5). Requires
 * `Idempotency-Key` with completion scope (idempotency_record —
 * independent of the creation-scope column on launch-context). Always
 * returns an explicit completionStatus, never only a generic HTTP success.
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
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 16) {
      throw new IdentityError("VALIDATION_ERROR", "Idempotency-Key header is required (min 16 chars)");
    }
    const body = (await request.json().catch(() => ({}))) as CompleteAttemptRequestBody;

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const attempts = getLearningAttemptRepository();
    const idempotency = getIdempotencyService();
    const consolidation = getAttemptConsolidationService();
    const reconciliation = getCrossRuntimeReconciliationService();

    const attempt = await attempts.findByIdAndTenant(attemptId, identity.tenantId);
    if (!attempt || attempt.studentProfileId !== identity.studentProfileId) {
      return NextResponse.json(
        { domain: "PLATFORM", code: "RESOURCE_NOT_FOUND", httpStatus: 404, message: "Attempt not found", correlationId: correlationId ?? "", retryable: false },
        { status: 404 },
      );
    }

    // §11-bis.3: a fresh idempotency key against an attempt already
    // COMPLETED is an attempt to alter a finalized outcome — checked
    // before touching idempotency_record, since a never-seen key would
    // otherwise sail through begin() as NEW.
    if (attempt.attemptState === "COMPLETED") {
      throw new CrossRuntimeError(
        "ATTEMPT_ALREADY_CONSOLIDATED",
        "Il tentativo è già stato consolidato con una chiave diversa.",
      );
    }
    if (attempt.attemptState === "ABANDONED" || attempt.attemptState === "EXPIRED") {
      throw new CrossRuntimeError("ATTEMPT_NOT_COMPLETABLE", "Il tentativo non è completabile nel suo stato attuale.", {
        reason: attempt.attemptState,
      });
    }
    if (attempt.attemptState === "CREATED") {
      throw new CrossRuntimeError("ATTEMPT_NOT_COMPLETABLE", "Il tentativo non è completabile nel suo stato attuale.", {
        reason: "INVALID_STATE",
      });
    }

    // Fetched once, reused both for the finalClientSequence check below and
    // for the real outcome computation in consolidation.consolidate().
    const actions = await getSemanticActionLogRepository().findByAttempt(attemptId, identity.tenantId);

    // Reject before any state transition — exactly like the state checks
    // above — rather than consolidating on an incomplete action log. The
    // same checkFinalClientSequence() used here is what the tests call
    // directly, so the check is never duplicated between route and test.
    const sequenceCheck = checkFinalClientSequence(body.finalClientSequence, actions);
    if (!sequenceCheck.ok) {
      throw new CrossRuntimeError("ATTEMPT_NOT_COMPLETABLE", "Un'azione risulta ancora in transito.", {
        reason: sequenceCheck.reason,
      });
    }

    const begin = await idempotency.begin({
      tenantId: identity.tenantId,
      assignmentId: attempt.assignmentId,
      studentProfileId: identity.studentProfileId,
      idempotencyKey,
      payload: body,
    });

    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return NextResponse.json(
        { data: { attemptId, completionStatus: "DUPLICATE" }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
        { status: 200 },
      );
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") {
      throw new CrossRuntimeError("CROSS_RUNTIME_ATTEMPT_CONFLICT", "Idempotency-Key reused with a different payload.");
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      return NextResponse.json(begin.response, { status: 409 });
    }
    if (begin.outcome === "RETRY_TOO_SOON") {
      throw new CrossRuntimeError("CROSS_RUNTIME_ATTEMPT_CONFLICT", "Retry window not yet elapsed.");
    }

    const generation = begin.generation;

    try {
      // §11-bis.2: IN_PROGRESS -> COMPLETION_SUBMITTED requires knowing
      // the eventual completion_status up front — evaluate reconciliation
      // before the transition, per 07_15_01 v1.1 §12-13 ordering.
      const evaluation = await reconciliation.evaluate({
        tenantId: identity.tenantId,
        assignmentId: attempt.assignmentId,
        studentProfileId: identity.studentProfileId,
      });

      if (evaluation.resolution === "RECONCILIATION_REQUIRED") {
        const submitted = await attempts.transitionToCompletionSubmitted(
          attemptId,
          identity.tenantId,
          "RECONCILIATION_REQUIRED",
        );
        if (!submitted) {
          throw new CrossRuntimeError("ATTEMPT_NOT_COMPLETABLE", "Attempt state changed concurrently.", {
            reason: "INVALID_STATE",
          });
        }
        const response = { attemptId, completionStatus: "RECONCILIATION_REQUIRED" as const };
        await idempotency.complete({
          tenantId: identity.tenantId,
          assignmentId: attempt.assignmentId,
          studentProfileId: identity.studentProfileId,
          idempotencyKey,
          expectedGeneration: generation,
          response,
        });
        return NextResponse.json(
          { data: response, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
          { status: 200 },
        );
      }

      const submitted = await attempts.transitionToCompletionSubmitted(
        attemptId,
        identity.tenantId,
        "ACCEPTED_NOT_CONSOLIDATED",
      );
      if (!submitted) {
        throw new CrossRuntimeError("ATTEMPT_NOT_COMPLETABLE", "Attempt state changed concurrently.", {
          reason: "INVALID_STATE",
        });
      }

      // Real, deterministic outcome computation — AttemptConsolidationService
      // derives it from `actions` via evaluateBalanceMachine(), the one
      // real validator this repository implements (docs/adr/0003); the
      // route never invents or accepts a client-proposed outcome (07_08 §8).
      const result = await consolidation.consolidate({ attemptId, tenantId: identity.tenantId, actions });

      const response = { attemptId, completionStatus: result.completionStatus, outcome: result.outcome };
      await idempotency.complete({
        tenantId: identity.tenantId,
        assignmentId: attempt.assignmentId,
        studentProfileId: identity.studentProfileId,
        idempotencyKey,
        expectedGeneration: generation,
        response,
      });

      return NextResponse.json(
        { data: response, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
        { status: 200 },
      );
    } catch (innerError) {
      await idempotency.fail({
        tenantId: identity.tenantId,
        assignmentId: attempt.assignmentId,
        studentProfileId: identity.studentProfileId,
        idempotencyKey,
        expectedGeneration: generation,
        retryable: true,
        response: { error: innerError instanceof Error ? innerError.message : String(innerError) },
      });
      throw innerError;
    }
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}
