import { parseStudentApiErrorBody } from "./student-api-error";

/**
 * Base URL for `apps/api` — the same env var `apps/student-web/lib/
 * sequence-runtime-state-client.ts` already reads (`docker-compose.yml`
 * sets `NEXT_PUBLIC_API_BASE_URL=http://localhost/api` for this app),
 * routed through Nginx's `location /api/` (`infrastructure/reverse-proxy/
 * nginx.conf`). Falls back to `/api` for local `next dev` against a
 * directly-running API instance.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  csrfToken?: string | null;
  idempotencyKey?: string;
}

interface Envelope<T> {
  data: T;
  meta: { request_id?: string; api_version: "v1" };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.csrfToken) {
    headers["x-csrf-token"] = options.csrfToken;
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
    throw parseStudentApiErrorBody(json, response.status);
  }
  return json as T;
}

/** A fresh key per attempt-lifecycle mutation — never reused across distinct creation/completion calls. */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

export interface ClassCodeResolveResult {
  tenantDisplayName: string;
  classDisplayName: string;
}

export async function resolveClassCode(classCode: string): Promise<ClassCodeResolveResult> {
  const envelope = await request<Envelope<ClassCodeResolveResult>>("/web-auth/class-code/resolve", {
    method: "POST",
    body: { classCode },
  });
  return envelope.data;
}

export interface StudentSessionStartResult {
  studentPublicId: string;
  tenantPublicId: string;
  classPublicId: string;
  sessionExpiresAt: string;
  csrfToken: string;
}

export async function startStudentSession(input: {
  classCode: string;
  accessAlias: string;
  pin: string;
}): Promise<StudentSessionStartResult> {
  const envelope = await request<Envelope<StudentSessionStartResult>>("/web-auth/session/start", {
    method: "POST",
    body: input,
  });
  return envelope.data;
}

export async function studentLogout(csrfToken: string | null): Promise<void> {
  await request<Envelope<{ loggedOut: boolean }>>("/web-auth/logout", { method: "POST", csrfToken });
}

export interface StudentContext {
  studentPublicId: string;
  tenantPublicId: string;
  classPublicId: string;
  enrollmentStatus: "ACTIVE" | "SUSPENDED";
  displayAlias: string;
}

export async function getStudentContext(): Promise<StudentContext> {
  const envelope = await request<Envelope<StudentContext>>("/me/student-context");
  return envelope.data;
}

export interface WebM4Activity {
  assignmentId: string;
  activityId: string;
  title: string;
}

export async function getWebM4Activity(): Promise<WebM4Activity> {
  const envelope = await request<Envelope<WebM4Activity>>("/me/web-m4-activity");
  return envelope.data;
}

export interface LaunchContextResult {
  attempt: {
    attemptId: string;
    assignmentId: string;
    attemptState: string;
    completionStatus: string | null;
    runtimeChannel: string;
    startedAt: string;
    completedAt: string | null;
  };
  bundle: { contentBundleId: string; bundleVersion: string };
  adapter: { adapterId: string; adapterVersion: string };
  completionPolicy: string;
  presentationLocale: string;
}

/**
 * `idempotencyKey` must be STABLE per (student, assignment) — passed by
 * the caller, not generated here, so that reloading the activity page
 * resumes the same attempt (a replayed creation key) rather than creating
 * a new one every mount.
 */
export async function launchActivity(assignmentId: string, csrfToken: string, idempotencyKey: string): Promise<LaunchContextResult> {
  const envelope = await request<Envelope<LaunchContextResult>>(
    `/assignments/${encodeURIComponent(assignmentId)}/launch-context`,
    {
      method: "POST",
      body: { runtimeChannel: "WEB" },
      csrfToken,
      idempotencyKey,
    },
  );
  return envelope.data;
}

export interface SemanticActionInput {
  actionId: string;
  attemptId: string;
  activityId: string;
  actionType: string;
  targetRole?: string;
  payload: Record<string, unknown>;
  clientSequence: number;
  runtimeChannel: "WEB";
  occurredAt: string;
}

export async function submitAction(action: SemanticActionInput, csrfToken: string): Promise<void> {
  await request<Envelope<{ actionId: string; accepted: boolean }>>(`/attempts/${encodeURIComponent(action.attemptId)}/actions`, {
    method: "POST",
    body: action,
    csrfToken,
  });
}

export interface CompleteAttemptResult {
  attemptId: string;
  completionStatus: string;
  outcome?: Record<string, unknown>;
}

export async function completeAttempt(
  attemptId: string,
  finalClientSequence: number,
  csrfToken: string,
): Promise<CompleteAttemptResult> {
  const envelope = await request<Envelope<CompleteAttemptResult>>(`/attempts/${encodeURIComponent(attemptId)}/complete`, {
    method: "POST",
    body: { finalClientSequence },
    csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

export interface AttemptDetail {
  attemptId: string;
  assignmentId: string;
  activityId: string;
  attemptState: string;
  completionStatus: string | null;
  startedAt: string;
  completedAt: string | null;
  outcome: Record<string, unknown> | null;
}

export async function getAttempt(attemptId: string): Promise<AttemptDetail> {
  const envelope = await request<Envelope<AttemptDetail>>(`/attempts/${encodeURIComponent(attemptId)}`);
  return envelope.data;
}
