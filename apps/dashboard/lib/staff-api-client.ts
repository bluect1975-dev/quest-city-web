import { StaffApiError } from "./staff-api-error";
import type {
  AcceptStaffInvitationResult,
  AttemptHistoryEntry,
  AttemptReviewDetail,
  ClassSummary,
  CreateStaffInvitationResult,
  GeneralAssignment,
  MembershipStatusAction,
  ProgressAggregate,
  RecoveryAssignment,
  RemoveRosterMemberResult,
  ReviewQueueItem,
  ReviewQueueItemPriority,
  ReviewQueueItemStatus,
  RosterMember,
  RosterMode,
  SchoolClassDetail,
  StaffContext,
  StaffMember,
  StaffMembershipStatusResult,
  StaffRole,
  StudentProgressSummary,
  StudentRosterEntry,
  TeacherClassAssignment,
  TeacherFeedback,
} from "./staff-api-types";

/**
 * Base URL for `apps/api` (02_35, contracts/quest-city-platform-openapi-v1_6.yaml).
 * Empty string resolves to a same-origin relative path, which is what the
 * production/Docker-compose topology needs (Nginx routes `/api/` to
 * `apps/api` — 07_06 §3); `NEXT_PUBLIC_API_BASE_URL_DASHBOARD` lets local
 * `next dev` point at a directly-running API instance instead.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL_DASHBOARD ?? "/api";

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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

export async function getClass(classId: string): Promise<SchoolClassDetail> {
  const envelope = await request<Envelope<SchoolClassDetail>>(`/classes/${encodeURIComponent(classId)}`);
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

/** `POST /staff/invitations` (02_35 v1.2 §11bis.3). SCHOOL_ADMIN-only. */
export async function inviteStaffMember(input: { email: string; csrfToken: string }): Promise<CreateStaffInvitationResult> {
  const envelope = await request<Envelope<CreateStaffInvitationResult>>("/staff/invitations", {
    method: "POST",
    body: { email: input.email, role: "TEACHER" },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `POST /staff/invitations/accept` — no staff session, no CSRF token (public, token-based). */
export async function acceptStaffInvitation(input: {
  token: string;
  password: string | undefined;
}): Promise<AcceptStaffInvitationResult> {
  const envelope = await request<Envelope<AcceptStaffInvitationResult>>("/staff/invitations/accept", {
    method: "POST",
    body: { token: input.token, password: input.password },
  });
  return envelope.data;
}

/** `GET /staff/members` (02_35 v1.2 §11bis.4). SCHOOL_ADMIN-only. */
export async function listStaffMembers(): Promise<StaffMember[]> {
  const envelope = await request<Envelope<StaffMember[]>>("/staff/members");
  return envelope.data;
}

/** `PATCH /staff/members/{id}` (02_35 v1.2 §11bis.2). */
export async function updateStaffMembershipStatus(input: {
  staffTenantMembershipId: string;
  action: MembershipStatusAction;
  csrfToken: string;
}): Promise<StaffMembershipStatusResult> {
  const envelope = await request<Envelope<StaffMembershipStatusResult>>(
    `/staff/members/${encodeURIComponent(input.staffTenantMembershipId)}`,
    {
      method: "PATCH",
      body: { action: input.action },
      csrfToken: input.csrfToken,
      idempotencyKey: generateIdempotencyKey(),
    },
  );
  return envelope.data;
}

/** `POST /classes` (02_35 v1.2 §11bis.6). SCHOOL_ADMIN-only (class.create). */
export async function createClass(input: { name: string; csrfToken: string }): Promise<SchoolClassDetail> {
  const envelope = await request<Envelope<SchoolClassDetail>>("/classes", {
    method: "POST",
    body: { name: input.name },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `PATCH /classes/{classId}` (02_35 v1.2 §11bis.6). class.manage. */
export async function renameClass(input: { classId: string; name: string; csrfToken: string }): Promise<SchoolClassDetail> {
  const envelope = await request<Envelope<SchoolClassDetail>>(`/classes/${encodeURIComponent(input.classId)}`, {
    method: "PATCH",
    body: { name: input.name },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `POST /classes/{classId}/archive` (02_35 v1.2 §11bis.6). class.manage. */
export async function archiveClass(input: { classId: string; csrfToken: string }): Promise<SchoolClassDetail> {
  const envelope = await request<Envelope<SchoolClassDetail>>(`/classes/${encodeURIComponent(input.classId)}/archive`, {
    method: "POST",
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/**
 * `POST /classes/{classId}/access-code` (OpenAPI v1.10 — 02_26 v1.12
 * §34.3). class.manage. Revokes any existing ACTIVE code and returns the
 * new one-time plaintext code — shown to SCHOOL_ADMIN exactly once by the
 * caller, never persisted in clear.
 */
export async function regenerateClassAccessCode(input: {
  classId: string;
  csrfToken: string;
}): Promise<{ classId: string; accessCode: string; issuedAt: string }> {
  const envelope = await request<Envelope<{ classId: string; accessCode: string; issuedAt: string }>>(
    `/classes/${encodeURIComponent(input.classId)}/access-code`,
    {
      method: "POST",
      csrfToken: input.csrfToken,
      idempotencyKey: generateIdempotencyKey(),
    },
  );
  return envelope.data;
}

/** `POST /classes/{classId}/teachers` (02_35 v1.2 §11bis.6). class.teacher.assign. */
export async function assignTeacherToClass(input: {
  classId: string;
  staffTenantMembershipId: string;
  csrfToken: string;
}): Promise<TeacherClassAssignment> {
  const envelope = await request<Envelope<TeacherClassAssignment>>(`/classes/${encodeURIComponent(input.classId)}/teachers`, {
    method: "POST",
    body: { staffTenantMembershipId: input.staffTenantMembershipId },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `DELETE /classes/{classId}/teachers/{id}` (02_35 v1.2 §11bis.6). class.teacher.assign. */
export async function unassignTeacherFromClass(input: {
  classId: string;
  staffTenantMembershipId: string;
  csrfToken: string;
}): Promise<TeacherClassAssignment> {
  const envelope = await request<Envelope<TeacherClassAssignment>>(
    `/classes/${encodeURIComponent(input.classId)}/teachers/${encodeURIComponent(input.staffTenantMembershipId)}`,
    {
      method: "DELETE",
      csrfToken: input.csrfToken,
      idempotencyKey: generateIdempotencyKey(),
    },
  );
  return envelope.data;
}

/** `POST /classes/{classId}/students` (02_35 v1.2 §11bis.7). roster.manage. */
export async function addStudentToRoster(input: {
  classId: string;
  mode: RosterMode;
  studentPublicId: string | undefined;
  accessAlias: string;
  pin: string | undefined;
  csrfToken: string;
}): Promise<RosterMember> {
  const envelope = await request<Envelope<RosterMember>>(`/classes/${encodeURIComponent(input.classId)}/students`, {
    method: "POST",
    body: {
      mode: input.mode,
      studentPublicId: input.studentPublicId,
      accessAlias: input.accessAlias,
      pin: input.pin,
    },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `DELETE /classes/{classId}/students/{id}` (02_35 v1.2 §11bis.7). roster.manage. */
export async function removeStudentFromRoster(input: {
  classId: string;
  studentProfileId: string;
  csrfToken: string;
}): Promise<RemoveRosterMemberResult> {
  const envelope = await request<Envelope<RemoveRosterMemberResult>>(
    `/classes/${encodeURIComponent(input.classId)}/students/${encodeURIComponent(input.studentProfileId)}`,
    {
      method: "DELETE",
      csrfToken: input.csrfToken,
      idempotencyKey: generateIdempotencyKey(),
    },
  );
  return envelope.data;
}

/** `POST /assignments` (02_35 v1.2 §11bis.8-9). assignment.create. */
export async function createGeneralAssignment(input: {
  classId: string;
  contentBundleId: string;
  title: string;
  allowedRuntimeChannels: Array<"WEB" | "ROBLOX">;
  csrfToken: string;
}): Promise<GeneralAssignment> {
  const envelope = await request<Envelope<GeneralAssignment>>("/assignments", {
    method: "POST",
    body: {
      classId: input.classId,
      contentBundleId: input.contentBundleId,
      title: input.title,
      allowedRuntimeChannels: input.allowedRuntimeChannels,
    },
    csrfToken: input.csrfToken,
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
