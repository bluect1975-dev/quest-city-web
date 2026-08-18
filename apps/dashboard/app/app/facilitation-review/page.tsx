"use client";

import { useState } from "react";
import { Button, EmptyState, FormField, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { useAsync } from "../../../lib/useAsync";
import { staffErrorText } from "../../../lib/staff-error-text";
import { listFacilitationProposalReviewQueue, reviewFacilitationProposal } from "../../../lib/staff-api-client";
import type { FacilitationProposal, FacilitationProposalStatus } from "../../../lib/staff-api-types";

/**
 * `/app/facilitation-review` (`contracts/quest-city-platform-openapi-v1_14.yaml`,
 * 02_26 v1.17 §38.2, 02_39 §6ter/§42). TEACHER and SUPPORT_TEACHER only --
 * ASACOM never reviews (proposal-only role). Server resolves reviewer
 * eligibility; the client never lets the user pick a reviewer.
 */
export default function FacilitationReviewPage() {
  return (
    <RequireStaffAuth>
      {(context) => (context.role === "TEACHER" || context.role === "SUPPORT_TEACHER" ? <FacilitationReviewView /> : <NotAuthorized />)}
    </RequireStaffAuth>
  );
}

function NotAuthorized() {
  return <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>;
}

function FacilitationReviewView() {
  const { csrfToken } = useStaffAuth();
  const [statusFilter, setStatusFilter] = useState<FacilitationProposalStatus>("SUBMITTED");
  const result = useAsync<FacilitationProposal[]>(() => listFacilitationProposalReviewQueue(statusFilter), [statusFilter]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleReview(proposal: FacilitationProposal, decision: "ACCEPT" | "REJECT") {
    if (!csrfToken) return;
    setBusyId(proposal.id);
    setError(null);
    try {
      const note = reviewNotes[proposal.id];
      await reviewFacilitationProposal({
        id: proposal.id,
        decision,
        ...(note ? { reviewNote: note } : {}),
        ifMatchVersion: proposal.version,
        csrfToken,
      });
      result.reload();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.title")}</h1>
      <section className="qc-card">
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.statusFilterLabel")}>
          {(fieldProps) => (
            <select {...fieldProps} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FacilitationProposalStatus)}>
              <option value="SUBMITTED">SUBMITTED</option>
              <option value="ACCEPTED">{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.proposalStatusAccepted")}</option>
              <option value="REJECTED">{t(DASHBOARD_CATALOG_IT_IT, "app.supportStudentDetail.proposalStatusRejected")}</option>
            </select>
          )}
        </FormField>

        {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
        {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
        {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
        {result.status === "success" && result.data.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.empty")} />
        ) : null}
        {result.status === "success" && result.data.length > 0 ? (
          <Table
            columns={[
              { key: "student", header: t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.columnStudent"), render: (row) => row.studentProfileId },
              {
                key: "type",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.columnType"),
                render: (row) => {
                  if (row.proposalType === "DIFFICULTY") return t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.typeDifficulty");
                  if (row.proposalType === "LEARNING_PATH_ADJUSTMENT") return t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.typeLearningPathAdjustment");
                  return t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.typeFacilitation");
                },
              },
              {
                key: "category",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.columnCategory"),
                render: (row) => (row.proposalType === "LEARNING_PATH_ADJUSTMENT" ? (row.targetLearningPath?.resourceRef ?? "—") : (row.targetCategory ?? "—")),
              },
              { key: "createdAt", header: t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.columnCreatedAt"), render: (row) => new Date(row.createdAt).toLocaleString("it-IT") },
              {
                key: "review",
                header: "",
                render: (row) =>
                  row.status === "SUBMITTED" ? (
                    <div>
                      <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.reviewNoteLabel")}>
                        {(fieldProps) => (
                          <input
                            {...fieldProps}
                            type="text"
                            value={reviewNotes[row.id] ?? ""}
                            onChange={(e) => setReviewNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          />
                        )}
                      </FormField>
                      <Button disabled={busyId === row.id || !csrfToken} onClick={() => void handleReview(row, "ACCEPT")}>
                        {t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.acceptAction")}
                      </Button>
                      <Button variant="secondary" disabled={busyId === row.id || !csrfToken} onClick={() => void handleReview(row, "REJECT")}>
                        {t(DASHBOARD_CATALOG_IT_IT, "app.facilitationReview.rejectAction")}
                      </Button>
                    </div>
                  ) : (
                    row.status
                  ),
              },
            ]}
            rows={result.data}
            rowKey={(row) => row.id}
          />
        ) : null}
      </section>
    </main>
  );
}
