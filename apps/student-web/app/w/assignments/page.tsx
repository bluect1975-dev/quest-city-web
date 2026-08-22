"use client";

import { EmptyState, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { getMyAssignments } from "../../../lib/student-api-client";
import { useAuthedResource } from "../../../lib/use-authed-resource";
import { AssignmentList } from "../../../components/AssignmentList";

/**
 * `/w/assignments` — dedicated "Assegnazioni" surface (Pilot Product
 * Experience Remediation G4, §16). `/w/home` keeps its own compact
 * assignment section (real navigational shortcut, not removed) — this
 * page is the full, non-truncated list reached from the shell nav, using
 * the same `GET /me/assignments` data and the same row rendering
 * (`AssignmentList`, shared with Home) so the two never show conflicting
 * information.
 */
export default function AssignmentsPage() {
  const { authStatus, data, error, loading } = useAuthedResource(getMyAssignments);

  if (authStatus === "loading" || authStatus === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "assignmentsPage.title")}</StatusMessage>
      </main>
    );
  }

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "assignmentsPage.title")}</h1>
      <p>{t(STUDENT_WEB_CATALOG_IT_IT, "assignmentsPage.description")}</p>
      {loading && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsLoading")}</StatusMessage>}
      {!loading && error && <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsError")}</StatusMessage>}
      {!loading && !error && data && data.length === 0 && (
        <EmptyState
          title={t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsEmptyTitle")}
          description={t(STUDENT_WEB_CATALOG_IT_IT, "home.myAssignmentsEmptyDescription")}
        />
      )}
      {!loading && !error && data && data.length > 0 && <AssignmentList assignments={data} />}
    </main>
  );
}
