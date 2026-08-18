import { PlatformApiError } from "./platform-api-error";
import type {
  AlertConfiguration,
  AlertTestResult,
  AuditEventSummary,
  ConvergenceRequest,
  IndependentEducatorActivationResponse,
  IndependentEducatorStatusResponse,
  IndependentEducatorSummary,
  MetricSample,
  MetricSource,
  MigrationExecution,
  MigrationPlan,
  OperationalIncidentDetail,
  OperationalIncidentSeverity,
  OperationalIncidentStatus,
  OperationalIncidentSummary,
  OperationsOverview,
  OperationsPresence,
  OperationsServices,
  PlatformContext,
  RollbackReviewDecision,
  SchoolAdminActivationResponse,
  TenantSummary,
} from "./platform-api-types";

/**
 * Consumer for `contracts/quest-city-platform-openapi-v1_8.yaml`
 * (`packages/contracts/vendor`, 02_26 v1.10 §32). Same base-URL
 * convention as `staff-api-client.ts` — same-origin in
 * production/Docker-compose, overridable for local `next dev`.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL_DASHBOARD ?? "/api";

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT";
  body?: unknown;
  csrfToken?: string | null;
  idempotencyKey?: string;
}

interface Envelope<T> {
  data: T;
  meta: { request_id?: string; api_version: "v1" };
}

/** A fresh key per mutating call — never reused across distinct user actions (same convention as `staff-api-client.ts`). */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.csrfToken) {
    headers["X-CSRF-Token"] = options.csrfToken;
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const init: RequestInit = { method: options.method ?? "GET", credentials: "include", headers };
  if (body !== undefined) {
    init.body = body;
  }
  const response = await fetch(`${BASE_URL}${path}`, init);

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = json as { code?: string; message?: string } | null;
    throw new PlatformApiError(envelope?.code ?? "UNKNOWN_ERROR", envelope?.message ?? "Unexpected error", response.status);
  }
  return json as T;
}

export async function startPlatformSession(input: {
  email: string;
  password: string;
}): Promise<{ csrfToken: string; capabilities: PlatformContext["capabilities"] }> {
  const envelope = await request<Envelope<{ csrfToken: string; capabilities: PlatformContext["capabilities"] }>>(
    "/platform-auth/session/start",
    { method: "POST", body: input },
  );
  return envelope.data;
}

export async function platformLogout(csrfToken: string | null): Promise<void> {
  await request<Envelope<{ loggedOut: boolean }>>("/platform-auth/logout", { method: "POST", csrfToken });
}

export async function getPlatformContext(): Promise<PlatformContext> {
  const envelope = await request<Envelope<PlatformContext>>("/me/platform-context");
  return envelope.data;
}

export async function listTenants(): Promise<TenantSummary[]> {
  const envelope = await request<Envelope<TenantSummary[]>>("/platform/tenants");
  return envelope.data;
}

/** `Idempotency-Key` required (02_26 v1.10 §32.4) — pass a fresh `generateIdempotencyKey()` value per distinct user action; reusing it retries the same logical request. */
export async function createTenant(input: { name: string; csrfToken: string; idempotencyKey: string }): Promise<TenantSummary> {
  const envelope = await request<Envelope<TenantSummary>>("/platform/tenants", {
    method: "POST",
    body: { name: input.name },
    csrfToken: input.csrfToken,
    idempotencyKey: input.idempotencyKey,
  });
  return envelope.data;
}

export async function setTenantStatus(input: {
  tenantId: string;
  status: "ACTIVE" | "SUSPENDED";
  csrfToken: string;
}): Promise<TenantSummary> {
  const envelope = await request<Envelope<TenantSummary>>(`/platform/tenants/${encodeURIComponent(input.tenantId)}/status`, {
    method: "PATCH",
    body: { status: input.status },
    csrfToken: input.csrfToken,
  });
  return envelope.data;
}

export async function activateSchoolAdmin(input: {
  tenantId: string;
  email: string;
  csrfToken: string;
}): Promise<SchoolAdminActivationResponse> {
  const envelope = await request<Envelope<SchoolAdminActivationResponse>>(
    `/platform/tenants/${encodeURIComponent(input.tenantId)}/school-admins`,
    { method: "POST", body: { email: input.email }, csrfToken: input.csrfToken },
  );
  return envelope.data;
}

export async function listAuditEvents(): Promise<AuditEventSummary[]> {
  const envelope = await request<Envelope<AuditEventSummary[]>>("/platform/audit");
  return envelope.data;
}

export async function listIndependentEducators(): Promise<IndependentEducatorSummary[]> {
  const envelope = await request<Envelope<IndependentEducatorSummary[]>>("/platform/independent-educators");
  return envelope.data;
}

/** `Idempotency-Key` required (02_26 v1.13 §35.9) — pass a fresh `generateIdempotencyKey()` value per distinct user action. */
export async function activateIndependentEducator(input: {
  email: string;
  tenantName: string;
  csrfToken: string;
  idempotencyKey: string;
}): Promise<IndependentEducatorActivationResponse> {
  const envelope = await request<Envelope<IndependentEducatorActivationResponse>>("/platform/independent-educators", {
    method: "POST",
    body: { email: input.email, tenantName: input.tenantName },
    csrfToken: input.csrfToken,
    idempotencyKey: input.idempotencyKey,
  });
  return envelope.data;
}

export async function setIndependentEducatorStatus(input: {
  tenantId: string;
  status: "ACTIVE" | "SUSPENDED";
  csrfToken: string;
}): Promise<IndependentEducatorStatusResponse> {
  const envelope = await request<Envelope<IndependentEducatorStatusResponse>>(
    `/platform/independent-educators/${encodeURIComponent(input.tenantId)}/status`,
    { method: "PATCH", body: { status: input.status }, csrfToken: input.csrfToken },
  );
  return envelope.data;
}

/**
 * `GET /convergence-requests/{id}` (capability convergence.read). The
 * OpenAPI contract documents PLATFORM_ADMIN seeing every request,
 * unscoped, via this same read operation used by the staff-session surface
 * (`staff-api-client.ts`) -- kept here as its own duplicate rather than a
 * shared import, same domain-isolation discipline as the rest of this
 * file.
 */
export async function getConvergenceRequest(id: string): Promise<ConvergenceRequest> {
  const envelope = await request<Envelope<ConvergenceRequest>>(`/convergence-requests/${encodeURIComponent(id)}`);
  return envelope.data;
}

/**
 * `POST /convergence-requests/{id}/preview` (capability convergence.preview,
 * PLATFORM_ADMIN-only, 02_38 v1.4 §9). No request body, no Idempotency-Key.
 * IS the identity-verification step -- callable more than once, each call a
 * fresh, independently fingerprinted snapshot.
 */
export async function previewConvergenceRequest(input: { id: string; csrfToken: string }): Promise<MigrationPlan> {
  const envelope = await request<Envelope<MigrationPlan>>(`/convergence-requests/${encodeURIComponent(input.id)}/preview`, {
    method: "POST",
    csrfToken: input.csrfToken,
  });
  return envelope.data;
}

/**
 * `POST /convergence-requests/{id}/execute` (capability convergence.execute,
 * PLATFORM_ADMIN-only). Idempotency-Key required -- pass a fresh
 * `generateIdempotencyKey()` value per distinct execute attempt; a retry
 * with the same key resumes from the last checkpoint rather than
 * restarting (02_38 v1.4 §10.4).
 */
export async function executeConvergenceRequest(input: {
  id: string;
  csrfToken: string;
  idempotencyKey: string;
}): Promise<MigrationExecution> {
  const envelope = await request<Envelope<MigrationExecution>>(`/convergence-requests/${encodeURIComponent(input.id)}/execute`, {
    method: "POST",
    csrfToken: input.csrfToken,
    idempotencyKey: input.idempotencyKey,
  });
  return envelope.data;
}

/**
 * `POST /convergence-requests/{id}/rollback-review` (capability
 * convergence.rollback.review, PLATFORM_ADMIN-only). ACCEPT_PARTIAL is
 * terminal (COMPLETED, no unit already migrated is ever undone);
 * RETRY_REMAINING moves back to READY_TO_EXECUTE for a follow-up execute
 * call (02_38 v1.4 §10.5).
 */
export async function rollbackReviewConvergenceRequest(input: {
  id: string;
  decision: RollbackReviewDecision;
  csrfToken: string;
}): Promise<ConvergenceRequest> {
  const envelope = await request<Envelope<ConvergenceRequest>>(
    `/convergence-requests/${encodeURIComponent(input.id)}/rollback-review`,
    { method: "POST", body: { decision: input.decision }, csrfToken: input.csrfToken },
  );
  return envelope.data;
}

// -- Master Admin Operations Control Center (02_42 v1.1, contracts v1.17.0/v1.18.0) --

export async function getOperationsOverview(): Promise<OperationsOverview> {
  const envelope = await request<Envelope<OperationsOverview>>("/platform/operations/overview");
  return envelope.data;
}

export async function listOperationsServices(): Promise<OperationsServices> {
  const envelope = await request<Envelope<OperationsServices>>("/platform/operations/services");
  return envelope.data;
}

export async function listOperationsMetrics(input: {
  source: MetricSource;
  metricKey?: string;
  from: string;
  to: string;
}): Promise<MetricSample[]> {
  const params = new URLSearchParams({ source: input.source, from: input.from, to: input.to });
  if (input.metricKey) params.set("metricKey", input.metricKey);
  const envelope = await request<Envelope<MetricSample[]>>(`/platform/operations/metrics?${params.toString()}`);
  return envelope.data;
}

export async function getOperationsPresence(tenantId?: string): Promise<OperationsPresence> {
  const params = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const envelope = await request<Envelope<OperationsPresence>>(`/platform/operations/presence${params}`);
  return envelope.data;
}

export async function listOperationsIncidents(filter?: {
  status?: OperationalIncidentStatus;
  severity?: OperationalIncidentSeverity;
  service?: string;
}): Promise<OperationalIncidentSummary[]> {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  if (filter?.severity) params.set("severity", filter.severity);
  if (filter?.service) params.set("service", filter.service);
  const query = params.toString();
  const envelope = await request<Envelope<OperationalIncidentSummary[]>>(`/platform/operations/incidents${query ? `?${query}` : ""}`);
  return envelope.data;
}

export async function getOperationsIncident(incidentId: string): Promise<OperationalIncidentDetail> {
  const envelope = await request<Envelope<OperationalIncidentDetail>>(`/platform/operations/incidents/${encodeURIComponent(incidentId)}`);
  return envelope.data;
}

/** `Idempotency-Key` required — pass a fresh `generateIdempotencyKey()` value per distinct acknowledge click. */
export async function acknowledgeOperationsIncident(input: {
  incidentId: string;
  csrfToken: string;
  idempotencyKey: string;
}): Promise<OperationalIncidentSummary> {
  const envelope = await request<Envelope<OperationalIncidentSummary>>(
    `/platform/operations/incidents/${encodeURIComponent(input.incidentId)}/acknowledge`,
    { method: "POST", csrfToken: input.csrfToken, idempotencyKey: input.idempotencyKey },
  );
  return envelope.data;
}

export async function getAlertConfiguration(): Promise<AlertConfiguration> {
  const envelope = await request<Envelope<AlertConfiguration>>("/platform/operations/alert-configuration");
  return envelope.data;
}

/** `Idempotency-Key` required — pass a fresh `generateIdempotencyKey()` value per distinct save. */
export async function updateAlertConfiguration(input: {
  enabled: boolean;
  severityThreshold: OperationalIncidentSeverity;
  cooldownSeconds: number;
  csrfToken: string;
  idempotencyKey: string;
}): Promise<AlertConfiguration> {
  const envelope = await request<Envelope<AlertConfiguration>>("/platform/operations/alert-configuration", {
    method: "PUT",
    body: { enabled: input.enabled, severityThreshold: input.severityThreshold, cooldownSeconds: input.cooldownSeconds },
    csrfToken: input.csrfToken,
    idempotencyKey: input.idempotencyKey,
  });
  return envelope.data;
}

/** `Idempotency-Key` required — pass a fresh `generateIdempotencyKey()` value per distinct test send. */
export async function sendAlertTest(input: { csrfToken: string; idempotencyKey: string }): Promise<AlertTestResult> {
  const envelope = await request<Envelope<AlertTestResult>>("/platform/operations/alert-test", {
    method: "POST",
    csrfToken: input.csrfToken,
    idempotencyKey: input.idempotencyKey,
  });
  return envelope.data;
}
