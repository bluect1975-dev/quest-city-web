"use client";

import Link from "next/link";
import { EmptyState, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../../lib/RequireStaffAuth";
import { useAsync } from "../../../lib/useAsync";
import { listClasses } from "../../../lib/staff-api-client";
import type { ClassSummary } from "../../../lib/staff-api-types";

/** `/app/classes` (02_35 §5, §3.2). TEACHER sees its explicit scope; SCHOOL_ADMIN sees the whole tenant. */
export default function StaffClassesPage() {
  return (
    <RequireStaffAuth>
      {() => <ClassesView />}
    </RequireStaffAuth>
  );
}

function ClassesView() {
  const result = useAsync<ClassSummary[]>(() => listClasses(), []);

  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.classes.title")}</h1>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "app.classes.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <Table
          columns={[
            { key: "name", header: t(DASHBOARD_CATALOG_IT_IT, "app.classes.columnName"), render: (row) => row.name },
            {
              key: "open",
              header: "",
              render: (row) => <Link href={`/app/classes/${encodeURIComponent(row.classId)}`}>{t(DASHBOARD_CATALOG_IT_IT, "app.classes.openClass")}</Link>,
            },
          ]}
          rows={result.data}
          rowKey={(row) => row.classId}
        />
      ) : null}
    </main>
  );
}
