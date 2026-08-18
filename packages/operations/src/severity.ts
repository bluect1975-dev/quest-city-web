import type { OperationalIncidentSeverity } from "./repository/operational-incident-repository";

/** Reused verbatim from 07_06 §19 -- ordered from most to least severe. */
export const SEVERITY_ORDER: readonly OperationalIncidentSeverity[] = ["SEV-1", "SEV-2", "SEV-3", "SEV-4"];

/** True if `severity` is at least as severe as `threshold` (lower index = more severe). */
export function meetsSeverityThreshold(
  severity: OperationalIncidentSeverity,
  threshold: OperationalIncidentSeverity,
): boolean {
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(threshold);
}

export type IncidentConditionType =
  | "API_DOWN"
  | "POSTGRES_DOWN"
  | "DATA_EXPOSURE"
  | "BACKUP_FAILED"
  | "SUSTAINED_HIGH_5XX"
  | "LOGIN_BLOCKED_WIDESPREAD"
  | "DISK_THRESHOLD"
  | "DEGRADED_WITH_WORKAROUND"
  | "TLS_EXPIRY_WARNING"
  | "MINOR_COSMETIC";

/** 02_42 §26 mapping table, reusing 07_06 §19's narrative SEV-1..SEV-4 definitions verbatim. */
const SEVERITY_BY_CONDITION: Record<IncidentConditionType, OperationalIncidentSeverity> = {
  API_DOWN: "SEV-1",
  POSTGRES_DOWN: "SEV-1",
  DATA_EXPOSURE: "SEV-1",
  BACKUP_FAILED: "SEV-2",
  SUSTAINED_HIGH_5XX: "SEV-2",
  LOGIN_BLOCKED_WIDESPREAD: "SEV-2",
  DISK_THRESHOLD: "SEV-3",
  DEGRADED_WITH_WORKAROUND: "SEV-3",
  TLS_EXPIRY_WARNING: "SEV-4",
  MINOR_COSMETIC: "SEV-4",
};

export function severityForCondition(condition: IncidentConditionType): OperationalIncidentSeverity {
  return SEVERITY_BY_CONDITION[condition];
}
