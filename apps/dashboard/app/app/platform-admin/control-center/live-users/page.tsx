"use client";

import { StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../../lib/RequirePlatformAuth";
import { ControlCenterSubNav } from "../../../../../lib/ControlCenterSubNav";
import { useAsyncPlatform } from "../../../../../lib/useAsyncPlatform";
import { getOperationsPresence } from "../../../../../lib/platform-api-client";
import type { OperationsPresence, PlatformContext } from "../../../../../lib/platform-api-types";

/**
 * `/app/platform-admin/control-center/live-users` (capability
 * `operations.presence.view`, 02_42 v1.1 §41). Aggregate counts only --
 * never a named-student list.
 */
export default function ControlCenterLiveUsersPage() {
  return <RequirePlatformAuth>{(context) => <LiveUsersView context={context} />}</RequirePlatformAuth>;
}

function LiveUsersView({ context }: { context: PlatformContext }) {
  const result = useAsyncPlatform<OperationsPresence>(() => getOperationsPresence(), []);

  return (
    <main>
      <ControlCenterSubNav capabilities={context.capabilities} />
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.title")}</h1>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <dl className="qc-kpi-grid">
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.studentsOnline")}</dt>
              <dd>{result.data.concurrentStudents}</dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.staffOnline")}</dt>
              <dd>{result.data.concurrentStaff}</dd>
            </div>
            <div>
              <dt>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.totalOnline")}</dt>
              <dd>{result.data.concurrentTotal}</dd>
            </div>
          </dl>
          <table className="qc-table">
            <caption>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.peakCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.window")}</th>
                <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.peakStudents")}</th>
                <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.peakStaff")}</th>
                <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.peakTotal")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.today")}</td>
                <td>{result.data.peak.peakStudentsToday ?? "—"}</td>
                <td>{result.data.peak.peakStaffToday ?? "—"}</td>
                <td>{result.data.peak.peakTotalToday ?? "—"}</td>
              </tr>
              <tr>
                <td>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.sevenDays")}</td>
                <td>{result.data.peak.peakStudents7d ?? "—"}</td>
                <td>{result.data.peak.peakStaff7d ?? "—"}</td>
                <td>{result.data.peak.peakTotal7d ?? "—"}</td>
              </tr>
              <tr>
                <td>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.liveUsers.thirtyDays")}</td>
                <td>{result.data.peak.peakStudents30d ?? "—"}</td>
                <td>{result.data.peak.peakStaff30d ?? "—"}</td>
                <td>{result.data.peak.peakTotal30d ?? "—"}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  );
}
