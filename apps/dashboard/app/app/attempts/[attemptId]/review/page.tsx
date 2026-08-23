"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
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
import { attemptStateLabel, completionStatusLabel, deliveryStatusLabel } from "../../../../../lib/staff-enum-labels";

/**
 * `/app/attempts/{attemptId}/review` (02_35 §8-§11). UAT Failure
 * Remediation humanized this page (`UAT-RC4-TEACHER-REVIEW-RAW-JSON-01`,
 * `-CREATED-EMPTY-ATTEMPT-01`): a real pedagogical review screen for a
 * docente, not a technical debug page. `studentAnswer`/`semanticActions`/
 * `hints`/`validatorOutcome`/`previousAttempts` render as human Italian
 * text and lists — raw JSON is still available (never destroyed, §4.22
 * rule 10 auditing already covers this access) but only inside a
 * collapsed "Dettagli tecnici" disclosure at the bottom, never as the
 * primary presentation. An empty `CREATED` attempt — never actually
 * played by the student — is called out explicitly and cannot be used to
 * create feedback, since it carries no real evidence to evaluate.
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

/** camelCase/snake_case -> spaced, capitalized — generic, engine-agnostic humanization for whatever shape a given Learning Engine's response/payload happens to carry. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function HumanValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <>—</>;
  if (typeof value === "boolean") return <>{value ? "Sì" : "No"}</>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <>—</>;
    if (value.every((item) => typeof item !== "object" || item === null)) {
      return <>{value.map((item) => String(item)).join(", ")}</>;
    }
    return (
      <ul className="qc-detail-list">
        {value.map((item, index) => (
          // items carry no stable id of their own here
          <li key={index}>
            <HumanValue value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") return <KeyValueList data={value as Record<string, unknown>} />;
  return <>{String(value)}</>;
}

function KeyValueList({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <dl className="qc-detail-list">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{humanizeKey(key)}</dt>
          <dd>
            <HumanValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ActionTypeLabel({ actionType }: { actionType: string }) {
  const key = `app.attemptReview.actionTypeLabel.${actionType}` as `app.attemptReview.actionTypeLabel.${string}`;
  return <>{t(DASHBOARD_CATALOG_IT_IT, key, { onMissingKey: "returnKey" })}</>;
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
      const created = await createTeacherFeedback({
        attemptId,
        // No raw-JSON authoring surface for the docente (UAT-RC4-TEACHER-REVIEW-RAW-JSON-01) —
        // freeText is the one real feedback channel; structuredFeedback stays an empty, valid object.
        structuredFeedback: {},
        freeText: freeText.trim() ? freeText.trim() : null,
        originReviewQueueItemId,
        csrfToken,
      });
      setFeedback(created);
    } catch (caught) {
      setFeedbackError(staffErrorText(caught));
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

  const isEmptyAttempt = result.status === "success" && result.data.attemptState === "CREATED";

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.title")}</h1>

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <section className="qc-card">
            <dl className="qc-detail-list">
              <div>
                <dt>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.attemptStateLabel")}</dt>
                <dd>
                  <StatusBadge tone={result.data.attemptState === "COMPLETED" ? "success" : isEmptyAttempt ? "neutral" : "info"}>
                    {attemptStateLabel(result.data.attemptState)}
                  </StatusBadge>
                </dd>
              </div>
              <div>
                <dt>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.startedAtLabel")}</dt>
                <dd>{new Date(result.data.startedAt).toLocaleString("it-IT")}</dd>
              </div>
              {result.data.completedAt ? (
                <div>
                  <dt>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.completedAtLabel")}</dt>
                  <dd>{new Date(result.data.completedAt).toLocaleString("it-IT")}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {isEmptyAttempt ? (
            <section className="qc-card qc-card-muted">
              <StatusBadge tone="neutral">{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.emptyAttemptBadge")}</StatusBadge>
              <p>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.emptyAttemptNotice")}</p>
            </section>
          ) : (
            <>
              <section className="qc-card">
                <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.studentAnswerTitle")}</h2>
                {Object.keys(result.data.studentAnswer).length === 0 ? (
                  <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.emptyAttemptBadge")} />
                ) : (
                  <KeyValueList data={result.data.studentAnswer} />
                )}
              </section>

              <section className="qc-card">
                <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.semanticActionsTitle")}</h2>
                {(result.data.semanticActions ?? []).length === 0 ? (
                  <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.noSemanticActions")} />
                ) : (
                  <ul className="qc-detail-list">
                    {(result.data.semanticActions ?? []).map((action) => (
                      <li key={action.actionId}>
                        <b>
                          <ActionTypeLabel actionType={action.actionType} />
                        </b>{" "}
                        — {new Date(action.occurredAt).toLocaleString("it-IT")}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="qc-card">
                <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.hintsTitle")}</h2>
                {(result.data.hints ?? []).length === 0 ? (
                  <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.noHints")} />
                ) : (
                  <ul className="qc-detail-list">
                    {(result.data.hints ?? []).map((hint) => (
                      <li key={hint.actionId}>{new Date(hint.occurredAt).toLocaleString("it-IT")}</li>
                    ))}
                  </ul>
                )}
              </section>

              {result.data.validatorOutcome ? (
                <section className="qc-card">
                  <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.validatorOutcomeTitle")}</h2>
                  <p>
                    {(() => {
                      const correctness = (result.data.validatorOutcome as { correctness?: string }).correctness;
                      const key = correctness
                        ? (`app.attemptReview.correctnessLabel.${correctness}` as `app.attemptReview.correctnessLabel.${string}`)
                        : null;
                      return key ? t(DASHBOARD_CATALOG_IT_IT, key, { onMissingKey: "returnKey" }) : "—";
                    })()}
                  </p>
                </section>
              ) : null}
            </>
          )}

          <section className="qc-card">
            <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.previousAttemptsTitle")}</h2>
            {(result.data.previousAttempts ?? []).length === 0 ? (
              <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.noPreviousAttempts")} />
            ) : (
              <ul className="qc-detail-list">
                {(result.data.previousAttempts ?? []).map((prev) => (
                  <li key={prev.attemptId}>
                    <Link href={`/app/attempts/${encodeURIComponent(prev.attemptId)}/review`}>
                      {prev.attemptState === "CREATED"
                        ? t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.emptyAttemptBadge")
                        : `${attemptStateLabel(prev.attemptState)} — ${completionStatusLabel(prev.completionStatus)}`}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="qc-card">
            <summary>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.technicalDetailsTitle")}</summary>
            <pre>{JSON.stringify(result.data, null, 2)}</pre>
          </details>
        </>
      ) : null}

      {!isEmptyAttempt && (
        <section className="qc-card">
          <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.feedbackFormTitle")}</h2>
          {!feedback ? (
            <>
              <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.freeTextLabel")} hint={t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.freeTextHint")}>
                {(fieldProps) => <textarea {...fieldProps} rows={4} value={freeText} onChange={(event) => setFreeText(event.target.value)} />}
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
                {t(DASHBOARD_CATALOG_IT_IT, "app.attemptReview.deliveryStatusLabel")}: {deliveryStatusLabel(feedback.deliveryStatus)}
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
      )}

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
