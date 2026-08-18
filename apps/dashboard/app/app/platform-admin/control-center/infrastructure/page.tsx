"use client";

import { EmptyState, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../../lib/RequirePlatformAuth";
import { ControlCenterSubNav } from "../../../../../lib/ControlCenterSubNav";
import { useAsyncPlatform } from "../../../../../lib/useAsyncPlatform";
import { listOperationsServices } from "../../../../../lib/platform-api-client";
import type { OperationsServices, PlatformContext, ServiceHealthState } from "../../../../../lib/platform-api-types";

const HEALTH_TONE: Record<ServiceHealthState, "success" | "warning" | "danger" | "neutral"> = {
  HEALTHY: "success",
  DEGRADED: "warning",
  CRITICAL: "danger",
  UNKNOWN: "neutral",
};

/** `/app/platform-admin/control-center/infrastructure` (capability `operations.infrastructure.view`, 02_42 v1.1 §21-23,§40). */
export default function ControlCenterInfrastructurePage() {
  return <RequirePlatformAuth>{(context) => <InfrastructureView context={context} />}</RequirePlatformAuth>;
}

function InfrastructureView({ context }: { context: PlatformContext }) {
  const result = useAsyncPlatform<OperationsServices>(() => listOperationsServices(), []);

  return (
    <main>
      <ControlCenterSubNav capabilities={context.capabilities} />
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.infrastructure.title")}</h1>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" ? (
        <>
          <p>
            <span>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.overview.platformStatus")}: </span>
            <StatusBadge tone={HEALTH_TONE[result.data.platformStatus]}>{result.data.platformStatus}</StatusBadge>
          </p>
          {result.data.services.length === 0 ? (
            <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.infrastructure.empty")} />
          ) : (
            <table className="qc-table">
              <caption>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.infrastructure.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.infrastructure.service")}</th>
                  <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.infrastructure.state")}</th>
                  <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.infrastructure.latency")}</th>
                  <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.infrastructure.lastCheck")}</th>
                </tr>
              </thead>
              <tbody>
                {result.data.services.map((service) => (
                  <tr key={service.service}>
                    <td>{service.service}</td>
                    <td>
                      <StatusBadge tone={HEALTH_TONE[service.state]}>{service.state}</StatusBadge>
                    </td>
                    <td>{service.latencyMs === null ? "—" : `${Math.round(service.latencyMs)} ms`}</td>
                    <td>{new Date(service.checkedAt).toLocaleString()}</td>
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
