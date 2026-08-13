"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, FormField, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../../lib/staff-auth-context";
import { useAsync } from "../../../../lib/useAsync";
import { staffErrorText } from "../../../../lib/staff-error-text";
import { approveConvergenceRequest, getConvergenceRequest, rejectConvergenceRequest } from "../../../../lib/staff-api-client";
import type { ConvergenceRequest, ConvergenceRequestStatus } from "../../../../lib/staff-api-types";

const STATUS_KEY_BY_STATUS: Record<ConvergenceRequestStatus, string> = {
  REQUESTED: "app.convergence.statusRequested",
  PREVIEW_READY: "app.convergence.statusPreviewReady",
  AWAITING_APPROVALS: "app.convergence.statusAwaitingApprovals",
  APPROVED: "app.convergence.statusApproved",
  READY_TO_EXECUTE: "app.convergence.statusReadyToExecute",
  EXECUTING: "app.convergence.statusExecuting",
  COMPLETED: "app.convergence.statusCompleted",
  REJECTED: "app.convergence.statusRejected",
  BLOCKED: "app.convergence.statusBlocked",
  FAILED: "app.convergence.statusFailed",
  ROLLBACK_REVIEW_REQUIRED: "app.convergence.statusRollbackReviewRequired",
};

/**
 * `/app/convergence/{id}` staff-session detail/approval page (02_38 v1.4
 * §10.2bis/§12). There is no staff-session-reachable endpoint to fetch the
 * body of the current migration plan (only PLATFORM_ADMIN's `POST
 * .../preview` returns one) -- so, per this tranche's minimal-pass scope,
 * the approve form takes the migration plan fingerprint as a plain text
 * input (relayed out-of-band from whoever ran the preview step) rather
 * than a read-only auto-populated field, and never offers per-class /
 * per-resource decision controls (both optional on the wire per
 * `ApproveConvergenceRequestRequest`).
 */
export default function StaffConvergenceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  return <RequireStaffAuth>{() => <ConvergenceDetailView id={id} />}</RequireStaffAuth>;
}

function ConvergenceDetailView({ id }: { id: string }) {
  const { csrfToken } = useStaffAuth();
  const result = useAsync<ConvergenceRequest>(() => getConvergenceRequest(id), [id]);

  return (
    <main>
      <nav>
        <Link href="/app/convergence">{t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.backToList")}</Link>
      </nav>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.title")}</h1>

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.statusLabel")}: {t(DASHBOARD_CATALOG_IT_IT, STATUS_KEY_BY_STATUS[result.data.status])}
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.sourceTenantIdLabel")}: {result.data.sourceTenantId}
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.targetTenantIdLabel")}: {result.data.targetTenantId}
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.educatorStaffAccountIdLabel")}: {result.data.educatorStaffAccountId}
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.createdAtLabel")}: {new Date(result.data.createdAt).toLocaleString()}
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.updatedAtLabel")}: {new Date(result.data.updatedAt).toLocaleString()}
          </p>
          {result.data.rejectionReason ? (
            <p>
              {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.rejectionReasonLabel")}: {result.data.rejectionReason}
            </p>
          ) : null}
          {result.data.failureCode ? (
            <p>
              {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.failureCodeLabel")}: {result.data.failureCode}
            </p>
          ) : null}

          {result.data.status === "PREVIEW_READY" || result.data.status === "AWAITING_APPROVALS" ? (
            <ApproveForm id={id} csrfToken={csrfToken ?? ""} onDone={result.reload} />
          ) : null}
          {result.data.status === "AWAITING_APPROVALS" ? <RejectForm id={id} csrfToken={csrfToken ?? ""} onDone={result.reload} /> : null}
        </>
      ) : null}
    </main>
  );
}

function ApproveForm({ id, csrfToken, onDone }: { id: string; csrfToken: string; onDone: () => void }) {
  const [fingerprint, setFingerprint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await approveConvergenceRequest({ id, migrationPlanFingerprint: fingerprint, csrfToken });
      setFingerprint("");
      onDone();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.approveTitle")}</h2>
      <form onSubmit={handleSubmit}>
        <FormField
          label={t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.approveFingerprintLabel")}
          hint={t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.approveFingerprintHint")}
        >
          {(fieldProps) => (
            <input {...fieldProps} type="text" required value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} />
          )}
        </FormField>
        <Button type="submit" disabled={submitting || !csrfToken}>
          {submitting
            ? t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.approveSubmitting")
            : t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.approveSubmit")}
        </Button>
      </form>
      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
    </section>
  );
}

function RejectForm({ id, csrfToken, onDone }: { id: string; csrfToken: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await rejectConvergenceRequest({ id, rejectionReason: reason || null, csrfToken });
      setReason("");
      onDone();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.rejectTitle")}</h2>
      <form onSubmit={handleSubmit}>
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.rejectReasonLabel")}>
          {(fieldProps) => <textarea {...fieldProps} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </FormField>
        <Button type="submit" variant="secondary" disabled={submitting || !csrfToken}>
          {submitting
            ? t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.rejectSubmitting")
            : t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.rejectSubmit")}
        </Button>
      </form>
      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
    </section>
  );
}
