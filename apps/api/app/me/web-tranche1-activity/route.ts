import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { WEB_TRANCHE1_ASSIGNMENT_PUBLIC_ID, WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID } from "@quest-city-web/content-runtime";
import { getSessionService } from "../../../lib/identity-context";
import { getAssignmentRepository } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /me/web-tranche1-activity` (M06 Web Full Vertical Slice Tranche 1,
 * `07_26 v1.0` §14). Mirrors `/me/web-m4-activity` exactly (07_25 v1.0
 * §7-B/§20) for the second real assignment this platform now has: the
 * `GUIDED_PRACTICE` + `REFLECTION_AND_RESULT` sequence
 * (`tools/seed-assignment.ts --public-id asn_web_tranche1_guided_practice_reflection`).
 * Deliberately a second narrowly-scoped read, not a general "list my
 * assignments" endpoint — same rationale as the WEB-M4 route.
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
      WEB_TRANCHE1_ASSIGNMENT_PUBLIC_ID,
      identity.tenantId,
    );
    if (!assignment || assignment.status !== "PUBLISHED") {
      return NextResponse.json(
        {
          domain: "CONTENT_RUNTIME",
          code: "WEB_TRANCHE1_ACTIVITY_NOT_AVAILABLE",
          httpStatus: 404,
          message: "The Guided Practice + Reflection activity is not available for this school yet.",
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
          activityId: WEB_TRANCHE1_GUIDED_PRACTICE_ACTIVITY_ID,
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
