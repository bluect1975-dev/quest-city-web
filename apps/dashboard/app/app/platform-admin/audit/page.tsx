"use client";

import Link from "next/link";
import { EmptyState, StatusMessage, Table } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../lib/RequirePlatformAuth";
import { useAsyncPlatform } from "../../../../lib/useAsyncPlatform";
import { listAuditEvents } from "../../../../lib/platform-api-client";
import type { AuditEventSummary } from "../../../../lib/platform-api-types";

/** `/app/platform-admin/audit` (capability `audit.read.global`). Read-only, no didactic data -- audit rows for this domain never carry student content. */
export default function PlatformAdminAuditPage() {
  return <RequirePlatformAuth>{() => <PlatformAdminAuditView />}</RequirePlatformAuth>;
}

function PlatformAdminAuditView() {
  const result = useAsyncPlatform<AuditEventSummary[]>(() => listAuditEvents(), []);

  return (
    <main>
      <nav>
        <Link href="/app/platform-admin">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.nav.tenants")}</Link>
      </nav>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.audit.title")}</h1>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.audit.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <Table
          columns={[
            {
              key: "createdAt",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.audit.columnTimestamp"),
              render: (row) => new Date(row.createdAt).toLocaleString(),
            },
            {
              key: "actorType",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.audit.columnActorType"),
              render: (row) => row.actorType,
            },
            { key: "action", header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.audit.columnAction"), render: (row) => row.action },
            {
              key: "targetType",
              header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.audit.columnTargetType"),
              render: (row) => row.targetType ?? "",
            },
            { key: "result", header: t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.audit.columnResult"), render: (row) => row.result },
          ]}
          rows={result.data}
          rowKey={(row) => row.id}
        />
      ) : null}
    </main>
  );
}
