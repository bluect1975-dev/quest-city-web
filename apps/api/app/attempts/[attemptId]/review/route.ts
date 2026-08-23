import { NextResponse } from "next/server";
import { StaffIdentityError, isClassInScope } from "@quest-city-web/staff-identity";
import { loadEnv } from "../../../../lib/env";
import { requireStaffIdentity } from "../../../../lib/staff-request-context";
import { staffErrorResponse } from "../../../../lib/staff-error-response";
import {
  getAssignmentRepository,
  getLearningAttemptRepository,
  getSemanticActionLogRepository,
  getAttemptResponseRepository,
} from "../../../../lib/attempts-context";
import { getStaffAuditRepository } from "../../../../lib/staff-identity-context";

/**
 * `GET /attempts/{attemptId}/review` (02_35 §8). Composed entirely from
 * existing WEB-M2 entities (learning_attempt, semantic_action_log,
 * attempt_response) plus 07_15_01 §6.1 provenance fields — never invents
 * data that does not exist. `proposedAiFeedback` is always `null`: no AI
 * evaluation service is confirmed implemented at this date (02_35 §8.1).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const identity = await requireStaffIdentity(request, env);
    const { attemptId } = await params;

    const attempts = getLearningAttemptRepository();
    const attempt = await attempts.findByIdAndTenant(attemptId, identity.tenantId);
    if (!attempt) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }
    const assignment = await getAssignmentRepository().findByIdAndTenant(attempt.assignmentId, identity.tenantId);
    if (!assignment || !isClassInScope(identity, assignment.classId)) {
      throw new StaffIdentityError("CLASS_ACCESS_DENIED");
    }

    const [semanticActions, responses, priorAttempts] = await Promise.all([
      getSemanticActionLogRepository().findByAttempt(attemptId, identity.tenantId),
      getAttemptResponseRepository().findByAttempt(attemptId, identity.tenantId),
      attempts.findByStudentProfile(identity.tenantId, attempt.studentProfileId),
    ]);

    const latestResponse = responses[responses.length - 1] ?? null;
    const hints = semanticActions.filter((a) => a.actionType === "REQUEST_HINT");

    // Access to attempt review detail is itself an audited action (AGENTS.md §4.22 rule 10), not only its mutations.
    await getStaffAuditRepository().record({
      tenantId: identity.tenantId,
      actorType: "STAFF",
      actorId: identity.staffAccountId,
      action: "staff_attempt_review_accessed",
      targetType: "learning_attempt",
      targetId: attemptId,
      result: "SUCCESS",
    });

    return NextResponse.json(
      {
        data: {
          attemptId: attempt.id,
          attemptState: attempt.attemptState,
          startedAt: attempt.startedAt.toISOString(),
          completedAt: attempt.completedAt ? attempt.completedAt.toISOString() : null,
          studentAnswer: latestResponse?.responseJson ?? {},
          semanticActions: semanticActions.map((a) => ({
            actionId: a.actionId,
            actionType: a.actionType,
            targetRole: a.targetRole,
            payload: a.payload,
            clientSequence: a.clientSequence,
            occurredAt: a.occurredAt.toISOString(),
          })),
          hints: hints.map((h) => ({ actionId: h.actionId, payload: h.payload, occurredAt: h.occurredAt.toISOString() })),
          validatorOutcome: latestResponse
            ? { correctness: latestResponse.correctness, validatorVersion: latestResponse.validatorVersion }
            : null,
          proposedAiFeedback: null,
          previousAttempts: priorAttempts
            .filter((a) => a.id !== attemptId && a.assignmentId === attempt.assignmentId)
            .map((a) => ({ attemptId: a.id, attemptState: a.attemptState, completionStatus: a.completionStatus })),
          relatedCompetencies: [],
          runtimeChannel: attempt.runtimeChannel,
          reconciliationStatus: attempt.completionStatus,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return staffErrorResponse(error, correlationId);
  }
}
