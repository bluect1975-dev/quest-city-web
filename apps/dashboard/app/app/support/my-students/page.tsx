"use client";

import Link from "next/link";
import { EmptyState, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../../lib/RequireStaffAuth";
import { useAsync } from "../../../../lib/useAsync";
import { listMyAssignedStudents } from "../../../../lib/staff-api-client";
import type { MyAssignedStudent } from "../../../../lib/staff-api-types";

/** `/app/support/my-students` (02_39 §21bis/§22) -- ASACOM/SUPPORT_TEACHER only, "My assigned students". */
export default function MyAssignedStudentsPage() {
  return (
    <RequireStaffAuth>
      {(context) => (context.role === "ASACOM" || context.role === "SUPPORT_TEACHER" ? <MyAssignedStudentsView /> : <NotAuthorized />)}
    </RequireStaffAuth>
  );
}

function NotAuthorized() {
  return <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>;
}

function MyAssignedStudentsView() {
  const result = useAsync<MyAssignedStudent[]>(() => listMyAssignedStudents(), []);

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.myAssignedStudents.title")}</h1>
      <section className="qc-card">
        {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
        {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
        {result.status === "success" && result.data.length === 0 ? (
          <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.myAssignedStudents.empty")} />
        ) : null}
        {result.status === "success" && result.data.length > 0 ? (
          <Table
            columns={[
              {
                key: "student",
                header: t(DASHBOARD_CATALOG_IT_IT, "app.myAssignedStudents.columnStudent"),
                render: (row) => row.studentPublicId ?? "—",
              },
              { key: "class", header: t(DASHBOARD_CATALOG_IT_IT, "app.myAssignedStudents.columnClass"), render: (row) => row.classId ?? "—" },
              { key: "startsAt", header: t(DASHBOARD_CATALOG_IT_IT, "app.myAssignedStudents.columnStartsAt"), render: (row) => new Date(row.startsAt).toLocaleDateString("it-IT") },
              {
                key: "open",
                header: "",
                render: (row) =>
                  row.studentPublicId ? (
                    <Link href={`/app/support/students/${encodeURIComponent(row.studentPublicId)}`}>
                      {t(DASHBOARD_CATALOG_IT_IT, "app.myAssignedStudents.openStudent")}
                    </Link>
                  ) : null,
              },
            ]}
            rows={result.data}
            rowKey={(row) => row.supportStudentAssignmentId}
          />
        ) : null}
      </section>
    </main>
  );
}
