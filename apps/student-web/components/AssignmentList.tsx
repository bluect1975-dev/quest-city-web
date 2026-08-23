import Link from "next/link";
import { Button, StatusBadge } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import type { MyAssignment } from "../lib/student-api-client";

const ASSIGNMENT_STATUS_TONE = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
} as const;

/**
 * Shared assignment-row rendering (Pilot Product Experience Remediation
 * G4) — extracted from `/w/home` (UI-R2) so `/w/home`'s compact list and
 * the new dedicated `/w/assignments` full list never drift into two
 * slightly different renderings of the same `MyAssignment[]` data.
 *
 * UAT Failure Remediation (`UAT-RC4-STUDENT-REVIEW-COMPLETED-ATTEMPT-01`):
 * a COMPLETED assignment's CTA must open the read-only result/review page
 * (`/w/result/{attemptId}`), never `/w/activity/{assignmentId}` — that
 * route re-drives the live launch/sequence-host flow meant for playing an
 * activity, which has no "review a finished attempt" mode and previously
 * surfaced a state error instead. `/me/assignments` already resolves a
 * real `latestAttemptId` for a COMPLETED row (the attempt that actually
 * finished it), so no new endpoint is needed here.
 */
export function AssignmentList({ assignments }: { assignments: MyAssignment[] }) {
  return (
    <ul className="qc-assignment-list">
      {assignments.map((assignment) => (
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
          <Link
            href={
              assignment.completionStatus === "COMPLETED" && assignment.latestAttemptId
                ? `/w/result/${encodeURIComponent(assignment.latestAttemptId)}`
                : `/w/activity/${encodeURIComponent(assignment.assignmentId)}`
            }
          >
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
  );
}
