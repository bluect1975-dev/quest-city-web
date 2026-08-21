"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, EmptyState, FormField, StatusBadge, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useAsync } from "../../../lib/useAsync";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { listReviewQueue, transitionReviewItemStatus } from "../../../lib/staff-api-client";
import { staffErrorText } from "../../../lib/staff-error-text";
import type { ReviewQueueItem, ReviewQueueItemPriority, ReviewQueueItemStatus } from "../../../lib/staff-api-types";

const STATUS_TONE: Record<ReviewQueueItemStatus, "info" | "warning" | "success" | "neutral"> = {
  OPEN: "info",
  IN_REVIEW: "warning",
  RESOLVED: "success",
  DISMISSED: "neutral",
};

const STATUS_LABEL_KEY: Record<ReviewQueueItemStatus, string> = {
  OPEN: "app.status.open",
  IN_REVIEW: "app.status.inReview",
  RESOLVED: "app.status.resolved",
  DISMISSED: "app.status.dismissed",
};

const REASON_LABEL_KEY: Record<ReviewQueueItem["reason"], string> = {
  INCORRECT_ATTEMPT: "app.review.reasonIncorrectAttempt",
  OPEN_ANSWER: "app.review.reasonOpenAnswer",
  PRIORITY_MISCONCEPTION: "app.review.reasonPriorityMisconception",
  HELP_REQUESTED: "app.review.reasonHelpRequested",
  MANUALLY_SELECTED: "app.review.reasonManuallySelected",
};

const PRIORITY_LABEL_KEY: Record<ReviewQueueItemPriority, string> = {
  LOW: "app.review.priorityLow",
  MEDIUM: "app.review.priorityMedium",
  HIGH: "app.review.priorityHigh",
};

const NEXT_ACTIONS: Record<ReviewQueueItemStatus, ReviewQueueItemStatus[]> = {
  OPEN: ["IN_REVIEW", "DISMISSED"],
  IN_REVIEW: ["OPEN", "RESOLVED", "DISMISSED"],
  RESOLVED: ["OPEN"],
  DISMISSED: ["OPEN"],
};

const ACTION_LABEL_KEY: Record<ReviewQueueItemStatus, string> = {
  IN_REVIEW: "app.review.claim",
  OPEN: "app.review.release",
  RESOLVED: "app.review.resolve",
  DISMISSED: "app.review.dismiss",
};

/** `/app/review` (02_35 §7). Review queue with claim/release/resolve/dismiss/reopen actions. */
export default function StaffReviewPage() {
  return (
    <RequireStaffAuth>
      {() => <ReviewView />}
    </RequireStaffAuth>
  );
}

function ReviewView() {
  const { csrfToken } = useStaffAuth();
  const [status, setStatus] = useState<ReviewQueueItemStatus | "">("");
  const [priority, setPriority] = useState<ReviewQueueItemPriority | "">("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const result = useAsync<ReviewQueueItem[]>(
    () => listReviewQueue({ status: status || undefined, priority: priority || undefined }),
    [status, priority],
  );

  async function handleTransition(item: ReviewQueueItem, targetStatus: ReviewQueueItemStatus) {
    if (!csrfToken) {
      setActionError(t(DASHBOARD_CATALOG_IT_IT, "app.login.title"));
      return;
    }
    setPendingId(item.id);
    setActionError(null);
    try {
      await transitionReviewItemStatus({ reviewItemId: item.id, targetStatus, version: item.version, csrfToken });
      result.reload();
    } catch (caught) {
      setActionError(staffErrorText(caught));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.review.title")}</h1>

      <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.review.filterStatusLabel")}>
        {(fieldProps) => (
          <select {...fieldProps} value={status} onChange={(event) => setStatus(event.target.value as ReviewQueueItemStatus | "")}>
            <option value="">{t(DASHBOARD_CATALOG_IT_IT, "app.review.filterAll")}</option>
            <option value="OPEN">{t(DASHBOARD_CATALOG_IT_IT, "app.status.open")}</option>
            <option value="IN_REVIEW">{t(DASHBOARD_CATALOG_IT_IT, "app.status.inReview")}</option>
            <option value="RESOLVED">{t(DASHBOARD_CATALOG_IT_IT, "app.status.resolved")}</option>
            <option value="DISMISSED">{t(DASHBOARD_CATALOG_IT_IT, "app.status.dismissed")}</option>
          </select>
        )}
      </FormField>
      <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.review.filterPriorityLabel")}>
        {(fieldProps) => (
          <select
            {...fieldProps}
            value={priority}
            onChange={(event) => setPriority(event.target.value as ReviewQueueItemPriority | "")}
          >
            <option value="">{t(DASHBOARD_CATALOG_IT_IT, "app.review.filterAll")}</option>
            <option value="LOW">{t(DASHBOARD_CATALOG_IT_IT, "app.review.priorityLow")}</option>
            <option value="MEDIUM">{t(DASHBOARD_CATALOG_IT_IT, "app.review.priorityMedium")}</option>
            <option value="HIGH">{t(DASHBOARD_CATALOG_IT_IT, "app.review.priorityHigh")}</option>
          </select>
        )}
      </FormField>

      {actionError ? <StatusMessage kind="error">{actionError}</StatusMessage> : null}
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.review.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <Table
          columns={[
            {
              key: "reason",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.review.columnReason"),
              render: (row) => t(DASHBOARD_CATALOG_IT_IT, REASON_LABEL_KEY[row.reason]),
            },
            {
              key: "priority",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.review.columnPriority"),
              render: (row) => t(DASHBOARD_CATALOG_IT_IT, PRIORITY_LABEL_KEY[row.priority]),
            },
            {
              key: "status",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.review.columnStatus"),
              render: (row) => <StatusBadge tone={STATUS_TONE[row.status]}>{t(DASHBOARD_CATALOG_IT_IT, STATUS_LABEL_KEY[row.status])}</StatusBadge>,
            },
            {
              key: "updatedAt",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.review.columnUpdatedAt"),
              render: (row) => new Date(row.updatedAt).toLocaleString("it-IT"),
            },
            {
              key: "attempt",
              header: "",
              render: (row) => (
                <Link href={`/app/attempts/${encodeURIComponent(row.learningAttemptId)}/review?reviewItemId=${encodeURIComponent(row.id)}`}>
                  {t(DASHBOARD_CATALOG_IT_IT, "app.review.openAttempt")}
                </Link>
              ),
            },
            {
              key: "actions",
              header: "",
              render: (row) => (
                <>
                  {NEXT_ACTIONS[row.status].map((target) => (
                    <Button
                      key={target}
                      variant="secondary"
                      disabled={pendingId === row.id}
                      onClick={() => void handleTransition(row, target)}
                    >
                      {t(DASHBOARD_CATALOG_IT_IT, ACTION_LABEL_KEY[target])}
                    </Button>
                  ))}
                </>
              ),
            },
          ]}
          rows={result.data}
          rowKey={(row) => row.id}
        />
      ) : null}
    </main>
  );
}
