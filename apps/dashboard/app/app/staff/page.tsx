"use client";

import { useState } from "react";
import { Button, EmptyState, FormField, StatusBadge, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { useAsync } from "../../../lib/useAsync";
import { staffErrorText } from "../../../lib/staff-error-text";
import { inviteStaffMember, listStaffMembers, updateStaffMembershipStatus } from "../../../lib/staff-api-client";
import type { CreateStaffInvitationResult, MembershipStatusAction, StaffMember, StaffTenantMembershipStatus } from "../../../lib/staff-api-types";

/** `/app/staff` (02_35 v1.2 §11bis.4, §11bis.14). SCHOOL_ADMIN-only surface — staff.invite/staff.member.read/staff.membership.suspend/staff.membership.revoke. */
export default function StaffPage() {
  return <RequireStaffAuth>{(context) => (context.role === "SCHOOL_ADMIN" ? <StaffView /> : <NotAuthorized />)}</RequireStaffAuth>;
}

function NotAuthorized() {
  return <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>;
}

const STATUS_TONE: Record<StaffTenantMembershipStatus, "neutral" | "info" | "warning" | "danger" | "success"> = {
  INVITED: "info",
  ACTIVE: "success",
  SUSPENDED: "warning",
  REVOKED: "danger",
};

function statusLabel(status: StaffTenantMembershipStatus): string {
  const key = status.toLowerCase() as "invited" | "active" | "suspended" | "revoked";
  return t(DASHBOARD_CATALOG_IT_IT, `app.status.${key}`);
}

function StaffView() {
  const { csrfToken } = useStaffAuth();
  const result = useAsync<StaffMember[]>(() => listStaffMembers(), []);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<CreateStaffInvitationResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!csrfToken) return;
    setInviting(true);
    setInviteError(null);
    setInviteResult(null);
    try {
      const created = await inviteStaffMember({ email: inviteEmail, csrfToken });
      setInviteResult(created);
      setInviteEmail("");
      result.reload();
    } catch (error) {
      setInviteError(staffErrorText(error));
    } finally {
      setInviting(false);
    }
  }

  async function handleStatusAction(staffTenantMembershipId: string, action: MembershipStatusAction) {
    if (!csrfToken) return;
    if (action === "REVOKE" && !window.confirm(t(DASHBOARD_CATALOG_IT_IT, "app.staff.revokeConfirm"))) {
      return;
    }
    setActionBusyId(staffTenantMembershipId);
    setActionError(null);
    try {
      await updateStaffMembershipStatus({ staffTenantMembershipId, action, csrfToken });
      result.reload();
    } catch (error) {
      setActionError(staffErrorText(error));
    } finally {
      setActionBusyId(null);
    }
  }

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.staff.title")}</h1>

      <section>
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.staff.inviteTitle")}</h2>
        <form onSubmit={handleInvite}>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.staff.inviteEmailLabel")}>
            {(fieldProps) => (
              <input {...fieldProps} type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            )}
          </FormField>
          <Button type="submit" disabled={inviting || !csrfToken}>
            {inviting ? t(DASHBOARD_CATALOG_IT_IT, "app.staff.inviteSubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.staff.inviteSubmit")}
          </Button>
        </form>
        {inviteError ? <StatusMessage kind="error">{inviteError}</StatusMessage> : null}
        {inviteResult ? (
          <p role="status">
            {inviteResult.identityReused
              ? t(DASHBOARD_CATALOG_IT_IT, "app.staff.inviteResultReused")
              : t(DASHBOARD_CATALOG_IT_IT, "app.staff.inviteResultNew")}
            <br />
            {t(DASHBOARD_CATALOG_IT_IT, "app.staff.inviteTokenLabel")} <code>{inviteResult.acceptanceToken}</code>
          </p>
        ) : null}
      </section>

      <section>
        {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
        {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
        {actionError ? <StatusMessage kind="error">{actionError}</StatusMessage> : null}
        {result.status === "success" && result.data.length === 0 ? <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.staff.empty")} /> : null}
        {result.status === "success" && result.data.length > 0 ? (
          <Table
            columns={[
              { key: "email", header: t(DASHBOARD_CATALOG_IT_IT, "app.staff.columnEmail"), render: (row) => row.email },
              {
                key: "role",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.staff.columnRole"),
                render: (row) =>
                  row.role === "TEACHER"
                    ? t(DASHBOARD_CATALOG_IT_IT, "app.staff.roleTeacher")
                    : t(DASHBOARD_CATALOG_IT_IT, "app.staff.roleSchoolAdmin"),
              },
              {
                key: "status",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.staff.columnStatus"),
                render: (row) => <StatusBadge tone={STATUS_TONE[row.status]}>{statusLabel(row.status)}</StatusBadge>,
              },
              {
                key: "classScope",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.staff.columnClassScope"),
                render: (row) => (row.classScope === null ? t(DASHBOARD_CATALOG_IT_IT, "app.staff.classScopeAll") : String(row.classScope.length)),
              },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <>
                    {row.status === "ACTIVE" ? (
                      <Button
                        variant="secondary"
                        disabled={actionBusyId === row.staffTenantMembershipId || !csrfToken}
                        onClick={() => void handleStatusAction(row.staffTenantMembershipId, "SUSPEND")}
                      >
                        {t(DASHBOARD_CATALOG_IT_IT, "app.staff.suspendAction")}
                      </Button>
                    ) : null}
                    {row.status === "SUSPENDED" ? (
                      <Button
                        variant="secondary"
                        disabled={actionBusyId === row.staffTenantMembershipId || !csrfToken}
                        onClick={() => void handleStatusAction(row.staffTenantMembershipId, "REACTIVATE")}
                      >
                        {t(DASHBOARD_CATALOG_IT_IT, "app.staff.reactivateAction")}
                      </Button>
                    ) : null}
                    {row.status !== "REVOKED" ? (
                      <Button
                        variant="secondary"
                        disabled={actionBusyId === row.staffTenantMembershipId || !csrfToken}
                        onClick={() => void handleStatusAction(row.staffTenantMembershipId, "REVOKE")}
                      >
                        {t(DASHBOARD_CATALOG_IT_IT, "app.staff.revokeAction")}
                      </Button>
                    ) : null}
                  </>
                ),
              },
            ]}
            rows={result.data}
            rowKey={(row) => row.staffTenantMembershipId}
          />
        ) : null}
      </section>
    </main>
  );
}
