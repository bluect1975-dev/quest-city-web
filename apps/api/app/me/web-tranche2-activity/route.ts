import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { WEB_TRANCHE2_ASSIGNMENT_PUBLIC_ID, WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID } from "@quest-city-web/content-runtime";
import { getSessionService } from "../../../lib/identity-context";
import { getAssignmentRepository } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /me/web-tranche2-activity` (M06 Web Full Vertical Slice Tranche 2,
 * `07_26 v1.0` §16). Mirrors `/me/web-tranche1-activity` exactly for the
 * third real assignment this platform now has: the `QUICK_QUESTION_SET`
 * stage (`tools/seed-assignment.ts --public-id asn_web_tranche2_quick_question_set`).
 * Deliberately a third narrowly-scoped read, not a general "list my
 * assignments" endpoint — same rationale as the WEB-M4/Tranche 1 routes.
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
      WEB_TRANCHE2_ASSIGNMENT_PUBLIC_ID,
      identity.tenantId,
    );
    if (!assignment || assignment.status !== "PUBLISHED") {
      return NextResponse.json(
        {
          domain: "CONTENT_RUNTIME",
          code: "WEB_TRANCHE2_ACTIVITY_NOT_AVAILABLE",
          httpStatus: 404,
          message: "The Quick Question Set activity is not available for this school yet.",
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
          activityId: WEB_TRANCHE2_QUICK_QUESTION_SET_ACTIVITY_ID,
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
