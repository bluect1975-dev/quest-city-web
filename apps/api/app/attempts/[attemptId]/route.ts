import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { getSessionService } from "../../../lib/identity-context";
import { getLearningAttemptRepository } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";
import type { ErrorEnvelope } from "@quest-city-web/attempts";

/**
 * `GET /attempts/{attemptId}` (WEB-M4, 07_25 v1.0 §7-G/§20). Student-scoped
 * read of a single attempt's current state/result — no equivalent existed
 * before WEB-M4 (only the staff-only `/attempts/{attemptId}/review`,
 * `apps/api/app/attempts/[attemptId]/review/route.ts`). Session-cookie
 * auth only (read-only, no CSRF — same pattern as `GET /me/student-context`);
 * ownership is enforced by `attempt.studentProfileId === identity.
 * studentProfileId`, exactly the check already used by the `actions` and
 * `complete` routes, never trusting a client-supplied id.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const { attemptId } = await params;
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const attempts = getLearningAttemptRepository();

    const attempt = await attempts.findByIdAndTenant(attemptId, identity.tenantId);
    if (!attempt || attempt.studentProfileId !== identity.studentProfileId) {
      return NextResponse.json(
        {
          domain: "PLATFORM",
          code: "RESOURCE_NOT_FOUND",
          httpStatus: 404,
          message: "Attempt not found",
          correlationId: correlationId ?? "",
          retryable: false,
        } satisfies ErrorEnvelope,
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        data: {
          attemptId: attempt.id,
          assignmentId: attempt.assignmentId,
          activityId: attempt.contentId,
          attemptState: attempt.attemptState,
          completionStatus: attempt.completionStatus,
          startedAt: attempt.startedAt.toISOString(),
          completedAt: attempt.completedAt?.toISOString() ?? null,
          outcome: attempt.outcome,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}
