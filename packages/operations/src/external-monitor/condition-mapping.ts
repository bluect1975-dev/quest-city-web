import type { OperationalIncidentSeverity } from "../repository/operational-incident-repository";
import type { MetricSource } from "../repository/operational-metric-sample-repository";

/**
 * Seven condition types the external monitor may report (02_42 v1.2
 * PARTE U §57, OpenAPI v1.19 `ExternalMonitorConditionType`) -- distinct
 * from `IncidentConditionType` (severity.ts, 02_42 §26): that type models
 * the generic internal condition->severity table any collector may use;
 * this one is the specific, closed, externally-facing vocabulary the
 * external monitor is bounded to, deliberately never merged into the
 * other union so the two enums can evolve independently (02_42 §57: "sette
 * valori nuovi, distinti da... già esistenti").
 */
export type ExternalMonitorConditionType =
  | "VPS_UNREACHABLE"
  | "REVERSE_PROXY_UNREACHABLE"
  | "TLS_HANDSHAKE_FAILURE"
  | "BACKUP_FAILED"
  | "EXTERNAL_HTTP_DEGRADED"
  | "BACKUP_STALE"
  | "TLS_EXPIRY_WARNING";

export type ExternalMonitorService = "HOST" | "REVERSE_PROXY" | "API" | "DATABASE" | "BACKUP" | "TLS";

export type ExternalMonitorState = "DETECTED" | "RECOVERED";

export type ExternalMonitorSummaryCode =
  | "CONNECT_TIMEOUT"
  | "CONNECT_REFUSED"
  | "DNS_RESOLUTION_FAILED"
  | "HTTP_STATUS_ERROR"
  | "HTTP_LATENCY_EXCEEDED"
  | "CERTIFICATE_EXPIRED_SOON"
  | "TLS_HANDSHAKE_ERROR"
  | "BACKUP_AGE_EXCEEDED"
  | "BACKUP_JOB_FAILED"
  | "THRESHOLD_RECOVERED";

/**
 * Fixed mapping table, 02_42 §57 -- default severity and service per
 * condition type, reusing the exact SEV-1..SEV-4 bands already defined by
 * 02_42 §26 (never a parallel taxonomy). `source` is always
 * `EXTERNAL_MONITOR` for every row created/updated through this endpoint
 * (02_42 §58) -- not part of this table since it never varies.
 *
 * Severity is NEVER accepted from the external caller (02_42 §56, §72
 * principle 4; AGENTS.md §4.31 rule 5) -- this table is the only place
 * severity is derived, always server-side.
 */
const CONDITION_TABLE: Record<
  ExternalMonitorConditionType,
  { service: ExternalMonitorService; severity: OperationalIncidentSeverity }
> = {
  VPS_UNREACHABLE: { service: "HOST", severity: "SEV-1" },
  REVERSE_PROXY_UNREACHABLE: { service: "REVERSE_PROXY", severity: "SEV-1" },
  TLS_HANDSHAKE_FAILURE: { service: "TLS", severity: "SEV-1" },
  BACKUP_FAILED: { service: "BACKUP", severity: "SEV-2" },
  EXTERNAL_HTTP_DEGRADED: { service: "API", severity: "SEV-3" },
  BACKUP_STALE: { service: "BACKUP", severity: "SEV-3" },
  TLS_EXPIRY_WARNING: { service: "TLS", severity: "SEV-4" },
};

export const EXTERNAL_MONITOR_SOURCE: MetricSource = "EXTERNAL_MONITOR";

export function severityForExternalMonitorCondition(conditionType: ExternalMonitorConditionType): OperationalIncidentSeverity {
  return CONDITION_TABLE[conditionType].severity;
}

/**
 * The contract-declared `service` on the request (OpenAPI v1.19
 * `ExternalMonitorService`, a bounded subset of the free-string
 * `operational_incident.service` field) is written through as-is -- this
 * function exists to validate consistency, not to override the caller's
 * declared service; a mismatch is a payload validation concern, not a
 * silent correction.
 */
export function defaultServiceForExternalMonitorCondition(conditionType: ExternalMonitorConditionType): ExternalMonitorService {
  return CONDITION_TABLE[conditionType].service;
}
