"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { ERRORS_CATALOG_IT_IT, STUDENT_WEB_CATALOG_IT_IT, t, translateErrorCode } from "@quest-city-web/i18n";
import { useStudentAuth } from "../../../../lib/student-auth-context";
import { getAttempt, type AttemptDetail } from "../../../../lib/student-api-client";
import { StudentApiError } from "../../../../lib/student-api-error";

/**
 * `/w/result/:attemptId` (WEB-M4, 07_25 v1.0 §7-G/§15). Real data only —
 * `GET /attempts/{attemptId}` (new, student-scoped, ownership-checked),
 * never a hardcoded/demo outcome.
 */
export default function ResultPage() {
  const params = useParams<{ attemptId: string }>();
  const attemptId = decodeURIComponent(params.attemptId);
  const { status } = useStudentAuth();
  const router = useRouter();

  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      <StatusMessage kind="empty">
        {t(STUDENT_WEB_CATALOG_IT_IT, "result.attemptStateLabel", { params: { state: attempt.attemptState } })}
      </StatusMessage>

      {!isConsolidated && (
        <StatusMessage kind="empty">{t(STUDENT_WEB_CATALOG_IT_IT, "result.pendingConsolidation")}</StatusMessage>
      )}

      {isConsolidated && isScored && (
        <StatusBadge tone={isCorrect ? "success" : "warning"}>
          {isCorrect ? t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultCorrect") : t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultIncorrect")}
        </StatusBadge>
      )}

      {isConsolidated && !isScored && (
        <StatusBadge tone="neutral">{t(STUDENT_WEB_CATALOG_IT_IT, "engines.common.resultPending")}</StatusBadge>
      )}

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
    </main>
  );
}
