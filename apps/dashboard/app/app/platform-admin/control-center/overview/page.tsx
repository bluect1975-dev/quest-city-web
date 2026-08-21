"use client";

import { EmptyState, StatsCard, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../../lib/RequirePlatformAuth";
import { ControlCenterSubNav } from "../../../../../lib/ControlCenterSubNav";
import { useAsyncPlatform } from "../../../../../lib/useAsyncPlatform";
import { getOperationsOverview } from "../../../../../lib/platform-api-client";
import { ROLE_LABEL_KEY } from "../../../../../lib/role-labels";
import type { OperationsOverview, ServiceHealthState } from "../../../../../lib/platform-api-types";
import type { PlatformContext } from "../../../../../lib/platform-api-types";
import type { StaffContext } from "../../../../../lib/staff-api-types";

const HEALTH_TONE: Record<ServiceHealthState, "success" | "warning" | "danger" | "neutral"> = {
  HEALTHY: "success",
  DEGRADED: "warning",
  CRITICAL: "danger",
  UNKNOWN: "neutral",
};

const HEALTH_LABEL_KEY: Record<ServiceHealthState, string> = {
  HEALTHY: "platformAdmin.controlCenter.overview.platformStatusHealthy",
  DEGRADED: "platformAdmin.controlCenter.overview.platformStatusDegraded",
  CRITICAL: "platformAdmin.controlCenter.overview.platformStatusCritical",
  UNKNOWN: "platformAdmin.controlCenter.overview.platformStatusUnknown",
};

/**
 * `staffByRole` aggregates across the whole platform as a plain `string`
 * (not the narrower `StaffContext["role"]` union `ROLE_LABEL_KEY` is keyed
 * by) -- falls back to the raw value for any role this platform-wide
 * aggregation could theoretically report that the staff-facing union
 * doesn't cover, rather than throwing or hiding the row (07_04 principle:
 * never silently drop real data).
 */
function staffRoleLabel(role: string): string {
  const labelKey = ROLE_LABEL_KEY[role as StaffContext["role"]];
  return labelKey ? t(DASHBOARD_CATALOG_IT_IT, labelKey) : role;
}

/** `/app/platform-admin/control-center/overview` (capability `operations.dashboard.view`, 02_42 v1.1 §39). */
export default function ControlCenterOverviewPage() {
  return <RequirePlatformAuth>{(context) => <OverviewView context={context} />}</RequirePlatformAuth>;
}

function OverviewView({ context }: { context: PlatformContext }) {
  const result = useAsyncPlatform<OperationsOverview>(() => getOperationsOverview(), []);

  return (
    <main>
      <ControlCenterSubNav capabilities={context.capabilities} />
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.title")}</h1>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <p>
            <span>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.platformStatus")}: </span>
            <StatusBadge tone={HEALTH_TONE[result.data.platformStatus]}>
              {t(DASHBOARD_CATALOG_IT_IT, HEALTH_LABEL_KEY[result.data.platformStatus])}
            </StatusBadge>
          </p>
          <div className="qc-stats-grid">
            <StatsCard
              label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.schoolsTotal")}
              value={result.data.kpi.schoolsTotal}
              action={`${result.data.kpi.schoolsActive} ${t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.active")}, ${result.data.kpi.schoolsSuspended} ${t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.suspended")}`}
            />
            <StatsCard
              label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.independentEducatorsTotal")}
              value={result.data.kpi.independentEducatorsTotal}
            />
            <StatsCard
              label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.classesTotal")}
              value={result.data.kpi.classesTotal}
            />
            <StatsCard
              label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.staffUniqueHumansTotal")}
              value={result.data.kpi.staffUniqueHumansTotal}
            />
            <StatsCard
              label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.studentsEnrolled")}
              value={result.data.kpi.studentsEnrolled}
            />
            <StatsCard
              label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.studentsOnlineNow")}
              value={result.data.kpi.studentsOnlineNow}
            />
            <StatsCard
              label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.staffOnlineNow")}
              value={result.data.kpi.staffOnlineNow}
            />
            <StatsCard
              label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.activeLearningAttempts")}
              value={result.data.kpi.activeLearningAttempts}
            />
            <StatsCard
              label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.openIncidents")}
              value={result.data.openIncidents}
            />
          </div>
          {result.data.kpi.staffByRole.length === 0 ? (
            <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.staffByRoleEmpty")} />
          ) : (
            <table className="qc-table">
              <caption>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.staffByRoleCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.role")}</th>
                  <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.activeMemberships")}</th>
                  <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.uniqueHumans")}</th>
                </tr>
              </thead>
              <tbody>
                {result.data.kpi.staffByRole.map((role) => (
                  <tr key={role.role}>
                    <td>{staffRoleLabel(role.role)}</td>
                    <td>{role.activeMemberships}</td>
                    <td>{role.uniqueHumans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </main>
  );
}
