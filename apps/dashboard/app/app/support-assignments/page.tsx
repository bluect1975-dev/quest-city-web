"use client";

import { useState, type FormEvent } from "react";
import { Button, EmptyState, FormField, StatusBadge, StatusMessage, Table, type StatusBadgeTone } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../../lib/staff-auth-context";
import { useAsync } from "../../../lib/useAsync";
import { staffErrorText } from "../../../lib/staff-error-text";
import {
  createSupportStudentAssignment,
  listSupportStudentAssignments,
  transitionSupportStudentAssignmentStatus,
} from "../../../lib/staff-api-client";
import type { SupportStudentAssignment, SupportStudentAssignmentStatus } from "../../../lib/staff-api-types";

/**
 * `/app/support-assignments` (02_39 §23, 02_26 v1.16 §37.2). SCHOOL_ADMIN-only
 * -- creates/lists/ends/revokes `support_student_assignment` rows for
 * ASACOM/SUPPORT_TEACHER. Never the TEACHER, never self-assignment.
 */
export default function SupportAssignmentsPage() {
  return <RequireStaffAuth>{(context) => (context.role === "SCHOOL_ADMIN" ? <SupportAssignmentsView /> : <NotAuthorized />)}</RequireStaffAuth>;
}

function NotAuthorized() {
  return <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>;
}

const STATUS_TONE: Record<SupportStudentAssignmentStatus, StatusBadgeTone> = {
  ACTIVE: "success",
  ENDED: "neutral",
  REVOKED: "danger",
};

const STATUS_LABEL_KEY: Record<SupportStudentAssignmentStatus, string> = {
  ACTIVE: "app.supportAssignments.statusActive",
  ENDED: "app.supportAssignments.statusEnded",
  REVOKED: "app.supportAssignments.statusRevoked",
};

function SupportAssignmentsView() {
  const { csrfToken } = useStaffAuth();
  const [statusFilter, setStatusFilter] = useState<SupportStudentAssignmentStatus | "">("");
  const result = useAsync<SupportStudentAssignment[]>(
    () => listSupportStudentAssignments(statusFilter ? { status: statusFilter } : {}),
    [statusFilter],
  );

  const [membershipId, setMembershipId] = useState("");
  const [studentPublicId, setStudentPublicId] = useState("");
  const [classId, setClassId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!csrfToken) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createSupportStudentAssignment({
        staffTenantMembershipId: membershipId,
        studentPublicId,
        ...(classId ? { classId } : {}),
        csrfToken,
      });
      setMembershipId("");
      setStudentPublicId("");
      setClassId("");
      result.reload();
    } catch (error) {
      setCreateError(staffErrorText(error));
    } finally {
      setCreating(false);
    }
  }

  async function handleTransition(id: string, targetStatus: "ENDED" | "REVOKED") {
    if (!csrfToken) return;
    if (targetStatus === "REVOKED" && !window.confirm(t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.revokeConfirm"))) {
      return;
    }
    setActionBusyId(id);
    setActionError(null);
    try {
      await transitionSupportStudentAssignmentStatus({ id, targetStatus, csrfToken });
      result.reload();
    } catch (error) {
      setActionError(staffErrorText(error));
    } finally {
      setActionBusyId(null);
    }
  }

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.title")}</h1>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.createTitle")}</h2>
        <form onSubmit={handleCreate}>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.createMembershipIdLabel")}>
            {(fieldProps) => (
              <input {...fieldProps} type="text" required value={membershipId} onChange={(e) => setMembershipId(e.target.value)} />
            )}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.createStudentPublicIdLabel")}>
            {(fieldProps) => (
              <input {...fieldProps} type="text" required value={studentPublicId} onChange={(e) => setStudentPublicId(e.target.value)} />
            )}
          </FormField>
          <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.createClassIdLabel")}>
            {(fieldProps) => <input {...fieldProps} type="text" value={classId} onChange={(e) => setClassId(e.target.value)} />}
          </FormField>
          <Button type="submit" disabled={creating || !csrfToken}>
            {creating ? t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.createSubmitting") : t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.createSubmit")}
          </Button>
        </form>
        {createError ? <StatusMessage kind="error">{createError}</StatusMessage> : null}
      </section>

      <section className="qc-card">
        <FormField label={t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.filterStatusLabel")}>
          {(fieldProps) => (
            <select
              {...fieldProps}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SupportStudentAssignmentStatus | "")}
            >
              <option value="">—</option>
              <option value="ACTIVE">{t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.statusActive")}</option>
              <option value="ENDED">{t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.statusEnded")}</option>
              <option value="REVOKED">{t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.statusRevoked")}</option>
            </select>
          )}
        </FormField>

        {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
        {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
        {actionError ? <StatusMessage kind="error">{actionError}</StatusMessage> : null}
        {result.status === "success" && result.data.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.empty")} />
        ) : null}
        {result.status === "success" && result.data.length > 0 ? (
          <Table
            columns={[
              { key: "membership", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.columnMembership"), render: (row) => row.staffTenantMembershipId },
              { key: "student", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.columnStudent"), render: (row) => row.studentProfileId },
              { key: "class", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.columnClass"), render: (row) => row.classId ?? "—" },
              {
                key: "status",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.columnStatus"),
                render: (row) => <StatusBadge tone={STATUS_TONE[row.status]}>{t(DASHBOARD_CATALOG_IT_IT, STATUS_LABEL_KEY[row.status])}</StatusBadge>,
              },
              { key: "startsAt", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.columnStartsAt"), render: (row) => new Date(row.startsAt).toLocaleDateString("it-IT") },
              {
                key: "actions",
                header: "",
                render: (row) =>
                  row.status === "ACTIVE" ? (
                    <>
                      <Button variant="secondary" disabled={actionBusyId === row.id || !csrfToken} onClick={() => void handleTransition(row.id, "ENDED")}>
                        {t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.endAction")}
                      </Button>
                      <Button variant="secondary" disabled={actionBusyId === row.id || !csrfToken} onClick={() => void handleTransition(row.id, "REVOKED")}>
                        {t(DASHBOARD_CATALOG_IT_IT, "app.supportAssignments.revokeAction")}
                      </Button>
                    </>
                  ) : null,
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
