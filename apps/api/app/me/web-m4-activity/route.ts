import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { WEB_M4_MAT_M06_ACTIVITY_ID, WEB_M4_MAT_M06_ASSIGNMENT_PUBLIC_ID } from "@quest-city-web/content-runtime";
import { getSessionService } from "../../../lib/identity-context";
import { getAssignmentRepository } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /me/web-m4-activity` (WEB-M4, 07_25 v1.0 §7-B/§20). A single,
 * narrowly-scoped read that resolves the one real WEB-M4 assignment
 * (`tools/seed-assignment.ts --public-id asn_web_m4_balance_machine`) for
 * the caller's own tenant — deliberately NOT a general "list my
 * assignments" endpoint (07_25 §8: no curriculum browser required).
 * `/w/home` uses this to build the entry point into `/w/activity/:activityId`.
 * 404 (not "no assignments yet", a real CONTENT_RUNTIME error) if this
 * school's tenant was never seeded with the WEB-M4 assignment.
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
      WEB_M4_MAT_M06_ASSIGNMENT_PUBLIC_ID,
      identity.tenantId,
    );
    if (!assignment || assignment.status !== "PUBLISHED") {
      return NextResponse.json(
        {
          domain: "CONTENT_RUNTIME",
          code: "WEB_M4_ACTIVITY_NOT_AVAILABLE",
          httpStatus: 404,
          message: "The WEB-M4 activity is not available for this school yet.",
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
          activityId: WEB_M4_MAT_M06_ACTIVITY_ID,
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
