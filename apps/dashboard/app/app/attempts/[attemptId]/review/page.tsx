"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Button, EmptyState, FormField, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../../../lib/RequireStaffAuth";
import { useAsync } from "../../../../../lib/useAsync";
import { useStaffAuth } from "../../../../../lib/staff-auth-context";
import {
  createRecoveryAssignment,
  createTeacherFeedback,
  getAttemptReviewDetail,
  publishTeacherFeedback,
  revokeTeacherFeedback,
} from "../../../../../lib/staff-api-client";
import { staffErrorText } from "../../../../../lib/staff-error-text";
import type { AttemptReviewDetail, RecoveryAssignment, TeacherFeedback } from "../../../../../lib/staff-api-types";

/**
 * `/app/attempts/{attemptId}/review` (02_35 §8-§11). Read-only detail
 * plus, in the same visit: create a DRAFT feedback, publish/revoke it,
 * and — once published — create a recovery assignment from it. There is
 * no `GET` list-by-attempt endpoint for `teacher_feedback` in OpenAPI
 * v1.6 (minimized API surface, 02_35 §12), so a feedback created earlier
 * in a different visit is not re-displayed here — only what this page
 * itself created and holds in local state.
 */
export default function StaffAttemptReviewPage() {
  const params = useParams<{ attemptId: string }>();
  const searchParams = useSearchParams();
  const originReviewQueueItemId = searchParams.get("reviewItemId");

  return (
    <RequireStaffAuth>
      {() => <AttemptReviewView attemptId={params.attemptId} originReviewQueueItemId={originReviewQueueItemId} />}
    </RequireStaffAuth>
  );
}

function AttemptReviewView({
  attemptId,
  originReviewQueueItemId,
}: {
  attemptId: string;
  originReviewQueueItemId: string | null;
}) {
  const { csrfToken } = useStaffAuth();
  const result = useAsync<AttemptReviewDetail>(() => getAttemptReviewDetail(attemptId), [attemptId]);

  const [structuredFeedbackText, setStructuredFeedbackText] = useState("{}");
  const [freeText, setFreeText] = useState("");
  const [feedback, setFeedback] = useState<TeacherFeedback | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  const [contentBundleId, setContentBundleId] = useState("");
  const [runtimeWeb, setRuntimeWeb] = useState(true);
  const [runtimeRoblox, setRuntimeRoblox] = useState(false);
  const [recoveryAssignment, setRecoveryAssignment] = useState<RecoveryAssignment | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  async function handleCreateFeedback() {
    if (!csrfToken) return;
    setFeedbackError(null);
    setFeedbackBusy(true);
    try {
      const parsed: unknown = JSON.parse(structuredFeedbackText);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("structuredFeedback must be a JSON object");
      }
      const created = await createTeacherFeedback({
        attemptId,
        structuredFeedback: parsed as Record<string, unknown>,
        freeText: freeText.trim() ? freeText.trim() : null,
        originReviewQueueItemId,
        csrfToken,
      });
      setFeedback(created);
    } catch (caught) {
      setFeedbackError(caught instanceof SyntaxError ? "JSON non valido." : staffErrorText(caught));
    } finally {
      setFeedbackBusy(false);
    }
  }

  async function handlePublish() {
    if (!csrfToken || !feedback) return;
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      setFeedback(await publishTeacherFeedback({ feedbackId: feedback.id, version: feedback.version, csrfToken }));
    } catch (caught) {
      setFeedbackError(staffErrorText(caught));
    } finally {
      setFeedbackBusy(false);
    }
  }

  async function handleRevoke() {
    if (!csrfToken || !feedback) return;
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      setFeedback(await revokeTeacherFeedback({ feedbackId: feedback.id, version: feedback.version, csrfToken }));
    } catch (caught) {
      setFeedbackError(staffErrorText(caught));
    } finally {
      setFeedbackBusy(false);
    }
  }

  async function handleCreateRecoveryAssignment() {
    if (!csrfToken || !feedback) return;
    const allowedRuntimeChannels: Array<"WEB" | "ROBLOX"> = [
      ...(runtimeWeb ? (["WEB"] as const) : []),
      ...(runtimeRoblox ? (["ROBLOX"] as const) : []),
    ];
    setRecoveryError(null);
    setRecoveryBusy(true);
    try {
      const created = await createRecoveryAssignment({
        attemptId,
        originTeacherFeedbackId: feedback.id,
        contentBundleId,
        allowedRuntimeChannels,
        csrfToken,
      });
      setRecoveryAssignment(created);
    } catch (caught) {
      setRecoveryError(staffErrorText(caught));
    } finally {
      setRecoveryBusy(false);
    }
  }

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.title")}</h1>

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <section className="qc-card">
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.studentAnswerTitle")}</h2>
            <pre>{JSON.stringify(result.data.studentAnswer, null, 2)}</pre>
          </section>

          <section className="qc-card">
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.semanticActionsTitle")}</h2>
            <pre>{JSON.stringify(result.data.semanticActions ?? [], null, 2)}</pre>
          </section>

          <section className="qc-card">
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.hintsTitle")}</h2>
            {(result.data.hints ?? []).length === 0 ? (
              <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.noHints")} />
            ) : (
              <pre>{JSON.stringify(result.data.hints, null, 2)}</pre>
            )}
          </section>

          {result.data.validatorOutcome ? (
            <section className="qc-card">
              <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.validatorOutcomeTitle")}</h2>
              <pre>{JSON.stringify(result.data.validatorOutcome, null, 2)}</pre>
            </section>
          ) : null}

          <section className="qc-card">
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.previousAttemptsTitle")}</h2>
            {(result.data.previousAttempts ?? []).length === 0 ? (
              <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.noPreviousAttempts")} />
            ) : (
              <pre>{JSON.stringify(result.data.previousAttempts, null, 2)}</pre>
            )}
          </section>
        </>
      ) : null}

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.feedbackFormTitle")}</h2>
        {!feedback ? (
          <>
            <FormField
              label={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.structuredFeedbackLabel")}
              hint={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.structuredFeedbackHint")}
            >
              {(fieldProps) => (
                <textarea
                  {...fieldProps}
                  rows={4}
                  value={structuredFeedbackText}
                  onChange={(event) => setStructuredFeedbackText(event.target.value)}
                />
              )}
            </FormField>
            <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.freeTextLabel")}>
              {(fieldProps) => (
                <textarea {...fieldProps} rows={3} value={freeText} onChange={(event) => setFreeText(event.target.value)} />
              )}
            </FormField>
            {feedbackError ? <StatusMessage kind="error">{feedbackError}</StatusMessage> : null}
            <Button disabled={feedbackBusy || !csrfToken} onClick={() => void handleCreateFeedback()}>
              {t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.createFeedbackButton")}
            </Button>
          </>
        ) : (
          <>
            <p>
              {t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.publicationStatusLabel")}:{" "}
              <StatusBadge tone={feedback.publicationStatus === "PUBLISHED" ? "success" : feedback.publicationStatus === "REVOKED" ? "danger" : "neutral"}>
                {t(DASHBOARD_CATALOG_IT_IT, `app.status.${feedback.publicationStatus.toLowerCase()}` as `app.status.${string}`)}
              </StatusBadge>
            </p>
            <p>
              {t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.deliveryStatusLabel")}: {feedback.deliveryStatus}
            </p>
            {feedbackError ? <StatusMessage kind="error">{feedbackError}</StatusMessage> : null}
            {feedback.publicationStatus === "DRAFT" ? (
              <Button disabled={feedbackBusy || !csrfToken} onClick={() => void handlePublish()}>
                {t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.publishButton")}
              </Button>
            ) : null}
            {feedback.publicationStatus === "PUBLISHED" ? (
              <Button variant="secondary" disabled={feedbackBusy || !csrfToken} onClick={() => void handleRevoke()}>
                {t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.revokeButton")}
              </Button>
            ) : null}
          </>
        )}
      </section>

      {feedback?.publicationStatus === "PUBLISHED" ? (
        <section className="qc-card">
          <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.recoveryAssignmentTitle")}</h2>
          {!recoveryAssignment ? (
            <>
              <p>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.recoveryAssignmentHint")}</p>
              <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.contentBundleIdLabel")}>
                {(fieldProps) => (
                  <input {...fieldProps} type="text" value={contentBundleId} onChange={(event) => setContentBundleId(event.target.value)} />
                )}
              </FormField>
              <fieldset>
                <legend>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.runtimeChannelsLabel")}</legend>
                <label>
                  <input type="checkbox" checked={runtimeWeb} onChange={(event) => setRuntimeWeb(event.target.checked)} /> WEB
                </label>
                <label>
                  <input type="checkbox" checked={runtimeRoblox} onChange={(event) => setRuntimeRoblox(event.target.checked)} /> ROBLOX
                </label>
              </fieldset>
              {recoveryError ? <StatusMessage kind="error">{recoveryError}</StatusMessage> : null}
              <Button
                disabled={recoveryBusy || !csrfToken || !contentBundleId || (!runtimeWeb && !runtimeRoblox)}
                onClick={() => void handleCreateRecoveryAssignment()}
              >
                {t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.createRecoveryButton")}
              </Button>
            </>
          ) : (
            <StatusMessage kind="empty">{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.recoveryAssignmentCreated")}</StatusMessage>
          )}
        </section>
      ) : null}
    </main>
  );
}
