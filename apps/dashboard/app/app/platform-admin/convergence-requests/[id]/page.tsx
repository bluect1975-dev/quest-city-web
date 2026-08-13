"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, StatusBadge, StatusMessage, Table, type StatusBadgeTone } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../../lib/RequirePlatformAuth";
import { usePlatformAuth } from "../../../../../lib/platform-auth-context";
import { useAsyncPlatform } from "../../../../../lib/useAsyncPlatform";
import { platformErrorText } from "../../../../../lib/platform-error-text";
import {
  executeConvergenceRequest,
  generateIdempotencyKey,
  getConvergenceRequest,
  previewConvergenceRequest,
  rollbackReviewConvergenceRequest,
} from "../../../../../lib/platform-api-client";
import type {
  Capability,
  ConvergenceRequest,
  ConvergenceRequestStatus,
  MigrationExecution,
  MigrationPlan,
  PlatformContext,
  RollbackReviewDecision,
} from "../../../../../lib/platform-api-types";

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

const STATUS_TONE_BY_STATUS: Record<ConvergenceRequestStatus, StatusBadgeTone> = {
  REQUESTED: "neutral",
  PREVIEW_READY: "info",
  AWAITING_APPROVALS: "warning",
  APPROVED: "info",
  READY_TO_EXECUTE: "info",
  EXECUTING: "info",
  COMPLETED: "success",
  REJECTED: "danger",
  BLOCKED: "danger",
  FAILED: "danger",
  ROLLBACK_REVIEW_REQUIRED: "warning",
};

function hasCapability(capabilities: Capability[], capability: Capability): boolean {
  return capabilities.includes(capability);
}

/**
 * `/app/platform-admin/convergence-requests/{id}` (contracts/quest-city-platform-openapi-v1_12.yaml,
 * 02_38 v1.4 §9-10/§10.2bis/§10.4-5). Generate/regenerate the migration
 * preview (also the identity-verification step), execute an approved
 * request, and resolve a ROLLBACK_REVIEW_REQUIRED outcome -- the three
 * PLATFORM_ADMIN-only actions in the convergence workflow.
 */
export default function PlatformAdminConvergenceRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  return <RequirePlatformAuth>{(context) => <ConvergenceRequestDetailView id={id} context={context} />}</RequirePlatformAuth>;
}

function ConvergenceRequestDetailView({ id, context }: { id: string; context: PlatformContext }) {
  const { csrfToken } = usePlatformAuth();
  const result = useAsyncPlatform<ConvergenceRequest>(() => getConvergenceRequest(id), [id]);

  const canPreview = hasCapability(context.capabilities, "convergence.preview");
  const canExecute = hasCapability(context.capabilities, "convergence.execute");
  const canReviewRollback = hasCapability(context.capabilities, "convergence.rollback.review");

  const [migrationPlan, setMigrationPlan] = useState<MigrationPlan | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [migrationExecution, setMigrationExecution] = useState<MigrationExecution | null>(null);
  const [executeBusy, setExecuteBusy] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  const [rollbackBusy, setRollbackBusy] = useState<RollbackReviewDecision | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  async function handlePreview() {
    if (!csrfToken) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const plan = await previewConvergenceRequest({ id, csrfToken });
      setMigrationPlan(plan);
      result.reload();
    } catch (caught) {
      setPreviewError(platformErrorText(caught));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleExecute() {
    if (!csrfToken) return;
    setExecuteBusy(true);
    setExecuteError(null);
    try {
      const execution = await executeConvergenceRequest({ id, csrfToken, idempotencyKey: generateIdempotencyKey() });
      setMigrationExecution(execution);
      result.reload();
    } catch (caught) {
      setExecuteError(platformErrorText(caught));
    } finally {
      setExecuteBusy(false);
    }
  }

  async function handleRollbackReview(decision: RollbackReviewDecision) {
    if (!csrfToken) return;
    setRollbackBusy(decision);
    setRollbackError(null);
    try {
      await rollbackReviewConvergenceRequest({ id, decision, csrfToken });
      result.reload();
    } catch (caught) {
      setRollbackError(platformErrorText(caught));
    } finally {
      setRollbackBusy(null);
    }
  }

  return (
    <main>
      <nav>
        <Link href="/app/platform-admin/convergence-requests">
          {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.backToLookup")}
        </Link>
      </nav>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.title")}</h1>

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.statusLabel")}:{" "}
            <StatusBadge tone={STATUS_TONE_BY_STATUS[result.data.status]}>
              {t(DASHBOARD_CATALOG_IT_IT, STATUS_KEY_BY_STATUS[result.data.status])}
            </StatusBadge>
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.sourceTenantIdLabel")}: {result.data.sourceTenantId}
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.targetTenantIdLabel")}: {result.data.targetTenantId}
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.createdAtLabel")}:{" "}
            {new Date(result.data.createdAt).toLocaleString()}
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.updatedAtLabel")}:{" "}
            {new Date(result.data.updatedAt).toLocaleString()}
          </p>

          {canPreview ? (
            <section className="qc-card">
              <Button type="button" disabled={previewBusy || !csrfToken} onClick={() => void handlePreview()}>
                {previewBusy
                  ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.previewSubmitting")
                  : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.previewAction")}
              </Button>
              {previewError ? <StatusMessage kind="error">{previewError}</StatusMessage> : null}
            </section>
          ) : null}

          {migrationPlan ? <MigrationPlanView plan={migrationPlan} /> : null}

          {canExecute && (result.data.status === "APPROVED" || result.data.status === "READY_TO_EXECUTE") ? (
            <section className="qc-card">
              <Button type="button" disabled={executeBusy || !csrfToken} onClick={() => void handleExecute()}>
                {executeBusy
                  ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.executeSubmitting")
                  : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.executeAction")}
              </Button>
              {executeError ? <StatusMessage kind="error">{executeError}</StatusMessage> : null}
            </section>
          ) : null}

          {migrationExecution ? <MigrationExecutionView execution={migrationExecution} /> : null}

          {canReviewRollback && result.data.status === "ROLLBACK_REVIEW_REQUIRED" ? (
            <section className="qc-card">
              <h2>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.rollbackReviewTitle")}</h2>
              <Button
                type="button"
                disabled={rollbackBusy !== null || !csrfToken}
                onClick={() => void handleRollbackReview("ACCEPT_PARTIAL")}
              >
                {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.acceptPartialAction")}
              </Button>{" "}
              <Button
                type="button"
                variant="secondary"
                disabled={rollbackBusy !== null || !csrfToken}
                onClick={() => void handleRollbackReview("RETRY_REMAINING")}
              >
                {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.retryRemainingAction")}
              </Button>
              {rollbackError ? <StatusMessage kind="error">{rollbackError}</StatusMessage> : null}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function MigrationPlanView({ plan }: { plan: MigrationPlan }) {
  return (
    <section className="qc-card">
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.planTitle")}</h2>
      <p>
        {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.planFingerprintLabel")}: <code>{plan.fingerprint}</code>
      </p>
      <p>
        {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.planStatusLabel")}: {plan.status}
      </p>

      {plan.classesConsidered.length > 0 ? (
        <>
          <h3>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.classesConsideredTitle")}</h3>
          <Table
            columns={[
              { key: "classId", header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.columnClassId"), render: (row) => row.classId },
              {
                key: "suggestedDecision",
                header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.columnSuggestedDecision"),
                render: (row) =>
                  row.suggestedDecision === "TRANSFER"
                    ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.decisionTransfer")
                    : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.decisionRetain"),
              },
              {
                key: "studentsInClass",
                header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.columnStudentsInClass"),
                render: (row) => row.studentsInClass ?? "",
              },
              {
                key: "hasNonSchoolStudents",
                header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.columnHasNonSchoolStudents"),
                render: (row) =>
                  row.hasNonSchoolStudents
                    ? t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.booleanYes")
                    : t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.booleanNo"),
              },
            ]}
            rows={plan.classesConsidered}
            rowKey={(row) => row.classId}
          />
        </>
      ) : null}

      {plan.warnings.length > 0 ? (
        <>
          <h3>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.warningsTitle")}</h3>
          <ul>
            {plan.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </>
      ) : null}

      {plan.blockers.length > 0 ? (
        <>
          <h3>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.blockersTitle")}</h3>
          <ul>
            {plan.blockers.map((blocker, index) => (
              <li key={index}>{blocker}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function MigrationExecutionView({ execution }: { execution: MigrationExecution }) {
  return (
    <section className="qc-card">
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.executionTitle")}</h2>
      <p>
        {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.executionStatusLabel")}: {execution.executionStatus}
      </p>
      <p>
        {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.unitsTotalLabel")}: {execution.unitsTotal}
      </p>
      <p>
        {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.unitsMigratedLabel")}: {execution.unitsMigrated}
      </p>
      <p>
        {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.unitsFailedLabel")}: {execution.unitsFailed}
      </p>
      {execution.failureReason ? (
        <p>
          {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.convergenceRequestDetail.failureReasonLabel")}: {execution.failureReason}
        </p>
      ) : null}
    </section>
  );
}
