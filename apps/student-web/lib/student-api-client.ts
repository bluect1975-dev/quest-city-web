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

/** `GET /me/class` (Pilot Product Experience Remediation G2, `teachers[]` added Tranche H1) — backs the "La mia classe" and "Profilo" surfaces. */
export interface MyClass {
  classPublicId: string;
  className: string;
  schoolName: string;
  enrollmentStatus: "ACTIVE" | "SUSPENDED";
  /** Real assigned teachers. `displayName` is `null` for a teacher who has never set one (never email/UUID) — the UI renders the documented fallback label. */
  teachers: Array<{ displayName: string | null }>;
}

export async function getMyClass(): Promise<MyClass> {
  const envelope = await request<Envelope<MyClass>>("/me/class");
  return envelope.data;
}

/** `GET /progress/summary` (02_26 v1.6 §18.4) — backs the "Progressi" surface. Aggregate-only: per-attempt state/completion counts, no per-unit score (the repository does not track one, see mission Feature Inventory row "Progressi studente"). */
export interface ProgressSummary {
  studentPublicId: string;
  aggregate: {
    totalAttempts: number;
    byAttemptState: Record<string, number>;
    byCompletionStatus: Record<string, number>;
  };
}

export async function getProgressSummary(): Promise<ProgressSummary> {
  const envelope = await request<Envelope<ProgressSummary>>("/progress/summary");
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

/**
 * `GET /me/assignments` (`listMyAssignments`, OpenAPI v1.10 — 02_26 v1.12
 * §34.5). Dynamic `STAFF_GENERAL` assignment discovery for `/w/home` —
 * distinct from the per-tranche hardcoded `WebM4Activity`-shaped reads
 * above, which remain for regression/dev and are not replaced here.
 */
export interface MyAssignment {
  assignmentId: string;
  contentBundleId: string;
  title: string;
  completionStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  latestAttemptId: string | null;
  dueAt: string | null;
}

export async function getMyAssignments(): Promise<MyAssignment[]> {
  const envelope = await request<Envelope<MyAssignment[]>>("/me/assignments");
  return envelope.data;
}

/**
 * `GET /me/path` (Pilot Product Experience Residual Closure, Tranche H3)
 * — "Il mio percorso", closes `NEW-GAP-STUDENT-PATH-VIEW-01`. Unlike
 * `MyAssignment` above, `pathState` is a real server-side GLPC resolution
 * (`resolveEffectiveForLaunchAttempt`), not just an attempt-completion
 * label — `LOCKED` reflects an actual GLPC policy, never fabricated.
 */
export interface MyPathItem {
  assignmentId: string;
  contentBundleId: string | null;
  title: string;
  subjectId: string | null;
  pathState: "COMPLETED" | "LOCKED" | "CURRENT" | "AVAILABLE";
  dueAt: string | null;
}

export interface MyPath {
  items: MyPathItem[];
  progress: { completedCount: number; totalCount: number };
}

export async function getMyPath(): Promise<MyPath> {
  const envelope = await request<Envelope<MyPath>>("/me/path");
  return envelope.data;
}

/** M06 Web Full Vertical Slice Tranche 1 (`07_26 v1.0` §14) — same shape as `WebM4Activity`, resolved from the second real assignment. */
export type WebTranche1Activity = WebM4Activity;

export async function getWebTranche1Activity(): Promise<WebTranche1Activity> {
  const envelope = await request<Envelope<WebTranche1Activity>>("/me/web-tranche1-activity");
  return envelope.data;
}

/** M06 Web Full Vertical Slice Tranche 2 (`07_26 v1.0` §16) — same shape as `WebM4Activity`, resolved from the third real assignment. */
export type WebTranche2Activity = WebM4Activity;

export async function getWebTranche2Activity(): Promise<WebTranche2Activity> {
  const envelope = await request<Envelope<WebTranche2Activity>>("/me/web-tranche2-activity");
  return envelope.data;
}

/** M06 Web Full Vertical Slice Tranche 3 (`07_26 v1.0` §5/§13) — same shape as `WebM4Activity`, resolved from the fourth real assignment. */
export type WebTranche3Activity = WebM4Activity;

export async function getWebTranche3Activity(): Promise<WebTranche3Activity> {
  const envelope = await request<Envelope<WebTranche3Activity>>("/me/web-tranche3-activity");
  return envelope.data;
}

/** M06 Web Full Vertical Slice Tranche 4 (`07_26 v1.0` §5/§6/§13) — same shape as `WebM4Activity`, resolved from the fifth real assignment. */
export type WebTranche4Activity = WebM4Activity;

export async function getWebTranche4Activity(): Promise<WebTranche4Activity> {
  const envelope = await request<Envelope<WebTranche4Activity>>("/me/web-tranche4-activity");
  return envelope.data;
}

/** M06 Web Full Vertical Slice Tranche 5 (`07_26 v1.1` §13/§17) — same shape as `WebM4Activity`, resolved from the sixth real assignment. */
export type WebTranche5Activity = WebM4Activity;

export async function getWebTranche5Activity(): Promise<WebTranche5Activity> {
  const envelope = await request<Envelope<WebTranche5Activity>>("/me/web-tranche5-activity");
  return envelope.data;
}

/** M06 Web Full Vertical Slice Tranche 6 (`07_26 v1.1` §17.4) — same shape as `WebM4Activity`, resolved from the seventh real assignment (the Full Sequence's standalone reflection group). */
export type WebTranche6Activity = WebM4Activity;

export async function getWebTranche6Activity(): Promise<WebTranche6Activity> {
  const envelope = await request<Envelope<WebTranche6Activity>>("/me/web-tranche6-activity");
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

export interface OrchestrationStageEntryResult {
  attemptId: string;
  attemptState: string;
}

/**
 * M06 Non-Interactive Attempt Lifecycle (`07_15_01 v1.3` §11-bis.2-bis).
 * NOT a semantic action — never routed through `submitAction`/
 * `POST /attempts/{attemptId}/actions`. Called by `SequenceHost` on
 * entering a stage that is `isInteractive: false` with no
 * `engineDispatchRef`, so an attempt on a wholly non-interactive content
 * bundle (e.g. INTRO_HOOK) can leave `CREATED` even though it never
 * dispatches a Learning Engine. Safe to call more than once for the same
 * attempt — idempotent server-side.
 */
export async function notifyOrchestrationStageEntry(attemptId: string, csrfToken: string): Promise<OrchestrationStageEntryResult> {
  const envelope = await request<Envelope<OrchestrationStageEntryResult>>(
    `/attempts/${encodeURIComponent(attemptId)}/orchestration-stage-entry`,
    { method: "POST", csrfToken },
  );
  return envelope.data;
}

export interface CompleteAttemptResult {
  attemptId: string;
  completionStatus: string;
  outcome?: Record<string, unknown>;
}

/**
 * `finalClientSequence` is omitted from the request body entirely when
 * `undefined` — never coerced to `0` — because `checkFinalClientSequence`
 * (`02_26` §18.5) treats any numeric claim as "an action with this
 * clientSequence must already be persisted"; `0` would falsely claim a
 * first action exists for an attempt that never submitted one (e.g.
 * INTRO_HOOK, `07_15_01 v1.3` §11-bis.2-bis), which the server correctly
 * rejects as `MISSING_ACTION`.
 */
export async function completeAttempt(
  attemptId: string,
  finalClientSequence: number | undefined,
  csrfToken: string,
): Promise<CompleteAttemptResult> {
  const envelope = await request<Envelope<CompleteAttemptResult>>(`/attempts/${encodeURIComponent(attemptId)}/complete`, {
    method: "POST",
    body: finalClientSequence === undefined ? {} : { finalClientSequence },
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

export interface AttemptActionRecord {
  actionType: string;
  targetRole: string | null;
  payload: Record<string, unknown>;
  clientSequence: number;
}

/**
 * M06 Web Full Vertical Slice Tranche 2 (`07_26 v1.0` §13): the attempt's
 * own semantic action log, ordered by `clientSequence` — lets the activity
 * page rehydrate `EngineHost`'s in-memory state via `replayActions()`
 * after a reload instead of silently resetting to the first item of a
 * `QUICK_QUESTION_SET`.
 */
export async function getAttemptActions(attemptId: string): Promise<AttemptActionRecord[]> {
  const envelope = await request<Envelope<{ actions: AttemptActionRecord[] }>>(`/attempts/${encodeURIComponent(attemptId)}/actions`);
  return envelope.data.actions;
}
