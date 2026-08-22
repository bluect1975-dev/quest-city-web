"use client";

import { Card, EmptyState, StatsCard, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { getProgressSummary } from "../../../lib/student-api-client";
import { useAuthedResource } from "../../../lib/use-authed-resource";

const COMPLETION_STATUS_LABEL_KEY: Record<string, string> = {
  NOT_STARTED: "home.assignmentStatusNotStarted",
  IN_PROGRESS: "home.assignmentStatusInProgress",
  COMPLETED: "home.assignmentStatusCompleted",
};

/**
 * `/w/progress` — "Progressi" (Pilot Product Experience Remediation G5,
 * §17). Backed by the already-existing `GET /progress/summary`
 * (`LearningAttemptRepository.summarizeForStudent`) — real aggregate
 * counts only (total attempts, breakdown by completion status).
 * Deliberately does NOT show a score/mastery/checkpoint breakdown: no
 * such field exists in `learning_attempt` today (Feature Inventory row
 * "Progressi studente" — UNCLEAR/likely NOT_IMPLEMENTED at per-unit
 * granularity). Showing a fabricated percentage would violate §43.
 */
export default function ProgressPage() {
  const { authStatus, data, error, loading } = useAuthedResource(getProgressSummary);

  if (authStatus === "loading" || authStatus === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "progress.title")}</StatusMessage>
      </main>
    );
  }

  const byCompletionStatusEntries = data ? Object.entries(data.aggregate.byCompletionStatus).filter(([, count]) => count > 0) : [];

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "progress.title")}</h1>
      {loading && <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "progress.loading")}</StatusMessage>}
      {!loading && error && <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "progress.error")}</StatusMessage>}
      {!loading && !error && data && data.aggregate.totalAttempts === 0 && (
        <EmptyState
          title={t(STUDENT_WEB_CATALOG_IT_IT, "progress.emptyTitle")}
          description={t(STUDENT_WEB_CATALOG_IT_IT, "progress.emptyDescription")}
        />
      )}
      {!loading && !error && data && data.aggregate.totalAttempts > 0 && (
        <>
          <StatsCard label={t(STUDENT_WEB_CATALOG_IT_IT, "progress.totalAttemptsLabel")} value={data.aggregate.totalAttempts} />
          <Card>
            <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "progress.byStatusTitle")}</h2>
            <dl className="qc-detail-list">
              {byCompletionStatusEntries.map(([status, count]) => (
                <div key={status}>
                  <dt>{COMPLETION_STATUS_LABEL_KEY[status] ? t(STUDENT_WEB_CATALOG_IT_IT, COMPLETION_STATUS_LABEL_KEY[status]!) : status}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      )}
    </main>
  );
}
