import { StaffApiError } from "./staff-api-error";
import type {
  AttemptHistoryEntry,
  AttemptReviewDetail,
  ClassSummary,
  ProgressAggregate,
  RecoveryAssignment,
  ReviewQueueItem,
  ReviewQueueItemPriority,
  ReviewQueueItemStatus,
  StaffContext,
  StaffRole,
  StudentProgressSummary,
  StudentRosterEntry,
  TeacherFeedback,
} from "./staff-api-types";

/**
 * Base URL for `apps/api` (02_35, contracts/quest-city-platform-openapi-v1_6.yaml).
 * Empty string resolves to a same-origin relative path, which is what the
 * production/Docker-compose topology needs (Nginx routes `/api/` to
 * `apps/api` — 07_06 §3); `NEXT_PUBLIC_API_BASE_URL_DASHBOARD` lets local
 * `next dev` point at a directly-running API instance instead.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL_DASHBOARD ?? "";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  csrfToken?: string | null;
  ifMatchVersion?: number;
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
    headers["X-CSRF-Token"] = options.csrfToken;
  }
  if (options.ifMatchVersion !== undefined) {
    headers["If-Match"] = String(options.ifMatchVersion);
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
    throw new StaffApiError(envelope?.code ?? "UNKNOWN_ERROR", envelope?.message ?? "Unexpected error", response.status);
  }
  return json as T;
}

/** A fresh key per mutating call — never reused across distinct user actions (02_35 §14). */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function startStaffSession(input: {
  email: string;
  password: string;
  tenantId?: string | undefined;
}): Promise<{ csrfToken: string; tenantId: string; role: StaffRole }> {
  const envelope = await request<Envelope<{ csrfToken: string; tenantId: string; role: StaffRole }>>(
    "/staff-auth/session/start",
    { method: "POST", body: input },
  );
  return envelope.data;
}

export async function refreshStaffSession(csrfToken: string): Promise<{ csrfToken: string }> {
  const envelope = await request<Envelope<{ csrfToken: string }>>("/staff-auth/session/refresh", {
    method: "POST",
    csrfToken,
  });
  return envelope.data;
}

export async function staffLogout(csrfToken: string | null): Promise<void> {
  await request<Envelope<{ loggedOut: boolean }>>("/staff-auth/logout", { method: "POST", csrfToken });
}

export async function getStaffContext(): Promise<StaffContext> {
  const envelope = await request<Envelope<StaffContext>>("/me/staff-context");
  return envelope.data;
}

export async function listClasses(): Promise<ClassSummary[]> {
  const envelope = await request<Envelope<ClassSummary[]>>("/classes");
  return envelope.data;
}

export async function getClass(classId: string): Promise<ClassSummary> {
  const envelope = await request<Envelope<ClassSummary>>(`/classes/${encodeURIComponent(classId)}`);
  return envelope.data;
}

export async function listClassStudents(classId: string): Promise<StudentRosterEntry[]> {
  const envelope = await request<Envelope<StudentRosterEntry[]>>(`/classes/${encodeURIComponent(classId)}/students`);
  return envelope.data;
}

export async function getClassStudent(classId: string, studentProfileId: string): Promise<StudentRosterEntry> {
  const envelope = await request<Envelope<StudentRosterEntry>>(
    `/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentProfileId)}`,
  );
  return envelope.data;
}

export async function getClassProgress(classId: string): Promise<ProgressAggregate> {
  const envelope = await request<Envelope<ProgressAggregate>>(`/classes/${encodeURIComponent(classId)}/progress`);
  return envelope.data;
}

export async function getStudentProgress(classId: string, studentProfileId: string): Promise<StudentProgressSummary> {
  const envelope = await request<Envelope<StudentProgressSummary>>(
    `/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentProfileId)}/progress`,
  );
  return envelope.data;
}

export async function getStudentAttempts(classId: string, studentProfileId: string): Promise<AttemptHistoryEntry[]> {
  const envelope = await request<Envelope<AttemptHistoryEntry[]>>(
    `/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentProfileId)}/attempts`,
  );
  return envelope.data;
}

export async function listReviewQueue(filter: {
  classId?: string | undefined;
  status?: ReviewQueueItemStatus | undefined;
  priority?: ReviewQueueItemPriority | undefined;
}): Promise<ReviewQueueItem[]> {
  const params = new URLSearchParams();
  if (filter.classId) params.set("classId", filter.classId);
  if (filter.status) params.set("status", filter.status);
  if (filter.priority) params.set("priority", filter.priority);
  const query = params.toString();
  const envelope = await request<Envelope<ReviewQueueItem[]>>(`/review${query ? `?${query}` : ""}`);
  return envelope.data;
}

export async function transitionReviewItemStatus(input: {
  reviewItemId: string;
  targetStatus: ReviewQueueItemStatus;
  version: number;
  csrfToken: string;
}): Promise<ReviewQueueItem> {
  const envelope = await request<Envelope<ReviewQueueItem>>(`/review/${encodeURIComponent(input.reviewItemId)}/status`, {
    method: "POST",
    body: { targetStatus: input.targetStatus },
    csrfToken: input.csrfToken,
    ifMatchVersion: input.version,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

export async function getAttemptReviewDetail(attemptId: string): Promise<AttemptReviewDetail> {
  const envelope = await request<Envelope<AttemptReviewDetail>>(`/attempts/${encodeURIComponent(attemptId)}/review`);
  return envelope.data;
}

export async function createTeacherFeedback(input: {
  attemptId: string;
  structuredFeedback: Record<string, unknown>;
  freeText: string | null;
  originReviewQueueItemId: string | null;
  csrfToken: string;
}): Promise<TeacherFeedback> {
  const envelope = await request<Envelope<TeacherFeedback>>(`/attempts/${encodeURIComponent(input.attemptId)}/feedback`, {
    method: "POST",
    body: {
      structuredFeedback: input.structuredFeedback,
      freeText: input.freeText ?? undefined,
      originReviewQueueItemId: input.originReviewQueueItemId ?? undefined,
    },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

export async function publishTeacherFeedback(input: {
  feedbackId: string;
  version: number;
  csrfToken: string;
}): Promise<TeacherFeedback> {
  const envelope = await request<Envelope<TeacherFeedback>>(`/feedback/${encodeURIComponent(input.feedbackId)}/publish`, {
    method: "POST",
    csrfToken: input.csrfToken,
    ifMatchVersion: input.version,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

export async function revokeTeacherFeedback(input: {
  feedbackId: string;
  version: number;
  csrfToken: string;
}): Promise<TeacherFeedback> {
  const envelope = await request<Envelope<TeacherFeedback>>(`/feedback/${encodeURIComponent(input.feedbackId)}/revoke`, {
    method: "POST",
    csrfToken: input.csrfToken,
    ifMatchVersion: input.version,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

export async function createRecoveryAssignment(input: {
  attemptId: string;
  originTeacherFeedbackId: string;
  contentBundleId: string;
  allowedRuntimeChannels: Array<"WEB" | "ROBLOX">;
  csrfToken: string;
}): Promise<RecoveryAssignment> {
  const envelope = await request<Envelope<RecoveryAssignment>>(
    `/attempts/${encodeURIComponent(input.attemptId)}/recovery-assignment`,
    {
      method: "POST",
      body: {
        originTeacherFeedbackId: input.originTeacherFeedbackId,
        contentBundleId: input.contentBundleId,
        allowedRuntimeChannels: input.allowedRuntimeChannels,
      },
      csrfToken: input.csrfToken,
      idempotencyKey: generateIdempotencyKey(),
    },
  );
  return envelope.data;
}
