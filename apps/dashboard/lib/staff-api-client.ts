import { StaffApiError } from "./staff-api-error";
import type {
  AcceptStaffInvitationResult,
  AttemptHistoryEntry,
  AttemptReviewDetail,
  ClassMigrationDecision,
  ClassSummary,
  ConvergenceRequest,
  CreateStaffInvitationResult,
  DifficultyOverrideResult,
  EffectiveResolution,
  FacilitationProposal,
  FacilitationProposalStatus,
  FacilitationProposalType,
  GeneralAssignment,
  InvitableStaffRole,
  LearningPathAlternative,
  LearningPathPolicy,
  LearningPathReasonCategory,
  LearningPathResourceType,
  LearningPathScope,
  LearningPathState,
  LearningSupportEvent,
  MembershipStatusAction,
  MyAssignedStudent,
  ObservationHistoryEntry,
  OwnershipDecision,
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
  SupportIntensity,
  SupportProfileCategory,
  SupportProfileEntry,
  SupportProfileLevel,
  SupportStudentAssignment,
  SupportStudentAssignmentStatus,
  SupportType,
  TeacherClassAssignment,
  TeacherFeedback,
  TenantMembership,
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
    const envelope = json as { code?: string; message?: string; safeDetails?: Record<string, unknown> } | null;
    throw new StaffApiError(
      envelope?.code ?? "UNKNOWN_ERROR",
      envelope?.message ?? "Unexpected error",
      response.status,
      envelope?.safeDetails,
    );
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
  staffTenantMembershipId?: string | undefined;
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
export async function inviteStaffMember(input: { email: string; role?: InvitableStaffRole; csrfToken: string }): Promise<CreateStaffInvitationResult> {
  const envelope = await request<Envelope<CreateStaffInvitationResult>>("/staff/invitations", {
    method: "POST",
    body: { email: input.email, role: input.role ?? "TEACHER" },
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

/**
 * `GET /convergence-requests` (contracts/quest-city-platform-openapi-v1_12.yaml,
 * capability convergence.read). Scoped server-side to the caller's own
 * tenant as sourceTenantId (INDEPENDENT_EDUCATOR) or targetTenantId
 * (SCHOOL_ADMIN).
 */
export async function listConvergenceRequests(params: { limit?: number; offset?: number } = {}): Promise<ConvergenceRequest[]> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const queryString = query.toString();
  const envelope = await request<Envelope<ConvergenceRequest[]>>(`/convergence-requests${queryString ? `?${queryString}` : ""}`);
  return envelope.data;
}

/**
 * `POST /convergence-requests` (capability convergence.request).
 * Idempotency-Key required (02_26 v1.14 §36.13) -- a retry with the same
 * key and payload replays the same created request, never a second row.
 */
export async function createConvergenceRequest(input: {
  sourceTenantId: string;
  targetTenantId: string;
  educatorStaffAccountId: string;
  csrfToken: string;
}): Promise<ConvergenceRequest> {
  const envelope = await request<Envelope<ConvergenceRequest>>("/convergence-requests", {
    method: "POST",
    body: {
      sourceTenantId: input.sourceTenantId,
      targetTenantId: input.targetTenantId,
      educatorStaffAccountId: input.educatorStaffAccountId,
    },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `GET /convergence-requests/{id}` (capability convergence.read). */
export async function getConvergenceRequest(id: string): Promise<ConvergenceRequest> {
  const envelope = await request<Envelope<ConvergenceRequest>>(`/convergence-requests/${encodeURIComponent(id)}`);
  return envelope.data;
}

/**
 * `POST /convergence-requests/{id}/approve` (capability
 * convergence.approve.school or convergence.approve.teacher, depending on
 * the caller's tenant role). `migrationPlanFingerprint` must match the
 * current migration plan's fingerprint exactly (CONVERGENCE_PREVIEW_STALE
 * otherwise) -- classDecisions/ownershipDecisions are optional (02_38 v1.4
 * §12/§14). No Idempotency-Key on this route.
 */
export async function approveConvergenceRequest(input: {
  id: string;
  migrationPlanFingerprint: string;
  classDecisions?: Array<{ classId: string; decision: ClassMigrationDecision }>;
  ownershipDecisions?: Array<{ resourceId: string; decision: OwnershipDecision }>;
  csrfToken: string;
}): Promise<ConvergenceRequest> {
  const envelope = await request<Envelope<ConvergenceRequest>>(`/convergence-requests/${encodeURIComponent(input.id)}/approve`, {
    method: "POST",
    body: {
      migrationPlanFingerprint: input.migrationPlanFingerprint,
      classDecisions: input.classDecisions,
      ownershipDecisions: input.ownershipDecisions,
    },
    csrfToken: input.csrfToken,
  });
  return envelope.data;
}

/** `POST /convergence-requests/{id}/reject` (same capability as approve, for the current step). No Idempotency-Key on this route. */
export async function rejectConvergenceRequest(input: {
  id: string;
  rejectionReason?: string | null;
  csrfToken: string;
}): Promise<ConvergenceRequest> {
  const envelope = await request<Envelope<ConvergenceRequest>>(`/convergence-requests/${encodeURIComponent(input.id)}/reject`, {
    method: "POST",
    body: { rejectionReason: input.rejectionReason ?? null },
    csrfToken: input.csrfToken,
  });
  return envelope.data;
}

/** `GET /me/tenant-memberships` (02_35 v1.5 §11quater.5) -- self-read, no capability required. Foundation for tenant context switching. */
export async function listMyTenantMemberships(): Promise<TenantMembership[]> {
  const envelope = await request<Envelope<TenantMembership[]>>("/me/tenant-memberships");
  return envelope.data;
}

/**
 * `POST /staff-auth/session/switch-tenant` (02_35 v1.5 §11quater.5, 02_38
 * v1.4 §13.2). tenantId is verified server-side against the caller's own
 * ACTIVE memberships; a new session cookie is issued and the prior one
 * revoked. Callers must re-fetch the staff auth context (or reload) after
 * this succeeds, same as after any other session-mutating action.
 */
export async function switchSessionTenant(input: {
  tenantId: string;
  /** Required when the identity holds more than one ACTIVE membership on tenantId (same-tenant multi-role, 02_39 v1.1 §3bis.5) -- otherwise the server returns 409 AMBIGUOUS_TENANT_MEMBERSHIP. */
  staffTenantMembershipId?: string;
  csrfToken: string;
}): Promise<{ tenantId: string; role: StaffRole }> {
  const envelope = await request<Envelope<{ tenantId: string; role: StaffRole }>>("/staff-auth/session/switch-tenant", {
    method: "POST",
    body: { tenantId: input.tenantId, ...(input.staffTenantMembershipId ? { staffTenantMembershipId: input.staffTenantMembershipId } : {}) },
    csrfToken: input.csrfToken,
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

/* ---------------------------------------------------------------------
 * Student Support Roles (02_25 v1.12 §6.16, 02_35 v1.7 §11quinquies/
 * §11sexies, 02_39 v1.2, 02_26 v1.17 §37/§37bis/§38).
 * ------------------------------------------------------------------- */

/** `POST /platform/support-assignments` (02_26 v1.16 §37.2) -- SCHOOL_ADMIN-only. */
export async function createSupportStudentAssignment(input: {
  staffTenantMembershipId: string;
  studentPublicId: string;
  classId?: string;
  csrfToken: string;
}): Promise<SupportStudentAssignment> {
  const envelope = await request<Envelope<SupportStudentAssignment>>("/platform/support-assignments", {
    method: "POST",
    body: { staffTenantMembershipId: input.staffTenantMembershipId, studentPublicId: input.studentPublicId, classId: input.classId ?? null },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `GET /platform/support-assignments` (02_26 v1.16 §37.2) -- coverage view source, SCHOOL_ADMIN-only. */
export async function listSupportStudentAssignments(filter: {
  staffAccountId?: string;
  studentPublicId?: string;
  status?: SupportStudentAssignmentStatus;
} = {}): Promise<SupportStudentAssignment[]> {
  const params = new URLSearchParams();
  if (filter.staffAccountId) params.set("staffAccountId", filter.staffAccountId);
  if (filter.studentPublicId) params.set("studentPublicId", filter.studentPublicId);
  if (filter.status) params.set("status", filter.status);
  const query = params.toString();
  const envelope = await request<Envelope<SupportStudentAssignment[]>>(`/platform/support-assignments${query ? `?${query}` : ""}`);
  return envelope.data;
}

/** `PATCH /platform/support-assignments/{id}/status` (02_26 v1.16 §37.2). */
export async function transitionSupportStudentAssignmentStatus(input: {
  id: string;
  targetStatus: "ENDED" | "REVOKED";
  csrfToken: string;
}): Promise<{ id: string; status: SupportStudentAssignmentStatus }> {
  const envelope = await request<Envelope<{ id: string; status: SupportStudentAssignmentStatus }>>(
    `/platform/support-assignments/${encodeURIComponent(input.id)}/status`,
    { method: "PATCH", body: { targetStatus: input.targetStatus }, csrfToken: input.csrfToken },
  );
  return envelope.data;
}

/** `GET /me/asacom-assigned-students` (02_26 v1.16 §37.3) -- "My assigned students", shared by ASACOM and SUPPORT_TEACHER. */
export async function listMyAssignedStudents(): Promise<MyAssignedStudent[]> {
  const envelope = await request<Envelope<MyAssignedStudent[]>>("/me/asacom-assigned-students");
  return envelope.data;
}

/** `GET /students/{studentPublicId}/support-events` (02_26 v1.16 §37.4) -- shared read for TEACHER/SUPPORT_TEACHER/ASACOM. */
export async function listSupportEvents(studentPublicId: string): Promise<LearningSupportEvent[]> {
  const envelope = await request<Envelope<LearningSupportEvent[]>>(`/students/${encodeURIComponent(studentPublicId)}/support-events`);
  return envelope.data;
}

/** `POST /asacom/support-events` or `POST /support-teacher/support-events` (02_26 v1.16 §37.4) -- `actorRole` selects the path (server resolves authority from the session either way). */
export async function createSupportEvent(input: {
  actorRole: "ASACOM" | "SUPPORT_TEACHER";
  studentPublicId: string;
  learningAttemptId: string;
  supportType: SupportType;
  intensity: SupportIntensity;
  durationSeconds?: number;
  csrfToken: string;
}): Promise<LearningSupportEvent> {
  const path = input.actorRole === "ASACOM" ? "/asacom/support-events" : "/support-teacher/support-events";
  const envelope = await request<Envelope<LearningSupportEvent>>(path, {
    method: "POST",
    body: {
      studentPublicId: input.studentPublicId,
      learningAttemptId: input.learningAttemptId,
      supportType: input.supportType,
      intensity: input.intensity,
      durationSeconds: input.durationSeconds ?? null,
    },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `GET /students/{studentPublicId}/support-observations` (`contracts/quest-city-platform-openapi-v1_14.yaml`, 02_26 v1.17 §38.1). */
export async function listSupportObservations(
  studentPublicId: string,
  filter: { category?: SupportType; includeSuperseded?: boolean } = {},
): Promise<ObservationHistoryEntry[]> {
  const params = new URLSearchParams();
  if (filter.category) params.set("category", filter.category);
  if (filter.includeSuperseded) params.set("includeSuperseded", "true");
  const query = params.toString();
  const envelope = await request<Envelope<ObservationHistoryEntry[]>>(
    `/students/${encodeURIComponent(studentPublicId)}/support-observations${query ? `?${query}` : ""}`,
  );
  return envelope.data;
}

/** `POST /asacom/observations` or `POST /support-teacher/observations` (02_26 v1.16 §37.5). */
export async function createObservation(input: {
  actorRole: "ASACOM" | "SUPPORT_TEACHER";
  studentPublicId: string;
  category?: SupportType;
  csrfToken: string;
}): Promise<ObservationHistoryEntry> {
  const path = input.actorRole === "ASACOM" ? "/asacom/observations" : "/support-teacher/observations";
  const envelope = await request<Envelope<ObservationHistoryEntry>>(path, {
    method: "POST",
    body: { studentPublicId: input.studentPublicId, category: input.category ?? null },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `POST /{asacom|support-teacher}/observations/{id}/supersede` (02_26 v1.16 §37.5) -- author-only correction, original never mutated. */
export async function supersedeObservation(input: {
  actorRole: "ASACOM" | "SUPPORT_TEACHER";
  observationId: string;
  category?: SupportType;
  csrfToken: string;
}): Promise<ObservationHistoryEntry> {
  const basePath = input.actorRole === "ASACOM" ? "/asacom/observations" : "/support-teacher/observations";
  const envelope = await request<Envelope<ObservationHistoryEntry>>(`${basePath}/${encodeURIComponent(input.observationId)}/supersede`, {
    method: "POST",
    body: { category: input.category ?? null },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `GET /students/{studentPublicId}/facilitation` (02_26 v1.16 §37.6). */
export async function getStudentFacilitation(studentPublicId: string): Promise<SupportProfileEntry[]> {
  const envelope = await request<Envelope<SupportProfileEntry[]>>(`/students/${encodeURIComponent(studentPublicId)}/facilitation`);
  return envelope.data;
}

/** `POST /asacom/facilitation/{studentPublicId}/apply-temporary` (02_26 v1.16 §37.6) -- SESSION_ONLY, TOOLS category only. No Idempotency-Key (non-persistent effect). */
export async function applyAsacomFacilitationTemporary(input: {
  studentPublicId: string;
  configJson?: Record<string, unknown>;
  csrfToken: string;
}): Promise<SupportProfileEntry> {
  const envelope = await request<Envelope<SupportProfileEntry>>(`/asacom/facilitation/${encodeURIComponent(input.studentPublicId)}/apply-temporary`, {
    method: "POST",
    body: { category: "TOOLS", configJson: input.configJson ?? {} },
    csrfToken: input.csrfToken,
  });
  return envelope.data;
}

/** `POST /support-teacher/facilitation/{studentPublicId}/apply` (02_26 v1.16 §37.6) -- SESSION_ONLY or PROFILE_LEVEL, own assigned students only. Idempotency-Key required only for PROFILE_LEVEL. */
export async function applySupportTeacherFacilitation(input: {
  studentPublicId: string;
  category: SupportProfileCategory;
  level: SupportProfileLevel;
  configJson?: Record<string, unknown>;
  csrfToken: string;
}): Promise<SupportProfileEntry> {
  const options: RequestOptions = {
    method: "POST",
    body: { category: input.category, level: input.level, configJson: input.configJson ?? {} },
    csrfToken: input.csrfToken,
  };
  if (input.level === "PROFILE_LEVEL") {
    options.idempotencyKey = generateIdempotencyKey();
  }
  const envelope = await request<Envelope<SupportProfileEntry>>(
    `/support-teacher/facilitation/${encodeURIComponent(input.studentPublicId)}/apply`,
    options,
  );
  return envelope.data;
}

/** `POST /support-teacher/difficulty-overrides` (02_26 v1.16 §37.6) -- per-student, motivated/audited override. */
export async function createSupportTeacherDifficultyOverride(input: {
  studentPublicId: string;
  targetRef: string;
  reason: string;
  csrfToken: string;
}): Promise<DifficultyOverrideResult> {
  const envelope = await request<Envelope<DifficultyOverrideResult>>("/support-teacher/difficulty-overrides", {
    method: "POST",
    body: { studentPublicId: input.studentPublicId, targetRef: input.targetRef, reason: input.reason },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `POST /asacom/facilitation-proposals` or `POST /support-teacher/facilitation-proposals` (02_26 v1.16 §37.7). */
export async function createFacilitationProposal(input: {
  actorRole: "ASACOM" | "SUPPORT_TEACHER";
  studentPublicId: string;
  proposalType: FacilitationProposalType;
  targetCategory?: string;
  csrfToken: string;
}): Promise<FacilitationProposal> {
  const path = input.actorRole === "ASACOM" ? "/asacom/facilitation-proposals" : "/support-teacher/facilitation-proposals";
  const envelope = await request<Envelope<FacilitationProposal>>(path, {
    method: "POST",
    body: { studentPublicId: input.studentPublicId, proposalType: input.proposalType, targetCategory: input.targetCategory ?? null },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `GET /facilitation-proposals` (02_26 v1.16 §37.7) -- the caller's own authored proposals. */
export async function listMyFacilitationProposals(): Promise<FacilitationProposal[]> {
  const envelope = await request<Envelope<FacilitationProposal[]>>("/facilitation-proposals");
  return envelope.data;
}

/** `GET /facilitation-proposals?studentPublicId=...` -- scope-based list for one student (TEACHER/SUPPORT_TEACHER with access), used by the Support Student Detail page's Proposals section. */
export async function listFacilitationProposalsForStudent(studentPublicId: string): Promise<FacilitationProposal[]> {
  const envelope = await request<Envelope<FacilitationProposal[]>>(`/facilitation-proposals?studentPublicId=${encodeURIComponent(studentPublicId)}`);
  return envelope.data;
}

/** `GET /me/facilitation-proposals/review-queue` (`contracts/quest-city-platform-openapi-v1_14.yaml`, 02_26 v1.17 §38.2). */
export async function listFacilitationProposalReviewQueue(status: FacilitationProposalStatus = "SUBMITTED"): Promise<FacilitationProposal[]> {
  const envelope = await request<Envelope<FacilitationProposal[]>>(`/me/facilitation-proposals/review-queue?status=${encodeURIComponent(status)}`);
  return envelope.data;
}

/** `POST /facilitation-proposals/{id}/review` (02_26 v1.16 §37.7) -- If-Match/version required, anti-self-approval server-enforced. */
export async function reviewFacilitationProposal(input: {
  id: string;
  decision: "ACCEPT" | "REJECT";
  reviewNote?: string;
  ifMatchVersion: number;
  csrfToken: string;
}): Promise<FacilitationProposal> {
  const envelope = await request<Envelope<FacilitationProposal>>(`/facilitation-proposals/${encodeURIComponent(input.id)}/review`, {
    method: "POST",
    body: { decision: input.decision, reviewNote: input.reviewNote ?? null },
    csrfToken: input.csrfToken,
    ifMatchVersion: input.ifMatchVersion,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `POST /facilitation-proposals/{id}/withdraw` (02_26 v1.16 §37.7) -- author-only, only while SUBMITTED. */
export async function withdrawFacilitationProposal(input: { id: string; csrfToken: string }): Promise<FacilitationProposal> {
  const envelope = await request<Envelope<FacilitationProposal>>(`/facilitation-proposals/${encodeURIComponent(input.id)}/withdraw`, {
    method: "POST",
    csrfToken: input.csrfToken,
  });
  return envelope.data;
}

/**
 * Granular Learning Path Control (02_41 v1.1, contracts/quest-city-platform-openapi-v1_15.yaml).
 * `POST /learning-path-policies` -- create/upsert a policy at a given scope.
 */
export async function createLearningPathPolicy(input: {
  scope: LearningPathScope;
  scopeRef?: string | undefined;
  resourceType: LearningPathResourceType;
  resourceRef: string;
  state: LearningPathState;
  reasonCategory: LearningPathReasonCategory;
  reasonNotes?: string | undefined;
  alternativeContentRef?: string | undefined;
  csrfToken: string;
}): Promise<LearningPathPolicy> {
  const envelope = await request<Envelope<LearningPathPolicy>>("/learning-path-policies", {
    method: "POST",
    body: {
      scope: input.scope,
      scopeRef: input.scopeRef,
      resourceType: input.resourceType,
      resourceRef: input.resourceRef,
      state: input.state,
      reasonCategory: input.reasonCategory,
      reasonNotes: input.reasonNotes ?? null,
      alternativeContentRef: input.alternativeContentRef ?? null,
    },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}

/** `GET /learning-path-policies?scope=...&scopeRef=...` (listLearningPathPolicies). */
export async function listLearningPathPolicies(filter: {
  scope?: LearningPathScope | undefined;
  scopeRef?: string | undefined;
  resourceType?: LearningPathResourceType | undefined;
}): Promise<LearningPathPolicy[]> {
  const params = new URLSearchParams();
  if (filter.scope) params.set("scope", filter.scope);
  if (filter.scopeRef) params.set("scopeRef", filter.scopeRef);
  if (filter.resourceType) params.set("resourceType", filter.resourceType);
  const query = params.toString();
  const envelope = await request<Envelope<LearningPathPolicy[]>>(`/learning-path-policies${query ? `?${query}` : ""}`);
  return envelope.data;
}

/** `DELETE /learning-path-policies/{policyId}` -- reverts to INHERIT. */
export async function deleteLearningPathPolicy(input: { policyId: string; csrfToken: string }): Promise<void> {
  await request<null>(`/learning-path-policies/${encodeURIComponent(input.policyId)}`, {
    method: "DELETE",
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
}

/** `GET /learning-path/effective` -- server-authoritative single-resource resolution. */
export async function getEffectiveLearningPathAvailability(input: {
  resourceType: LearningPathResourceType;
  resourceRef: string;
  classId?: string | undefined;
  studentPublicId?: string | undefined;
}): Promise<EffectiveResolution> {
  const params = new URLSearchParams({ resourceType: input.resourceType, resourceRef: input.resourceRef });
  if (input.classId) params.set("classId", input.classId);
  if (input.studentPublicId) params.set("studentPublicId", input.studentPublicId);
  const envelope = await request<Envelope<EffectiveResolution>>(`/learning-path/effective?${params.toString()}`);
  return envelope.data;
}

/** `GET /classes/{classId}/learning-path/preview` (02_41 §32-34, "Effective Class Preview"). */
export async function getClassLearningPathPreview(classId: string): Promise<{ classId: string; nodes: EffectiveResolution[] }> {
  const envelope = await request<Envelope<{ classId: string; nodes: EffectiveResolution[] }>>(
    `/classes/${encodeURIComponent(classId)}/learning-path/preview`,
  );
  return envelope.data;
}

/** `GET /students/{studentPublicId}/learning-path/preview` (02_41 §32-34, "Che cosa vedrà questo studente?"). */
export async function getStudentLearningPathPreview(
  studentPublicId: string,
): Promise<{ studentPublicId: string; nodes: EffectiveResolution[] }> {
  const envelope = await request<Envelope<{ studentPublicId: string; nodes: EffectiveResolution[] }>>(
    `/students/${encodeURIComponent(studentPublicId)}/learning-path/preview`,
  );
  return envelope.data;
}

/** `POST /learning-path-alternatives` (02_41 §27/§34). */
export async function createLearningPathAlternative(input: {
  originalResourceType: LearningPathResourceType;
  originalResourceRef: string;
  alternativeContentRef: string;
  csrfToken: string;
}): Promise<LearningPathAlternative> {
  const envelope = await request<Envelope<LearningPathAlternative>>("/learning-path-alternatives", {
    method: "POST",
    body: {
      originalResourceType: input.originalResourceType,
      originalResourceRef: input.originalResourceRef,
      alternativeContentRef: input.alternativeContentRef,
    },
    csrfToken: input.csrfToken,
    idempotencyKey: generateIdempotencyKey(),
  });
  return envelope.data;
}
