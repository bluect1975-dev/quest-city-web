import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { WEB_TRANCHE3_ASSIGNMENT_PUBLIC_ID, WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID } from "@quest-city-web/content-runtime";
import { getSessionService } from "../../../lib/identity-context";
import { getAssignmentRepository } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /me/web-tranche3-activity` (M06 Web Full Vertical Slice Tranche 3,
 * `07_26 v1.0` §5/§13). Mirrors `/me/web-tranche1-activity`/
 * `/me/web-tranche2-activity` exactly for the fourth real assignment this
 * platform now has: the `PREREQUISITE_CHECK` + `MICRO_LESSON` stages
 * (`tools/seed-assignment.ts --public-id asn_web_tranche3_prerequisite_check_micro_lesson`).
 * Deliberately a fourth narrowly-scoped read, not a general "list my
 * assignments" endpoint — same rationale as the prior tranches' routes.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id");
  try {
    const env = loadEnv();
    const sessionToken = readSessionToken(request, env);
    if (!sessionToken) {
      throw new IdentityError("SESSION_EXPIRED");
    }

    const identity = await getSessionService().resolveInternalIdentity(sessionToken);
    const assignment = await getAssignmentRepository().findByPublicIdAndTenant(
      WEB_TRANCHE3_ASSIGNMENT_PUBLIC_ID,
      identity.tenantId,
    );
    if (!assignment || assignment.status !== "PUBLISHED") {
      return NextResponse.json(
        {
          domain: "CONTENT_RUNTIME",
          code: "WEB_TRANCHE3_ACTIVITY_NOT_AVAILABLE",
          httpStatus: 404,
          message: "The Prerequisite Check / Micro Lesson activity is not available for this school yet.",
          correlationId: correlationId ?? "",
          retryable: false,
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        data: {
          assignmentId: assignment.id,
          activityId: WEB_TRANCHE3_PREREQUISITE_CHECK_ACTIVITY_ID,
          title: assignment.title,
        },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}
