import { NextResponse } from "next/server";
import { IdentityError } from "@quest-city-web/identity";
import { WEB_TRANCHE6_REFLECTION_ACTIVITY_ID, WEB_TRANCHE6_REFLECTION_ASSIGNMENT_PUBLIC_ID } from "@quest-city-web/content-runtime";
import { getSessionService } from "../../../lib/identity-context";
import { getAssignmentRepository } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";

/**
 * `GET /me/web-tranche6-activity` (M06 Web Full Vertical Slice Tranche 6,
 * `07_26 v1.1` §17.4). Mirrors `/me/web-tranche1-activity`..
 * `/me/web-tranche5-activity` exactly for the one new real assignment
 * Tranche 6 introduces: the Full M06 Sequence's standalone
 * `REFLECTION_AND_RESULT` group
 * (`tools/seed-assignment.ts --public-id asn_web_tranche6_full_sequence_reflection`).
 * `FullSequenceHost` calls this (not `launchActivity` directly with a
 * public_id) because `POST /assignments/{assignmentId}/launch-context`
 * requires the assignment's real database id, never its public_id — the
 * same resolution step every other group's existing route already performs.
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
      WEB_TRANCHE6_REFLECTION_ASSIGNMENT_PUBLIC_ID,
      identity.tenantId,
    );
    if (!assignment || assignment.status !== "PUBLISHED") {
      return NextResponse.json(
        {
          domain: "CONTENT_RUNTIME",
          code: "WEB_TRANCHE6_ACTIVITY_NOT_AVAILABLE",
          httpStatus: 404,
          message: "The Full Sequence reflection activity is not available for this school yet.",
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
          activityId: WEB_TRANCHE6_REFLECTION_ACTIVITY_ID,
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
