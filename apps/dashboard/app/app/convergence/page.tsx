"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, EmptyState, FormField, StatusBadge, StatusMessage, Table, type StatusBadgeTone } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { useAsync } from "../../../lib/useAsync";
import { useTenantMemberships } from "../../../lib/useTenantMemberships";
import { staffErrorText } from "../../../lib/staff-error-text";
import { createConvergenceRequest, listConvergenceRequests, switchSessionTenant } from "../../../lib/staff-api-client";
import type { ConvergenceRequest, ConvergenceRequestStatus, StaffContext, TenantMembership } from "../../../lib/staff-api-types";

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

/**
 * `/app/convergence` (contracts/quest-city-platform-openapi-v1_12.yaml,
 * 02_38 v1.4 §9-10, 02_35 v1.5 §11quater). Shared staff-session page for
 * both INDEPENDENT_EDUCATOR (initiates as sourceTenantId) and SCHOOL_ADMIN
 * (initiates as targetTenantId) -- TEACHER has no party role in this
 * workflow and only sees the list. No dedicated shared nav/layout
 * component exists yet under `apps/dashboard/app/app/` (only
 * `app/app/layout.tsx`, which just wraps `StaffAuthProvider`), so the
 * tenant-switcher widget (item 5 of this tranche's scope) lives here at
 * the top of this page rather than in a shared shell.
 */
export default function StaffConvergencePage() {
  return <RequireStaffAuth>{(context) => <ConvergenceView context={context} />}</RequireStaffAuth>;
}

function ConvergenceView({ context }: { context: StaffContext }) {
  const { csrfToken } = useStaffAuth();
  const result = useAsync<ConvergenceRequest[]>(() => listConvergenceRequests(), []);
  const canCreate = context.role === "INDEPENDENT_EDUCATOR" || context.role === "SCHOOL_ADMIN";

  return (
    <main>
      <TenantSwitcher csrfToken={csrfToken ?? ""} />

      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.convergence.title")}</h1>

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.convergence.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <Table
          columns={[
            { key: "id", header: t(DASHBOARD_CATALOG_IT_IT, "app.convergence.columnId"), render: (row) => row.id },
            {
              key: "sourceTenantId",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.convergence.columnSourceTenant"),
              render: (row) => row.sourceTenantId,
            },
            {
              key: "targetTenantId",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.convergence.columnTargetTenant"),
              render: (row) => row.targetTenantId,
            },
            {
              key: "status",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.convergence.columnStatus"),
              render: (row) => (
                <StatusBadge tone={STATUS_TONE_BY_STATUS[row.status]}>
                  {t(DASHBOARD_CATALOG_IT_IT, STATUS_KEY_BY_STATUS[row.status])}
                </StatusBadge>
              ),
            },
            {
              key: "open",
              header: "",
              render: (row) => (
                <Link href={`/app/convergence/${encodeURIComponent(row.id)}`}>{t(DASHBOARD_CATALOG_IT_IT, "app.convergence.open")}</Link>
              ),
            },
          ]}
          rows={result.data}
          rowKey={(row) => row.id}
        />
      ) : null}

      {canCreate ? (
        <CreateConvergenceRequestForm role={context.role} ownTenantId={context.tenantId} ownStaffAccountId={context.staffAccountId} csrfToken={csrfToken ?? ""} onCreated={result.reload} />
      ) : null}
    </main>
  );
}

function CreateConvergenceRequestForm({
  role,
  ownTenantId,
  ownStaffAccountId,
  csrfToken,
  onCreated,
}: {
  role: StaffContext["role"];
  ownTenantId: string;
  ownStaffAccountId: string;
  csrfToken: string;
  onCreated: () => void;
}) {
  const [otherTenantId, setOtherTenantId] = useState("");
  const [educatorStaffAccountId, setEducatorStaffAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csrfToken) return;
    setSubmitting(true);
    setError(null);
    try {
      if (role === "INDEPENDENT_EDUCATOR") {
        // No tenant-search UI exists yet (minimal pass) -- the caller's own
        // tenant/account are the source/educator, only the target school's
        // id is collected from the form.
        await createConvergenceRequest({
          sourceTenantId: ownTenantId,
          targetTenantId: otherTenantId,
          educatorStaffAccountId: ownStaffAccountId,
          csrfToken,
        });
      } else {
        await createConvergenceRequest({
          sourceTenantId: otherTenantId,
          targetTenantId: ownTenantId,
          educatorStaffAccountId,
          csrfToken,
        });
      }
      setOtherTenantId("");
      setEducatorStaffAccountId("");
      onCreated();
    } catch (caught) {
      setError(staffErrorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="qc-card">
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.convergence.createTitle")}</h2>
      <form onSubmit={handleSubmit}>
        <FormField
          label={t(
            DASHBOARD_CATALOG_IT_IT,
            role === "INDEPENDENT_EDUCATOR" ? "app.convergence.targetTenantIdLabel" : "app.convergence.sourceTenantIdLabel",
          )}
          hint={t(
            DASHBOARD_CATALOG_IT_IT,
            role === "INDEPENDENT_EDUCATOR" ? "app.convergence.targetTenantIdHint" : "app.convergence.sourceTenantIdHint",
          )}
        >
          {(fieldProps) => (
            <input {...fieldProps} type="text" required value={otherTenantId} onChange={(e) => setOtherTenantId(e.target.value)} />
          )}
        </FormField>
        {role === "SCHOOL_ADMIN" ? (
          <FormField
            label={t(DASHBOARD_CATALOG_IT_IT, "app.convergence.educatorStaffAccountIdLabel")}
            hint={t(DASHBOARD_CATALOG_IT_IT, "app.convergence.educatorStaffAccountIdHint")}
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                type="text"
                required
                value={educatorStaffAccountId}
                onChange={(e) => setEducatorStaffAccountId(e.target.value)}
              />
            )}
          </FormField>
        ) : null}
        <Button type="submit" disabled={submitting || !csrfToken}>
          {submitting ? t(DASHBOARD_CATALOG_IT_IT, "app.convergence.createSubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.convergence.createSubmit")}
        </Button>
      </form>
      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
    </section>
  );
}

/**
 * Item 5 of this tranche's scope: `GET /me/tenant-memberships` +
 * `POST /staff-auth/session/switch-tenant`. Reloads the page on success
 * (per the task contract) so every provider/context re-derives from the
 * freshly issued session cookie, same as after any other session-mutating
 * action in this app.
 */
function TenantSwitcher({ csrfToken }: { csrfToken: string }) {
  const result = useTenantMemberships();
  const [switchingTenantId, setSwitchingTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSwitch(tenantId: string) {
    if (!csrfToken) return;
    setSwitchingTenantId(tenantId);
    setError(null);
    try {
      await switchSessionTenant({ tenantId, csrfToken });
      window.location.reload();
    } catch (caught) {
      setError(staffErrorText(caught));
      setSwitchingTenantId(null);
    }
  }

  return (
    <section className="qc-card">
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.tenantSwitcher.title")}</h2>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.tenantSwitcher.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <Table
          columns={[
            {
              key: "tenantName",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.tenantSwitcher.columnTenantName"),
              render: (row: TenantMembership) => row.tenantName ?? row.tenantId,
            },
            {
              key: "tenantType",
              header: t(DASHBOARD_CATALOG_IT_IT, "app.tenantSwitcher.columnTenantType"),
              render: (row: TenantMembership) =>
                row.tenantType === "SCHOOL"
                  ? t(DASHBOARD_CATALOG_IT_IT, "app.tenantSwitcher.typeSchool")
                  : t(DASHBOARD_CATALOG_IT_IT, "app.tenantSwitcher.typeIndependentEducator"),
            },
            { key: "role", header: t(DASHBOARD_CATALOG_IT_IT, "app.tenantSwitcher.columnRole"), render: (row: TenantMembership) => row.role },
            {
              key: "switch",
              header: "",
              render: (row: TenantMembership) => (
                <Button type="button" disabled={switchingTenantId !== null || !csrfToken} onClick={() => void handleSwitch(row.tenantId)}>
                  {switchingTenantId === row.tenantId
                    ? t(DASHBOARD_CATALOG_IT_IT, "app.tenantSwitcher.switching")
                    : t(DASHBOARD_CATALOG_IT_IT, "app.tenantSwitcher.switchAction")}
                </Button>
              ),
            },
          ]}
          rows={result.data}
          rowKey={(row) => row.tenantId}
        />
      ) : null}
      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
    </section>
  );
}
