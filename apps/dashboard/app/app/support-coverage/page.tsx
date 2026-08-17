"use client";

import { useMemo } from "react";
import { EmptyState, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useAsync } from "../../../lib/useAsync";
import { listSupportStudentAssignments } from "../../../lib/staff-api-client";
import type { SupportStudentAssignment } from "../../../lib/staff-api-types";

/**
 * `/app/support-coverage` (02_39 §23) -- SCHOOL_ADMIN-only. Derived
 * entirely from the ACTIVE `support_student_assignment` list already
 * exposed by `GET /platform/support-assignments` -- no separate
 * aggregation endpoint, grouped client-side by student and by
 * professional (membership).
 */
export default function SupportCoveragePage() {
  return <RequireStaffAuth>{(context) => (context.role === "SCHOOL_ADMIN" ? <SupportCoverageView /> : <NotAuthorized />)}</RequireStaffAuth>;
}

function NotAuthorized() {
  return <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>;
}

function SupportCoverageView() {
  const result = useAsync<SupportStudentAssignment[]>(() => listSupportStudentAssignments({ status: "ACTIVE" }), []);

  const byStudent = useMemo(() => {
    if (result.status !== "success") return [];
    const map = new Map<string, SupportStudentAssignment[]>();
    for (const row of result.data) {
      const list = map.get(row.studentProfileId) ?? [];
      list.push(row);
      map.set(row.studentProfileId, list);
    }
    return Array.from(map.entries()).map(([studentProfileId, assignments]) => ({ studentProfileId, assignments }));
  }, [result]);

  const byProfessional = useMemo(() => {
    if (result.status !== "success") return [];
    const map = new Map<string, SupportStudentAssignment[]>();
    for (const row of result.data) {
      const list = map.get(row.staffTenantMembershipId) ?? [];
      list.push(row);
      map.set(row.staffTenantMembershipId, list);
    }
    return Array.from(map.entries()).map(([staffTenantMembershipId, assignments]) => ({ staffTenantMembershipId, assignments }));
  }, [result]);

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.supportCoverage.title")}</h1>

      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportCoverage.byStudentTitle")}</h2>
        {result.status === "success" && byStudent.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.supportCoverage.empty")} />
        ) : null}
        {result.status === "success" && byStudent.length > 0 ? (
          <Table
            columns={[
              { key: "student", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportCoverage.columnStudent"), render: (row) => row.studentProfileId },
              {
                key: "professionals",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.supportCoverage.columnProfessional"),
                render: (row) => row.assignments.map((a) => a.staffTenantMembershipId).join(", "),
              },
            ]}
            rows={byStudent}
            rowKey={(row) => row.studentProfileId}
          />
        ) : null}
      </section>

      <section className="qc-card">
        <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.supportCoverage.byProfessionalTitle")}</h2>
        {result.status === "success" && byProfessional.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.supportCoverage.empty")} />
        ) : null}
        {result.status === "success" && byProfessional.length > 0 ? (
          <Table
            columns={[
              { key: "professional", header: t(DASHBOARD_CATALOG_IT_IT, "app.supportCoverage.columnProfessional"), render: (row) => row.staffTenantMembershipId },
              {
                key: "students",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.supportCoverage.columnStudent"),
                render: (row) => row.assignments.map((a) => a.studentProfileId).join(", "),
              },
            ]}
            rows={byProfessional}
            rowKey={(row) => row.staffTenantMembershipId}
          />
        ) : null}
      </section>
    </main>
  );
}
