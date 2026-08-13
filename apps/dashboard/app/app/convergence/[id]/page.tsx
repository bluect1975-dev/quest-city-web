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
import { StaffApiError } from "../../../../lib/staff-api-error";
import { approveConvergenceRequest, getConvergenceRequest, rejectConvergenceRequest } from "../../../../lib/staff-api-client";
import type { ClassMigrationDecision, ConvergenceRequest, ConvergenceRequestStatus, MigrationPlan } from "../../../../lib/staff-api-types";

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
 * §10.2bis/§12). `GET /convergence-requests/{id}` additively includes the
 * current `migrationPlan` (see `apps/api/lib/convergence-serialization.ts`),
 * so the approve form renders the real classesConsidered list and lets the
 * approving party choose TRANSFER/RETAIN explicitly per class, with the
 * fingerprint taken automatically from the fetched plan rather than typed
 * in. `ownershipDecisions` are omitted here: `ConvergencePreviewService`
 * never populates `ownershipDecisionsPending` in this tranche (no
 * owned-content table yet, same disclosed gap as
 * `ContentPromotionService.promote` always returning CONTENT_NOT_FOUND),
 * so there is nothing for this UI to represent.
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
            <ApproveForm id={id} csrfToken={csrfToken ?? ""} migrationPlan={result.data.migrationPlan ?? null} onDone={result.reload} onReload={result.reload} />
          ) : null}
          {result.data.status === "AWAITING_APPROVALS" ? <RejectForm id={id} csrfToken={csrfToken ?? ""} onDone={result.reload} /> : null}
        </>
      ) : null}
    </main>
  );
}

function initialClassDecisions(migrationPlan: MigrationPlan): Record<string, ClassMigrationDecision> {
  const decided = new Map(migrationPlan.classDecisions.map((entry) => [entry.classId, entry.decision]));
  const initial: Record<string, ClassMigrationDecision> = {};
  for (const cls of migrationPlan.classesConsidered) {
    initial[cls.classId] = decided.get(cls.classId) ?? cls.suggestedDecision;
  }
  return initial;
}

function ApproveForm({
  id,
  csrfToken,
  migrationPlan,
  onDone,
  onReload,
}: {
  id: string;
  csrfToken: string;
  migrationPlan: MigrationPlan | null;
  onDone: () => void;
  onReload: () => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, ClassMigrationDecision>>(() => (migrationPlan ? initialClassDecisions(migrationPlan) : {}));
  const [decisionsFingerprint, setDecisionsFingerprint] = useState<string | null>(migrationPlan?.fingerprint ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Re-seed the per-class selection whenever a *different* plan is loaded
  // (a fresh reload after a stale-fingerprint error, or the first load) --
  // never on every render, so the approver's in-progress choices are not
  // silently reset while they are still deciding.
  if (migrationPlan && migrationPlan.fingerprint !== decisionsFingerprint) {
    setDecisions(initialClassDecisions(migrationPlan));
    setDecisionsFingerprint(migrationPlan.fingerprint);
    setIsStale(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken || !migrationPlan) return;
    setSubmitting(true);
    setError(null);
    setIsStale(false);
    try {
      await approveConvergenceRequest({
        id,
        migrationPlanFingerprint: migrationPlan.fingerprint,
        classDecisions: migrationPlan.classesConsidered.map((cls) => ({ classId: cls.classId, decision: decisions[cls.classId] ?? cls.suggestedDecision })),
        csrfToken,
      });
      onDone();
    } catch (caught) {
      if (caught instanceof StaffApiError && caught.code === "CONVERGENCE_PREVIEW_STALE") {
        setIsStale(true);
      }
      setError(staffErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.approveTitle")}</h2>
      {!migrationPlan ? <StatusMessage kind="loading">{t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.noPlanMessage")}</StatusMessage> : null}
      {migrationPlan ? (
        <form onSubmit={handleSubmit}>
          <h3>{t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.classesTitle")}</h3>
          {migrationPlan.classesConsidered.map((cls) => (
            <fieldset key={cls.classId}>
              <legend>
                {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.classIdLabel")}: {cls.classId} (
                {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.studentsInClassLabel")}: {cls.studentsInClass})
              </legend>
              {cls.hasNonSchoolStudents ? (
                <StatusMessage kind="error">{t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.hasNonSchoolStudentsWarning")}</StatusMessage>
              ) : null}
              <label>
                <input
                  type="radio"
                  name={`decision-${cls.classId}`}
                  value="TRANSFER"
                  checked={decisions[cls.classId] === "TRANSFER"}
                  onChange={() => setDecisions((prev) => ({ ...prev, [cls.classId]: "TRANSFER" }))}
                />
                {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.decisionTransfer")}
              </label>
              <label>
                <input
                  type="radio"
                  name={`decision-${cls.classId}`}
                  value="RETAIN"
                  checked={decisions[cls.classId] === "RETAIN"}
                  onChange={() => setDecisions((prev) => ({ ...prev, [cls.classId]: "RETAIN" }))}
                />
                {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.decisionRetain")}
              </label>
            </fieldset>
          ))}
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.fingerprintCurrentLabel")}: {migrationPlan.fingerprint}
          </p>
          <Button type="submit" disabled={submitting || !csrfToken}>
            {submitting
              ? t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.approveSubmitting")
              : t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.approveSubmit")}
          </Button>
        </form>
      ) : null}
      {isStale ? (
        <StatusMessage kind="error">
          {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.approveStaleFingerprintError")}
          <Button type="button" variant="secondary" onClick={onReload}>
            {t(DASHBOARD_CATALOG_IT_IT, "app.convergenceDetail.reloadPlanButton")}
          </Button>
        </StatusMessage>
      ) : null}
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
