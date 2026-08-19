"use client";

import { useState } from "react";
import { Button, EmptyState, StatusBadge, StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequirePlatformAuth } from "../../../../../lib/RequirePlatformAuth";
import { ControlCenterSubNav } from "../../../../../lib/ControlCenterSubNav";
import { usePlatformAuth } from "../../../../../lib/platform-auth-context";
import { useAsyncPlatform } from "../../../../../lib/useAsyncPlatform";
import { acknowledgeOperationsIncident, generateIdempotencyKey, listOperationsIncidents } from "../../../../../lib/platform-api-client";
import type { OperationalIncidentSeverity, OperationalIncidentStatus, OperationalIncidentSummary, PlatformContext } from "../../../../../lib/platform-api-types";

const SEVERITY_TONE: Record<OperationalIncidentSeverity, "danger" | "warning" | "neutral"> = {
  "SEV-1": "danger",
  "SEV-2": "danger",
  "SEV-3": "warning",
  "SEV-4": "neutral",
};

const STATUS_TONE: Record<OperationalIncidentStatus, "danger" | "warning" | "success" | "neutral"> = {
  OPEN: "danger",
  ACKNOWLEDGED: "warning",
  RESOLVED: "success",
  SUPPRESSED: "neutral",
};

/**
 * `/app/platform-admin/control-center/incidents` (capability
 * `operations.incidents.view`, manage for acknowledge, 02_42 v1.1 §25-27,
 * §53).
 */
export default function ControlCenterIncidentsPage() {
  return <RequirePlatformAuth>{(context) => <IncidentsView context={context} />}</RequirePlatformAuth>;
}

function IncidentsView({ context }: { context: PlatformContext }) {
  const { csrfToken } = usePlatformAuth();
  const [statusFilter, setStatusFilter] = useState<OperationalIncidentStatus | "">("");
  const result = useAsyncPlatform<OperationalIncidentSummary[]>(
    () => listOperationsIncidents(statusFilter ? { status: statusFilter } : undefined),
    [statusFilter],
  );
  const canManage = context.capabilities.includes("operations.incidents.manage");
  const [acking, setAcking] = useState<string | null>(null);

  async function handleAcknowledge(incidentId: string) {
    if (!csrfToken) return;
    setAcking(incidentId);
    try {
      await acknowledgeOperationsIncident({ incidentId, csrfToken, idempotencyKey: generateIdempotencyKey() });
      result.reload();
    } finally {
      setAcking(null);
    }
  }

  return (
    <main>
      <ControlCenterSubNav capabilities={context.capabilities} />
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.title")}</h1>
      <label>
        {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.filterStatus")}
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as OperationalIncidentStatus | "")}>
          <option value="">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.filterAll")}</option>
          <option value="OPEN">OPEN</option>
          <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="SUPPRESSED">SUPPRESSED</option>
        </select>
      </label>
      {result.status === "loading" ? <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage> : null}
      {result.status === "error" ? <StatusMessage kind="error">{result.message}</StatusMessage> : null}
      {result.status === "success" && result.data.length === 0 ? (
        <EmptyState title={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.empty")} />
      ) : null}
      {result.status === "success" && result.data.length > 0 ? (
        <table className="qc-table">
          <caption>{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.severity")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.service")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.source")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.summary")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.status")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.occurrences")}</th>
              <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.lastSeen")}</th>
              {canManage ? <th scope="col">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.actions")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {result.data.map((incident) => (
              <tr key={incident.id}>
                <td>
                  <StatusBadge tone={SEVERITY_TONE[incident.severity]}>{incident.severity}</StatusBadge>
                </td>
                <td>{incident.service}</td>
                <td>
                  {incident.source}
                  {incident.backfilled ? (
                    <span title={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.backfilledHint")}>
                      <StatusBadge tone="neutral">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.backfilled")}</StatusBadge>
                    </span>
                  ) : null}
                </td>
                <td>{incident.summary}</td>
                <td>
                  <StatusBadge tone={STATUS_TONE[incident.status]}>{incident.status}</StatusBadge>
                </td>
                <td>{incident.occurrenceCount}</td>
                <td>{new Date(incident.lastSeenAt).toLocaleString()}</td>
                {canManage ? (
                  <td>
                    {incident.status === "OPEN" ? (
                      <Button
                        variant="secondary"
                        disabled={acking === incident.id}
                        onClick={() => void handleAcknowledge(incident.id)}
                      >
                        {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.incidents.acknowledge")}
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
