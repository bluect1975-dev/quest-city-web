"use client";

import { EmptyState, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../../lib/RequirePlatformAuth";
import { ControlCenterSubNav } from "../../../../../lib/ControlCenterSubNav";
import { useAsyncPlatform } from "../../../../../lib/useAsyncPlatform";
import { listOperationsMetrics } from "../../../../../lib/platform-api-client";
import type { MetricSample, PlatformContext } from "../../../../../lib/platform-api-types";

const STATUS_TONE: Record<MetricSample["status"], "success" | "warning" | "danger" | "neutral"> = {
  OK: "success",
  WARNING: "warning",
  CRITICAL: "danger",
  UNKNOWN: "neutral",
};

/**
 * `/app/platform-admin/control-center/errors` (capability
 * `operations.errors.view`, 02_42 v1.1 §24). Aggregated error/event
 * metrics only -- no stack traces, no raw request bodies.
 */
export default function ControlCenterErrorsPage() {
  return <RequirePlatformAuth>{(context) => <ErrorsView context={context} />}</RequirePlatformAuth>;
}

function ErrorsView({ context }: { context: PlatformContext }) {
  const result = useAsyncPlatform<MetricSample[]>(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    return listOperationsMetrics({ source: "APPLICATION", from: from.toISOString(), to: to.toISOString() });
  }, []);

  return (
    <main>
      <ControlCenterSubNav capabilities={context.capabilities} />
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.errors.title")}</h1>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.errors.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <table className="qc-table">
          <caption>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.errors.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.errors.metricKey")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.errors.value")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.errors.status")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.errors.sampledAt")}</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((sample, index) => (
              <tr key={`${sample.metricKey}-${sample.sampledAt}-${index}`}>
                <td>{sample.metricKey}</td>
                <td>
                  {sample.value} {sample.unit}
                </td>
                <td>
                  <StatusBadge tone={STATUS_TONE[sample.status]}>{sample.status}</StatusBadge>
                </td>
                <td>{new Date(sample.sampledAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
