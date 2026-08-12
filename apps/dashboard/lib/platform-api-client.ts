import { PlatformApiError } from "./platform-api-error";
import type {
  AuditEventSummary,
  IndependentEducatorActivationResponse,
  IndependentEducatorStatusResponse,
  IndependentEducatorSummary,
  PlatformContext,
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
  method?: "GET" | "POST" | "PATCH";
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
