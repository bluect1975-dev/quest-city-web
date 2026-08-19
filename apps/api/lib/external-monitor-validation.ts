import { PlatformAdminError } from "@quest-city-web/platform-admin";
import type { ExternalMonitorReportRequestBody, ExternalMonitorEvidence } from "@quest-city-web/operations";

const ENVIRONMENTS = new Set(["STAGING", "PRODUCTION"]);
const SERVICES = new Set(["HOST", "REVERSE_PROXY", "API", "DATABASE", "BACKUP", "TLS"]);
const CONDITION_TYPES = new Set([
  "VPS_UNREACHABLE",
  "REVERSE_PROXY_UNREACHABLE",
  "TLS_HANDSHAKE_FAILURE",
  "BACKUP_FAILED",
  "EXTERNAL_HTTP_DEGRADED",
  "BACKUP_STALE",
  "TLS_EXPIRY_WARNING",
]);
const STATES = new Set(["DETECTED", "RECOVERED"]);
const SUMMARY_CODES = new Set([
  "CONNECT_TIMEOUT",
  "CONNECT_REFUSED",
  "DNS_RESOLUTION_FAILED",
  "HTTP_STATUS_ERROR",
  "HTTP_LATENCY_EXCEEDED",
  "CERTIFICATE_EXPIRED_SOON",
  "TLS_HANDSHAKE_ERROR",
  "BACKUP_AGE_EXCEEDED",
  "BACKUP_JOB_FAILED",
  "THRESHOLD_RECOVERED",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new PlatformAdminError("EXTERNAL_MONITOR_PAYLOAD_INVALID", message);
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

function validateEvidence(value: unknown): ExternalMonitorEvidence {
  if (typeof value !== "object" || value === null) fail("evidence is required and must be an object.");
  const evidence = value as Record<string, unknown>;
  const allowedKeys = new Set(["httpStatus", "latencyMs", "tlsDaysRemaining", "backupAgeHours", "consecutiveFailures"]);
  for (const key of Object.keys(evidence)) {
    if (!allowedKeys.has(key)) fail(`evidence contains an unknown field: ${key}`);
  }
  function numberOrNull(key: string): number | null {
    const v = evidence[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v)) fail(`evidence.${key} must be a number or null.`);
    return v;
  }
  const consecutiveFailures = evidence.consecutiveFailures;
  if (typeof consecutiveFailures !== "number" || !Number.isInteger(consecutiveFailures) || consecutiveFailures < 0) {
    fail("evidence.consecutiveFailures is required and must be a non-negative integer.");
  }
  return {
    httpStatus: numberOrNull("httpStatus"),
    latencyMs: numberOrNull("latencyMs"),
    tlsDaysRemaining: numberOrNull("tlsDaysRemaining"),
    backupAgeHours: numberOrNull("backupAgeHours"),
    consecutiveFailures,
  };
}

/**
 * Validates a parsed JSON body against `ExternalMonitorReportRequest`
 * (OpenAPI v1.19, 02_42 v1.2 §56) -- `additionalProperties: false` in the
 * schema is enforced here as an explicit allow-list, same discipline as
 * `validateAlertConfigurationBody` (operations-validation.ts). Never
 * accepts a `severity` field even if present (02_42 §56, §72 principle
 * 4) -- silently ignored is wrong here (it would let a caller believe
 * the field has effect), so its presence is rejected outright.
 */
export function validateExternalMonitorReportBody(body: unknown): ExternalMonitorReportRequestBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    fail("Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  const allowedKeys = new Set([
    "monitorId",
    "observationId",
    "observedAt",
    "environment",
    "service",
    "conditionType",
    "state",
    "summaryCode",
    "evidence",
    "backfill",
    "detectedAt",
    "resolvedAt",
  ]);
  for (const key of Object.keys(b)) {
    if (!allowedKeys.has(key)) fail(`Unknown field: ${key}`);
  }
  if ("severity" in b) fail("severity is never accepted from the caller -- it is always server-derived.");

  if (typeof b.monitorId !== "string" || b.monitorId.length < 1 || b.monitorId.length > 128) {
    fail("monitorId is required, 1-128 characters.");
  }
  if (typeof b.observationId !== "string" || !UUID_PATTERN.test(b.observationId)) {
    fail("observationId is required and must be a UUID.");
  }
  if (!isIsoDateTime(b.observedAt)) fail("observedAt is required and must be an ISO 8601 date-time.");
  if (typeof b.environment !== "string" || !ENVIRONMENTS.has(b.environment)) fail("environment must be STAGING or PRODUCTION.");
  if (typeof b.service !== "string" || !SERVICES.has(b.service)) fail("service must be a valid ExternalMonitorService value.");
  if (typeof b.conditionType !== "string" || !CONDITION_TYPES.has(b.conditionType)) {
    fail("conditionType must be a valid ExternalMonitorConditionType value.");
  }
  if (typeof b.state !== "string" || !STATES.has(b.state)) fail("state must be DETECTED or RECOVERED.");
  if (typeof b.summaryCode !== "string" || !SUMMARY_CODES.has(b.summaryCode)) {
    fail("summaryCode must be a valid ExternalMonitorSummaryCode value.");
  }
  const evidence = validateEvidence(b.evidence);

  let backfill = false;
  if (b.backfill !== undefined) {
    if (typeof b.backfill !== "boolean") fail("backfill must be a boolean.");
    backfill = b.backfill;
  }

  let detectedAt: string | null = null;
  if (b.detectedAt !== undefined && b.detectedAt !== null) {
    if (!isIsoDateTime(b.detectedAt)) fail("detectedAt must be an ISO 8601 date-time.");
    detectedAt = b.detectedAt;
  }
  if (backfill && !detectedAt) fail("detectedAt is required when backfill = true.");

  let resolvedAt: string | null = null;
  if (b.resolvedAt !== undefined && b.resolvedAt !== null) {
    if (!isIsoDateTime(b.resolvedAt)) fail("resolvedAt must be an ISO 8601 date-time.");
    resolvedAt = b.resolvedAt;
  }
  if (backfill && b.state === "RECOVERED" && !resolvedAt) {
    fail("resolvedAt is required when backfill = true and state = RECOVERED.");
  }

  return {
    monitorId: b.monitorId,
    observationId: b.observationId,
    observedAt: b.observedAt,
    environment: b.environment as ExternalMonitorReportRequestBody["environment"],
    service: b.service as ExternalMonitorReportRequestBody["service"],
    conditionType: b.conditionType as ExternalMonitorReportRequestBody["conditionType"],
    state: b.state as ExternalMonitorReportRequestBody["state"],
    summaryCode: b.summaryCode as ExternalMonitorReportRequestBody["summaryCode"],
    evidence,
    backfill,
    detectedAt,
    resolvedAt,
  };
}
