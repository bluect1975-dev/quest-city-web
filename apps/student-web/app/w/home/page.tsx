"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { ERRORS_CATALOG_IT_IT, STUDENT_WEB_CATALOG_IT_IT, t, translateErrorCode } from "@quest-city-web/i18n";
import { useStudentAuth } from "../../../lib/student-auth-context";
import { getMyAssignments, type MyAssignment } from "../../../lib/student-api-client";
import { StudentApiError } from "../../../lib/student-api-error";

const ASSIGNMENT_STATUS_TONE = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
} as const;

/**
 * `/w/home` (Pilot UX/UI Redesign, UI-R2 — Student Home). Replaces the
 * previous milestone-by-milestone layout (a "welcome" heading followed by
 * six near-identical "La tua attività" cards, one hardcoded per M06
 * tranche, plus a developer-only "Motori didattici disponibili" sandbox
 * section) with a real hierarchy: one current-mission hero (the M06 full
 * sequence, `/w/full-sequence` — the actual pilot curriculum path) above
 * the student's own `STAFF_GENERAL` assignments.
 *
 * The six hardcoded per-tranche reads (`getWebM4Activity`..
 * `getWebTranche5Activity`) and the `/w/engine/:id` / `/w/sequence`
 * sandbox links are intentionally NOT rendered here anymore — the
 * previous version of this file already documented them as "for
 * regression/dev", never the pilot-ready path (`getMyAssignments` was).
 * Those routes and their backend endpoints are untouched and still
 * directly covered by their own integration tests
 * (`tests/integration/web-tranche{1..6}-*-flow.test.ts`); only this
 * page's product-facing rendering of them is removed.
 *
 * No fabricated progress number is shown here (principio di evidenza —
 * never display data the app doesn't actually have): a real per-stage
 * progress view exists inside `/w/full-sequence` itself (`FullSequenceHost`,
 * UI-R3), which has the real `SequenceRuntimeState`.
 */
export default function StudentHomePage() {
  const { status, context } = useStudentAuth();
  const router = useRouter();
  const [myAssignments, setMyAssignments] = useState<MyAssignment[] | null>(null);
  const [myAssignmentsError, setMyAssignmentsError] = useState<string | null>(null);
  const [loadingMyAssignments, setLoadingMyAssignments] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/w/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "authenticated-read-only") {
      return;
    }
    let cancelled = false;
    getMyAssignments()
      .then((result) => {
        if (!cancelled) setMyAssignments(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        setMyAssignmentsError(
          caught instanceof StudentApiError
            ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
            : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingMyAssignments(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.title")}</StatusMessage>
      </main>
    );
  }

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "home.welcomeTitle", { params: { alias: context?.displayAlias ?? "" } })}</h1>
      {status === "authenticated-read-only" && (
        <StatusMessage kind="unauthorized">{t(STUDENT_WEB_CATALOG_IT_IT, "home.readOnlySessionWarning")}</StatusMessage>
      )}

      <Card className="qc-hero-card">
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "home.fullSequenceSectionTitle")}</h2>
        <p>{t(STUDENT_WEB_CATALOG_IT_IT, "home.fullSequenceDescription")}</p>
        <Link href="/w/full-sequence">
          <Button type="button">{t(STUDENT_WEB_CATALOG_IT_IT, "home.startFullSequenceButton")}</Button>
        </Link>
      </Card>

      <Card>
        <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsSectionTitle")}</h2>
        {loadingMyAssignments && (
          <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsLoading")}</StatusMessage>
        )}
        {!loadingMyAssignments && myAssignmentsError && (
          <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsError")}</StatusMessage>
        )}
        {!loadingMyAssignments && !myAssignmentsError && myAssignments && myAssignments.length === 0 && (
          <EmptyState
            title={t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsEmptyTitle")}
            description={t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsEmptyDescription")}
          />
        )}
        {!loadingMyAssignments && !myAssignmentsError && myAssignments && myAssignments.length > 0 && (
          <ul className="qc-assignment-list">
            {myAssignments.map((assignment) => (
              <li key={assignment.assignmentId} className="qc-assignment-list-item">
                <div>
                  <p className="qc-assignment-list-title">{assignment.title}</p>
                  <StatusBadge tone={ASSIGNMENT_STATUS_TONE[assignment.completionStatus]}>
                    {t(
                      STUDENT_WEB_CATALOG_IT_IT,
                      assignment.completionStatus === "COMPLETED"
                        ? "home.assignmentStatusCompleted"
                        : assignment.completionStatus === "IN_PROGRESS"
                          ? "home.assignmentStatusInProgress"
                          : "home.assignmentStatusNotStarted",
                    )}
                  </StatusBadge>
                  {assignment.dueAt && (
                    <p className="qc-assignment-list-due">
                      {t(STUDENT_WEB_CATALOG_IT_IT, "home.assignmentDueAt", { params: { dueAt: new Date(assignment.dueAt).toLocaleDateString() } })}
                    </p>
                  )}
                </div>
                <Link href={`/w/activity/${encodeURIComponent(assignment.assignmentId)}`}>
                  <Button type="button" variant="secondary">
                    {t(
                      STUDENT_WEB_CATALOG_IT_IT,
                      assignment.completionStatus === "COMPLETED"
                        ? "home.reviewAssignmentButton"
                        : assignment.completionStatus === "IN_PROGRESS"
                          ? "home.resumeAssignmentButton"
                          : "home.startAssignmentButton",
                    )}
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
