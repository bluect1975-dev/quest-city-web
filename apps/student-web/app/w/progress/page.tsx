"use client";

import { Card, EmptyState, StatsCard, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { getProgressSummary } from "../../../lib/student-api-client";
import { useAuthedResource } from "../../../lib/use-authed-resource";

/**
 * Closed set, matches `learning_attempt.attempt_state`'s own CHECK
 * constraint exactly (migration 0003) — every possible key is labeled, so
 * no raw enum value can ever reach the student.
 */
const ATTEMPT_STATE_ORDER = ["COMPLETED", "IN_PROGRESS", "COMPLETION_SUBMITTED", "CREATED", "ABANDONED", "EXPIRED"] as const;

/** Closed set, matches `learning_attempt.completion_status`'s own CHECK constraint exactly. */
const COMPLETION_STATUS_ORDER = ["CONSOLIDATED", "ACCEPTED_NOT_CONSOLIDATED", "RECONCILIATION_REQUIRED"] as const;

/**
 * `/w/progress` — "Progressi" (Pilot Product Experience Remediation G5,
 * §17; semantics fixed by UAT Failure Remediation,
 * `UAT-RC4-STUDENT-PROGRESS-ACTIVITY-COUNT-01` /
 * `-SEMANTICS-01` / `-TECHNICAL-LABEL-01`). Backed by the already-existing
 * `GET /progress/summary` (`LearningAttemptRepository.summarizeForStudent`).
 *
 * Root cause of the original bug: the headline stat was bound to
 * `aggregate.totalAttempts` — every `learning_attempt` row regardless of
 * state, including empty `CREATED` attempts that were never played — and
 * the only breakdown shown (`byCompletionStatus`) silently drops any row
 * with a NULL `completion_status` (every non-terminal attempt), so it
 * never summed back to the headline number. The real "attività svolte"
 * signal is `byAttemptState.COMPLETED` (the attempt lifecycle's own
 * terminal, real-completion state — the same field `GET /me/assignments`
 * already uses to decide an assignment is "Completata"). The full
 * `byAttemptState` breakdown below — every key labeled, always rendered
 * even at zero when it has siblings — reconciles exactly to
 * `totalAttempts`, which is now shown only as an explicit, clearly-labeled
 * secondary "all states" figure, never presented as if it meant "done".
 *
 * Deliberately does NOT show a score/mastery/checkpoint breakdown: no such
 * field exists in `learning_attempt` today (Feature Inventory row
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

  const byAttemptState = data?.aggregate.byAttemptState ?? {};
  const completedCount = byAttemptState.COMPLETED ?? 0;
  const inProgressCount = (byAttemptState.IN_PROGRESS ?? 0) + (byAttemptState.COMPLETION_SUBMITTED ?? 0);
  const attemptStateEntries = ATTEMPT_STATE_ORDER.filter((status) => (byAttemptState[status] ?? 0) > 0).map((status) => [
    status,
    byAttemptState[status]!,
  ]) as Array<[(typeof ATTEMPT_STATE_ORDER)[number], number]>;

  const byCompletionStatus = data?.aggregate.byCompletionStatus ?? {};
  const completionStatusEntries = COMPLETION_STATUS_ORDER.filter((status) => (byCompletionStatus[status] ?? 0) > 0).map((status) => [
    status,
    byCompletionStatus[status]!,
  ]) as Array<[(typeof COMPLETION_STATUS_ORDER)[number], number]>;

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
          <div className="qc-stats-grid">
            <StatsCard label={t(STUDENT_WEB_CATALOG_IT_IT, "progress.completedActivitiesLabel")} value={completedCount} />
            <StatsCard label={t(STUDENT_WEB_CATALOG_IT_IT, "progress.inProgressActivitiesLabel")} value={inProgressCount} />
          </div>

          <Card>
            <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "progress.byStatusTitle")}</h2>
            <dl className="qc-detail-list">
              {attemptStateEntries.map(([status, count]) => (
                <div key={status}>
                  <dt>{t(STUDENT_WEB_CATALOG_IT_IT, `progress.attemptStateLabel.${status}`)}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {completionStatusEntries.length > 0 && (
            <Card className="qc-card-muted">
              <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "progress.byVerificationStatusTitle")}</h2>
              <dl className="qc-detail-list">
                {completionStatusEntries.map(([status, count]) => (
                  <div key={status}>
                    <dt>{t(STUDENT_WEB_CATALOG_IT_IT, `progress.completionStatusLabel.${status}`)}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          <p className="qc-form-field-hint">
            {t(STUDENT_WEB_CATALOG_IT_IT, "progress.totalAttemptsLabel")}: {data.aggregate.totalAttempts}
          </p>
        </>
      )}
    </main>
  );
}
