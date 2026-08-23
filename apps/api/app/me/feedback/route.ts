import { NextResponse } from "next/server";
import { getSessionService } from "../../../lib/identity-context";
import { getAssignmentRepository, getLearningAttemptRepository } from "../../../lib/attempts-context";
import { getTeacherFeedbackRepository } from "../../../lib/staff-identity-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /me/feedback` (UAT Failure Remediation,
 * `UAT-RC4-STUDENT-FEEDBACK-VISIBILITY-01`). The docente-authored feedback
 * flow (`POST /attempts/{id}/feedback`, `.../publish`) already existed —
 * this closes the other half: a student-scoped read of their own
 * feedback, with no equivalent surface anywhere in `apps/student-web`
 * before this.
 *
 * Only `publicationStatus: "PUBLISHED"` rows are ever returned — a
 * `DRAFT` is the docente's own unfinished note, and a `REVOKED` one was
 * deliberately withdrawn; neither should ever reach the student it's
 * about. `structuredFeedback` (the docente's free-form JSON scratch
 * field, `02_35 §9`) is never included in the response — only `freeText`,
 * the human-readable note, per the mandate that no JSON reach the student
 * UI. Each item is annotated with the real assignment title its attempt
 * belongs to, so the student sees what activity the feedback is about
 * without a second lookup.
 *
 * Scope resolved entirely server-side from the session cookie (same
 * anti-enumeration discipline as `GET /me/assignments` / `GET /me/path`)
 * — never a client-supplied `studentProfileId`.
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

    const allFeedback = await getTeacherFeedbackRepository().findByStudent(identity.studentProfileId, identity.tenantId);
    const published = allFeedback.filter((feedback) => feedback.publicationStatus === "PUBLISHED");

    const attempts = getLearningAttemptRepository();
    const assignments = getAssignmentRepository();

    const items = await Promise.all(
      published.map(async (feedback) => {
        const attempt = await attempts.findByIdAndTenant(feedback.learningAttemptId, identity.tenantId);
        const assignment = attempt ? await assignments.findByIdAndTenant(attempt.assignmentId, identity.tenantId) : null;
        return {
          feedbackId: feedback.id,
          learningAttemptId: feedback.learningAttemptId,
          // A missing attempt/assignment is a data-integrity anomaly (FK
          // should prevent this) -- disclose plainly rather than fabricate a title.
          assignmentTitle: assignment?.title ?? null,
          freeText: feedback.freeText,
          publishedAt: feedback.publishedAt ? feedback.publishedAt.toISOString() : null,
        };
      }),
    );

    items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

    return NextResponse.json({ data: items, meta: { request_id: correlationId ?? undefined, api_version: "v1" } }, { status: 200 });
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}
