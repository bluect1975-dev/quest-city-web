"use client";

import { EmptyState, ProgressSteps, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { getMyAssignments } from "../../../lib/student-api-client";
import { useAuthedResource } from "../../../lib/use-authed-resource";

const STEP_STATE = {
  COMPLETED: "completed",
  IN_PROGRESS: "current",
  // "next" rather than "locked": GLPC gating is not resolved for this view
  // (see doc comment below) — these assignments are actually startable in
  // any order today, so "locked" would misrepresent real availability.
  NOT_STARTED: "next",
} as const;

/**
 * `/w/path` — "Il mio percorso" (Pilot Product Experience Remediation G4,
 * §15). Scope decision, documented rather than silently assumed: this
 * mission found no student-callable GLPC/curriculum-tree endpoint (only
 * staff-facing `GET /learning-path/effective` and the class/student
 * preview routes exist — see the Feature Inventory). Building a full
 * locked/available/completed curriculum-tree viewer would require new
 * backend plumbing beyond this tranche's scope. Rather than fabricate
 * that tree client-side, this page renders the student's own
 * `STAFF_GENERAL` assignments (`GET /me/assignments`, already
 * server-ordered by due date then creation) as an explicit ordered
 * sequence — real data, real order, honestly narrower than the full §15
 * mandate. Tracked as `NEW-GAP-STUDENT-PATH-VIEW-01` for a future
 * dedicated tranche once a student-facing GLPC read endpoint exists.
 */
export default function MyPathPage() {
  const { authStatus, data, error, loading } = useAuthedResource(getMyAssignments);

  if (authStatus === "loading" || authStatus === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "path.title")}</StatusMessage>
      </main>
    );
  }

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "path.title")}</h1>
      <p>{t(STUDENT_WEB_CATALOG_IT_IT, "path.description")}</p>
      {loading && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "path.loading")}</StatusMessage>}
      {!loading && error && <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "path.error")}</StatusMessage>}
      {!loading && !error && data && data.length === 0 && (
        <EmptyState
          title={t(STUDENT_WEB_CATALOG_IT_IT, "path.emptyTitle")}
          description={t(STUDENT_WEB_CATALOG_IT_IT, "path.emptyDescription")}
        />
      )}
      {!loading && !error && data && data.length > 0 && (
        <ProgressSteps
          steps={data.map((assignment) => ({
            id: assignment.assignmentId,
            label: assignment.title,
            state: STEP_STATE[assignment.completionStatus],
          }))}
        />
      )}
    </main>
  );
}
