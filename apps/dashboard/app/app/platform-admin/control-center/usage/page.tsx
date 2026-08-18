"use client";

import { StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../../lib/RequirePlatformAuth";
import { ControlCenterSubNav } from "../../../../../lib/ControlCenterSubNav";
import { useAsyncPlatform } from "../../../../../lib/useAsyncPlatform";
import { getOperationsOverview } from "../../../../../lib/platform-api-client";
import type { OperationsOverview, PlatformContext } from "../../../../../lib/platform-api-types";

/** `/app/platform-admin/control-center/usage` (capability `operations.usage.view`, 02_42 v1.1 §10-13,§17-18). */
export default function ControlCenterUsagePage() {
  return <RequirePlatformAuth>{(context) => <UsageView context={context} />}</RequirePlatformAuth>;
}

function UsageView({ context }: { context: PlatformContext }) {
  const result = useAsyncPlatform<OperationsOverview>(() => getOperationsOverview(), []);

  return (
    <main>
      <ControlCenterSubNav capabilities={context.capabilities} />
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.usage.title")}</h1>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <table className="qc-table">
          <caption>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.usage.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.usage.metric")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.usage.value")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.schoolsTotal")}</td>
              <td>{result.data.kpi.schoolsTotal}</td>
            </tr>
            <tr>
              <td>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.independentEducatorsTotal")}</td>
              <td>{result.data.kpi.independentEducatorsTotal}</td>
            </tr>
            <tr>
              <td>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.classesTotal")}</td>
              <td>{result.data.kpi.classesTotal}</td>
            </tr>
            <tr>
              <td>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.staffUniqueHumansTotal")}</td>
              <td>{result.data.kpi.staffUniqueHumansTotal}</td>
            </tr>
            <tr>
              <td>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.studentsEnrolled")}</td>
              <td>{result.data.kpi.studentsEnrolled}</td>
            </tr>
            <tr>
              <td>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.activeLearningAttempts")}</td>
              <td>{result.data.kpi.activeLearningAttempts}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
