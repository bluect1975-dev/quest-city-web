import { NextResponse } from "next/server";
import { getSessionService, getSchoolEnrollmentRepository } from "../../../lib/identity-context";
import { getAssignmentRepository, getLearningAttemptRepository } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

type CompletionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

/**
 * `GET /me/assignments` (`listMyAssignments`, OpenAPI v1.10 — 02_26 v1.12
 * §34.5). Closes the Tranche B Web report gap: `/w/home` had no way to
 * discover a student's active `STAFF_GENERAL` assignments other than
 * hardcoded per-tranche routes. Discovery-only — never creates or mutates
 * a `learning_attempt`; resuming/starting still goes exclusively through
 * `POST /assignments/{assignmentId}/launch-context`.
 *
 * Scope is resolved ENTIRELY server-side from the student session cookie
 * — no `tenantId`/`classId`/`studentId` is ever accepted from the client
 * (anti-enumeration, 02_26 §34.6). A student session is bound to exactly
 * one `classId` at login (`SessionService.resolveInternalIdentity`), so
 * "the student's own classes" is that single class, not a list.
 *
 * Filters: `originType = STAFF_GENERAL` only (`ADMIN_SEED`/
 * `RECOVERY_FROM_REVIEW` are explicitly out of scope — their own `classId`
 * semantics were never verified for this contract), `status = PUBLISHED`
 * only, and the enrollment itself must be `ACTIVE` (`LEFT`/`SUSPENDED`/
 * other statuses see an empty list, not an error — the session can still
 * be nominally valid for a non-ACTIVE enrollment under the existing
 * WEB-M1 session model, this endpoint just discloses nothing in that case).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    if (!sessionToken) {
      return NextResponse.json(
        {
          domain: "CONTENT_RUNTIME",
          code: "STUDENT_AUTH_REQUIRED",
          httpStatus: 401,
          message: "A student session is required.",
          correlationId: correlationId ?? "",
          retryable: false,
        },
        { status: 401 },
      );
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);

    const enrollment = await getSchoolEnrollmentRepository().findById(identity.enrollmentId, identity.tenantId);
    if (!enrollment || enrollment.status !== "ACTIVE") {
      return NextResponse.json(
        { data: [], meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
        { status: 200 },
      );
    }

    const assignments = await getAssignmentRepository().findByClassIdForStudentDiscovery(identity.classId, identity.tenantId);
    const attempts = getLearningAttemptRepository();

    const data = await Promise.all(
      assignments.map(async (assignment) => {
        const attemptHistory = await attempts.findConcurrentByAssignmentAndStudent(
          identity.tenantId,
          assignment.id,
          identity.studentProfileId,
        );
        const completed = attemptHistory.find((a) => a.attemptState === "COMPLETED");
        let completionStatus: CompletionStatus;
        let latestAttemptId: string | null;
        if (completed) {
          completionStatus = "COMPLETED";
          latestAttemptId = completed.id;
        } else if (attemptHistory.length > 0) {
          completionStatus = "IN_PROGRESS";
          latestAttemptId = attemptHistory[attemptHistory.length - 1]!.id;
        } else {
          completionStatus = "NOT_STARTED";
          latestAttemptId = null;
        }
        return {
          assignmentId: assignment.id,
          contentBundleId: assignment.contentBundleId,
          title: assignment.title,
          completionStatus,
          latestAttemptId,
          dueAt: assignment.dueAt?.toISOString() ?? null,
        };
      }),
    );

    return NextResponse.json(
      { data, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}
