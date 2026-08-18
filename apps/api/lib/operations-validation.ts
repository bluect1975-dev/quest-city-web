import { PlatformAdminError } from "@quest-city-web/platform-admin";
import type { MetricSource, OperationalIncidentSeverity, OperationalIncidentStatus } from "@quest-city-web/operations";

const METRIC_SOURCES = new Set<string>(["APPLICATION", "DATABASE", "HOST", "CONTAINER", "REVERSE_PROXY", "BACKUP", "TLS", "EXTERNAL_MONITOR"]);
const SEVERITIES = new Set<string>(["SEV-1", "SEV-2", "SEV-3", "SEV-4"]);
const STATUSES = new Set<string>(["OPEN", "ACKNOWLEDGED", "RESOLVED", "SUPPRESSED"]);

export function validateMetricSource(value: string | null): MetricSource {
  if (!value || !METRIC_SOURCES.has(value)) {
    throw new PlatformAdminError("VALIDATION_ERROR", "source is required and must be a valid MetricSource value");
  }
  return value as MetricSource;
}

export function validateDateRangeQuery(url: URL): { from: Date; to: Date } {
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  if (!fromRaw || !toRaw) {
    throw new PlatformAdminError("VALIDATION_ERROR", "from and to query parameters are required (ISO 8601 date-time)");
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new PlatformAdminError("VALIDATION_ERROR", "from and to must be valid ISO 8601 date-times");
  }
  if (to.getTime() < from.getTime()) {
    throw new PlatformAdminError("VALIDATION_ERROR", "to must not precede from");
  }
  const MAX_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > MAX_LOOKBACK_MS) {
    throw new PlatformAdminError("VALIDATION_ERROR", "requested window exceeds the maximum lookback (90 days)");
  }
  return { from, to };
}

export function validateOptionalSeverity(value: string | null): OperationalIncidentSeverity | undefined {
  if (value === null) return undefined;
  if (!SEVERITIES.has(value)) throw new PlatformAdminError("VALIDATION_ERROR", "severity must be one of SEV-1..SEV-4");
  return value as OperationalIncidentSeverity;
}

export function validateOptionalStatus(value: string | null): OperationalIncidentStatus | undefined {
  if (value === null) return undefined;
  if (!STATUSES.has(value)) throw new PlatformAdminError("VALIDATION_ERROR", "status must be one of OPEN, ACKNOWLEDGED, RESOLVED, SUPPRESSED");
  return value as OperationalIncidentStatus;
}

export function validateAlertConfigurationBody(body: Record<string, unknown>): {
  enabled: boolean;
  severityThreshold: OperationalIncidentSeverity;
  cooldownSeconds: number;
} {
  if (typeof body.enabled !== "boolean") {
    throw new PlatformAdminError("ALERT_CONFIGURATION_INVALID", "enabled must be a boolean");
  }
  if (typeof body.severityThreshold !== "string" || !SEVERITIES.has(body.severityThreshold)) {
    throw new PlatformAdminError("ALERT_CONFIGURATION_INVALID", "severityThreshold must be one of SEV-1..SEV-4");
  }
  if (typeof body.cooldownSeconds !== "number" || !Number.isInteger(body.cooldownSeconds) || body.cooldownSeconds < 60) {
    throw new PlatformAdminError("ALERT_CONFIGURATION_INVALID", "cooldownSeconds must be an integer >= 60");
  }
  return {
    enabled: body.enabled,
    severityThreshold: body.severityThreshold as OperationalIncidentSeverity,
    cooldownSeconds: body.cooldownSeconds,
  };
}
