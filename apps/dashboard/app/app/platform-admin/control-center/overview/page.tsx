"use client";

import { EmptyState, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../../lib/RequirePlatformAuth";
import { ControlCenterSubNav } from "../../../../../lib/ControlCenterSubNav";
import { useAsyncPlatform } from "../../../../../lib/useAsyncPlatform";
import { getOperationsOverview } from "../../../../../lib/platform-api-client";
import type { OperationsOverview, ServiceHealthState } from "../../../../../lib/platform-api-types";
import type { PlatformContext } from "../../../../../lib/platform-api-types";

const HEALTH_TONE: Record<ServiceHealthState, "success" | "warning" | "danger" | "neutral"> = {
  HEALTHY: "success",
  DEGRADED: "warning",
  CRITICAL: "danger",
  UNKNOWN: "neutral",
};

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
            <StatusBadge tone={HEALTH_TONE[result.data.platformStatus]}>{result.data.platformStatus}</StatusBadge>
          </p>
          <dl className="qc-kpi-grid">
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.schoolsTotal")}</dt>
              <dd>
                {result.data.kpi.schoolsTotal} ({result.data.kpi.schoolsActive} {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.active")},{" "}
                {result.data.kpi.schoolsSuspended} {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.suspended")})
              </dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.independentEducatorsTotal")}</dt>
              <dd>{result.data.kpi.independentEducatorsTotal}</dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.classesTotal")}</dt>
              <dd>{result.data.kpi.classesTotal}</dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.staffUniqueHumansTotal")}</dt>
              <dd>{result.data.kpi.staffUniqueHumansTotal}</dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.studentsEnrolled")}</dt>
              <dd>{result.data.kpi.studentsEnrolled}</dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.studentsOnlineNow")}</dt>
              <dd>{result.data.kpi.studentsOnlineNow}</dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.staffOnlineNow")}</dt>
              <dd>{result.data.kpi.staffOnlineNow}</dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.activeLearningAttempts")}</dt>
              <dd>{result.data.kpi.activeLearningAttempts}</dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.openIncidents")}</dt>
              <dd>{result.data.openIncidents}</dd>
            </div>
          </dl>
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
                    <td>{role.role}</td>
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
