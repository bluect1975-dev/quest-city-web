import { NextResponse } from "next/server";
import { getSessionService, getSchoolEnrollmentRepository } from "../../../lib/identity-context";
import { getAssignmentRepository, getContentBundleRepository, getLearningAttemptRepository, resolveEffectiveForLaunchAttempt } from "../../../lib/attempts-context";
import { attemptErrorResponse } from "../../../lib/attempt-error-response";
import { readSessionToken } from "../../../lib/session-cookie";
import { loadEnv } from "../../../lib/env";
import { derivePathState, type PathCompletionStatus } from "@quest-city-web/attempts";

/**
 * `GET /me/path` (Pilot Product Experience Residual Closure, Tranche H3) —
 * closes `NEW-GAP-STUDENT-PATH-VIEW-01`. "Il mio percorso" was previously
 * just `GET /me/assignments` re-labelled (zero GLPC involvement, per the
 * prior mission's own disclosed gap). This is a genuinely new resolution:
 * for each of the student's real `STAFF_GENERAL`/`PUBLISHED` assignments,
 * the real server-side GLPC cascade (`resolveEffectiveForLaunchAttempt`,
 * the exact same resolver `POST /assignments/{id}/launch-context` already
 * enforces at attempt start — `resourceType: "UNIT_ELEMENT"`,
 * `resourceRef: bundle.publicId`, the schema's own disclosed convention,
 * migration 0013 header) determines whether the item is actually LOCKED,
 * not merely whether it exists.
 *
 * No subject/module/unit curriculum tree exists anywhere in this schema
 * (02_25's conceptual tables were never migrated — migration 0013's own
 * header comment). This endpoint honestly does not fabricate one: it
 * groups by the one real hierarchy level that does exist
 * (`content_bundle.subject_id`) and otherwise returns the student's real
 * assignments annotated with a real GLPC-derived state — never a fake
 * module/unit tree.
 *
 * `pathState` precedence: an already-COMPLETED item stays COMPLETED even
 * if a policy later disables it (a real past achievement is never hidden
 * retroactively); otherwise GLPC unavailability wins over attempt
 * progress (LOCKED); otherwise IN_PROGRESS attempts are CURRENT; anything
 * else still available and not started is AVAILABLE.
 *
 * Scope resolved entirely server-side from the session cookie (same
 * anti-enumeration discipline as `GET /me/assignments`) — tenant/class/
 * student scoping is inherited unchanged from `findByClassIdForStudentDiscovery`
 * and `resolveEffectiveForLaunchAttempt` (both already tenant/class/student
 * scoped, not reimplemented here). `assignmentId`/`contentBundleId` are
 * always the public-id-format identifiers (`assignment.publicId`/
 * `bundle.publicId`), never the internal UUID.
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
        { data: { items: [], progress: { completedCount: 0, totalCount: 0 } }, meta: { request_id: correlationId ?? undefined, api_version: "v1" } },
        { status: 200 },
      );
    }

    const assignments = await getAssignmentRepository().findByClassIdForStudentDiscovery(identity.classId, identity.tenantId);
    const attempts = getLearningAttemptRepository();
    const contentBundles = getContentBundleRepository();

    const items = await Promise.all(
      assignments.map(async (assignment) => {
        const [bundle, attemptHistory] = await Promise.all([
          contentBundles.findById(assignment.contentBundleId),
          attempts.findConcurrentByAssignmentAndStudent(identity.tenantId, assignment.id, identity.studentProfileId),
        ]);

        const completed = attemptHistory.find((a) => a.attemptState === "COMPLETED");
        const completionStatus: PathCompletionStatus = completed
          ? "COMPLETED"
          : attemptHistory.length > 0
            ? "IN_PROGRESS"
            : "NOT_STARTED";

        // A missing content_bundle row is a data-integrity anomaly (FK
        // should prevent this) -- fail safe to EFFECTIVE_UNAVAILABLE
        // (renders LOCKED via derivePathState) rather than fabricate
        // availability for a resource this route cannot even identify.
        const availability = bundle
          ? await resolveEffectiveForLaunchAttempt({
              tenantId: identity.tenantId,
              studentProfileId: identity.studentProfileId,
              resourceType: "UNIT_ELEMENT",
              resourceRef: bundle.publicId,
            })
          : { effectiveAvailability: "EFFECTIVE_UNAVAILABLE" as const };

        const pathState = derivePathState(completionStatus, availability.effectiveAvailability);

        return {
          assignmentId: assignment.publicId,
          contentBundleId: bundle?.publicId ?? null,
          title: assignment.title,
          subjectId: bundle?.subjectId ?? null,
          pathState,
          dueAt: assignment.dueAt?.toISOString() ?? null,
        };
      }),
    );

    const completedCount = items.filter((item) => item.pathState === "COMPLETED").length;

    return NextResponse.json(
      {
        data: { items, progress: { completedCount, totalCount: items.length } },
        meta: { request_id: correlationId ?? undefined, api_version: "v1" },
      },
      { status: 200 },
    );
  } catch (error) {
    return attemptErrorResponse(error, correlationId);
  }
}
