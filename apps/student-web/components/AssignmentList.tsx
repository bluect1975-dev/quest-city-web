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
  );
}
