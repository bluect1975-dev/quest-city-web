"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { ERRORS_CATALOG_IT_IT, STUDENT_WEB_CATALOG_IT_IT, t, translateErrorCode } from "@quest-city-web/i18n";
import { useStudentAuth } from "../../../../lib/student-auth-context";
import { getAttempt, getMyFeedback, type AttemptDetail, type MyFeedbackItem } from "../../../../lib/student-api-client";
import { StudentApiError } from "../../../../lib/student-api-error";
import { ATTEMPT_STATE_TONE, attemptStateLabel } from "../../../../lib/attempt-state-label";

/**
 * `/w/result/:attemptId` (WEB-M4, 07_25 v1.0 §7-G/§15). Real data only —
 * `GET /attempts/{attemptId}` (new, student-scoped, ownership-checked),
 * never a hardcoded/demo outcome.
 *
 * Also the "Review risultato" surface `UAT-RC4-STUDENT-FEEDBACK-
 * VISIBILITY-01` names as an acceptable place for published docente
 * feedback to become visible: fetches `GET /me/feedback` (the student's
 * full feedback list) and filters client-side to this one attempt — no
 * per-attempt endpoint needed since the list is already small per
 * student. A failed feedback fetch never blocks the attempt result
 * itself from rendering (independent loading state).
 */
export default function ResultPage() {
  const params = useParams<{ attemptId: string }>();
  const attemptId = decodeURIComponent(params.attemptId);
  const { status } = useStudentAuth();
  const router = useRouter();

  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<MyFeedbackItem[] | null>(null);

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
    getAttempt(attemptId)
      .then((result) => {
        if (!cancelled) setAttempt(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(
          caught instanceof StudentApiError
            ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
            : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
        );
      });
    getMyFeedback()
      .then((all) => {
        if (!cancelled) setFeedback(all.filter((item) => item.learningAttemptId === attemptId));
      })
      .catch(() => {
        if (!cancelled) setFeedback([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status, attemptId]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "result.loading")}</StatusMessage>
      </main>
    );
  }

  if (error) {
    return (
      <main>
        <StatusMessage kind="error">{error}</StatusMessage>
        <Link href="/w/home">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.backLink")}</Link>
      </main>
    );
  }

  if (!attempt) {
    return (
      <main>
        <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "result.loading")}</StatusMessage>
      </main>
    );
  }

  // `AttemptConsolidationService`'s outcome (outcome.schema.json,
  // packages/attempts/src/services/attempt-consolidation-service.ts) only
  // ever carries `score` — never a `correctness` field (that lives
  // separately on `attempt_response`, not exposed by GET /attempts/{id}).
  // `score` is absent entirely when the content/engine dispatch could not
  // be resolved (never fabricated) — that case is "unscored", not "incorrect".
  const outcome = attempt.outcome as { score?: number } | null;
  const isConsolidated = attempt.completionStatus === "CONSOLIDATED";
  const isScored = typeof outcome?.score === "number";
  const isCorrect = outcome?.score === 1;

  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "result.title")}</h1>

      <Card className="qc-hero-card">
        {isConsolidated && isScored && (
          <StatusBadge tone={isCorrect ? "success" : "warning"}>
            {isCorrect ? t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultCorrect") : t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultIncorrect")}
          </StatusBadge>
        )}

        {isConsolidated && !isScored && (
          <StatusBadge tone="neutral">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultPending")}</StatusBadge>
        )}

        {!isConsolidated && (
          <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "result.pendingConsolidation")}</StatusMessage>
        )}

        <p>
          {t(STUDENT_WEB_CATALOG_IT_IT, "result.stateLabel")}: <StatusBadge tone={ATTEMPT_STATE_TONE[attempt.attemptState] ?? "neutral"}>{attemptStateLabel(attempt.attemptState)}</StatusBadge>
        </p>

        <p>
          {t(STUDENT_WEB_CATALOG_IT_IT, "result.startedAtLabel", {
            params: { date: new Date(attempt.startedAt).toLocaleString("it-IT") },
          })}
        </p>
        {attempt.completedAt && (
          <p>
            {t(STUDENT_WEB_CATALOG_IT_IT, "result.completedAtLabel", {
              params: { date: new Date(attempt.completedAt).toLocaleString("it-IT") },
            })}
          </p>
        )}

        <Link href="/w/home">
          <Button type="button">{t(STUDENT_WEB_CATALOG_IT_IT, "result.homeButton")}</Button>
        </Link>
      </Card>

      {feedback && feedback.length > 0 && (
        <Card>
          <h2>{t(STUDENT_WEB_CATALOG_IT_IT, "result.feedbackTitle")}</h2>
          <ul className="qc-feedback-list">
            {feedback.map((item) => (
              <li key={item.feedbackId} className="qc-feedback-item">
                <p className="qc-feedback-text">{item.freeText}</p>
                {item.publishedAt && (
                  <p className="qc-assignment-list-due">
                    {t(STUDENT_WEB_CATALOG_IT_IT, "result.feedbackPublishedAtLabel", {
                      params: { date: new Date(item.publishedAt).toLocaleString("it-IT") },
                    })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
