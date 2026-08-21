"use client";

import Link from "next/link";
import { StatsCard, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../lib/RequireStaffAuth";
import { useAsync } from "../../lib/useAsync";
import { ROLE_LABEL_KEY } from "../../lib/role-labels";
import { listFacilitationProposalReviewQueue, listMyAssignedStudents } from "../../lib/staff-api-client";

/**
 * `/app` home (02_23 §7, 02_35 §3.2). Who is signed in and their scope,
 * plus role-aware summaries for SUPPORT_TEACHER/ASACOM (02_39 §21bis/§22:
 * "My Supported Students", pending proposal reviews, recent support
 * activity) -- never School Admin tenant-wide tools for either role
 * (§14-15 of the governing instruction). Navigation into the other areas
 * lives in the persistent `AppShell` (pre-staging UI/UX remediation §9),
 * not duplicated here.
 */
export default function StaffHomePage() {
  return (
    <RequireStaffAuth>
      {(context) => (
        <main>
          <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.home.title")}</h1>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.home.welcome")} {t(DASHBOARD_CATALOG_IT_IT, ROLE_LABEL_KEY[context.role])}
          </p>
          {context.role !== "ASACOM" ? (
            <p>
              {t(DASHBOARD_CATALOG_IT_IT, "app.home.classScopeLabel")}:{" "}
              {context.classScope ? context.classScope.length : t(DASHBOARD_CATALOG_IT_IT, "app.home.classScopeAll")}
            </p>
          ) : null}

          {context.role === "ASACOM" || context.role === "SUPPORT_TEACHER" || context.role === "TEACHER" ? (
            <div className="qc-stats-grid">
              {context.role === "ASACOM" || context.role === "SUPPORT_TEACHER" ? <AssignedStudentsSummary /> : null}
              {context.role === "TEACHER" || context.role === "SUPPORT_TEACHER" ? <PendingReviewSummary /> : null}
            </div>
          ) : null}
        </main>
      )}
    </RequireStaffAuth>
  );
}

function AssignedStudentsSummary() {
  const result = useAsync(() => listMyAssignedStudents(), []);
  if (result.status === "loading") return <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage>;
  if (result.status === "error") return <StatusMessage kind="error">{result.message}</StatusMessage>;
  return (
    <StatsCard
      label={t(DASHBOARD_CATALOG_IT_IT, "app.home.assignedStudentsTitle")}
      value={result.data.length}
      action={
        result.data.length > 0 ? (
          <Link href="/app/support/my-students">{t(DASHBOARD_CATALOG_IT_IT, "app.home.goToMyAssignedStudents")}</Link>
        ) : (
          t(DASHBOARD_CATALOG_IT_IT, "app.home.assignedStudentsEmpty")
        )
      }
    />
  );
}

function PendingReviewSummary() {
  const result = useAsync(() => listFacilitationProposalReviewQueue("SUBMITTED"), []);
  if (result.status === "loading") return <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage>;
  if (result.status === "error") return <StatusMessage kind="error">{result.message}</StatusMessage>;
  return (
    <StatsCard
      label={t(DASHBOARD_CATALOG_IT_IT, "app.home.pendingReviewTitle")}
      value={result.data.length}
      action={
        result.data.length > 0 ? (
          <Link href="/app/facilitation-review">{t(DASHBOARD_CATALOG_IT_IT, "app.home.goToFacilitationReview")}</Link>
        ) : (
          t(DASHBOARD_CATALOG_IT_IT, "app.home.pendingReviewEmpty")
        )
      }
    />
  );
}
