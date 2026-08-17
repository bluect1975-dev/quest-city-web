"use client";

import Link from "next/link";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
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

          {context.role === "ASACOM" || context.role === "SUPPORT_TEACHER" ? <AssignedStudentsSummary /> : null}
          {context.role === "TEACHER" || context.role === "SUPPORT_TEACHER" ? <PendingReviewSummary /> : null}
        </main>
      )}
    </RequireStaffAuth>
  );
}

function AssignedStudentsSummary() {
  const result = useAsync(() => listMyAssignedStudents(), []);
  return (
    <section className="qc-card">
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.home.assignedStudentsTitle")}</h2>
      {result.status === "success" ? (
        <p>
          {t(DASHBOARD_CATALOG_IT_IT, "app.home.assignedStudentsCount", { params: { count: result.data.length } })}{" "}
          <Link href="/app/support/my-students">{t(DASHBOARD_CATALOG_IT_IT, "app.home.goToMyAssignedStudents")}</Link>
        </p>
      ) : null}
    </section>
  );
}

function PendingReviewSummary() {
  const result = useAsync(() => listFacilitationProposalReviewQueue("SUBMITTED"), []);
  return (
    <section className="qc-card">
      <h2>{t(DASHBOARD_CATALOG_IT_IT, "app.home.pendingReviewTitle")}</h2>
      {result.status === "success" ? (
        <p>
          {t(DASHBOARD_CATALOG_IT_IT, "app.home.pendingReviewCount", { params: { count: result.data.length } })}{" "}
          <Link href="/app/facilitation-review">{t(DASHBOARD_CATALOG_IT_IT, "app.home.goToFacilitationReview")}</Link>
        </p>
      ) : null}
    </section>
  );
}
