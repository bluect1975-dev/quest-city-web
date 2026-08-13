/** TypeScript mirror of the WEB-M3B OpenAPI v1.6 schemas (contracts/quest-city-platform-openapi-v1_6.yaml). */

export type StaffRole = "TEACHER" | "SCHOOL_ADMIN" | "INDEPENDENT_EDUCATOR";

export interface StaffContext {
  staffAccountId: string;
  tenantId: string;
  role: StaffRole;
  classScope: string[] | null;
}

export interface ClassSummary {
  classId: string;
  name: string;
}

export interface StudentRosterEntry {
  studentProfileId: string;
  accessAlias: string;
  enrollmentStatus: string;
}

export interface ProgressAggregate {
  totalAttempts: number;
  byAttemptState: Record<string, number>;
  byCompletionStatus: Record<string, number>;
}

export interface StudentProgressSummary {
  studentPublicId: string;
  aggregate: ProgressAggregate;
}

export type AttemptRuntimeChannel = "WEB" | "ROBLOX" | "UNKNOWN_LEGACY";
export type CompletionStatus = "ACCEPTED_NOT_CONSOLIDATED" | "RECONCILIATION_REQUIRED" | "CONSOLIDATED";
export type AttemptState = "CREATED" | "IN_PROGRESS" | "COMPLETION_SUBMITTED" | "COMPLETED" | "ABANDONED" | "EXPIRED";

export interface AttemptHistoryEntry {
  attemptId: string;
  attemptState: AttemptState;
  completionStatus: CompletionStatus | null;
  runtimeChannel: AttemptRuntimeChannel;
  startedAt: string;
  completedAt: string | null;
}

export type ReviewQueueItemReason =
  | "INCORRECT_ATTEMPT"
  | "OPEN_ANSWER"
  | "PRIORITY_MISCONCEPTION"
  | "HELP_REQUESTED"
  | "MANUALLY_SELECTED";
export type ReviewQueueItemPriority = "LOW" | "MEDIUM" | "HIGH";
export type ReviewQueueItemStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";

export interface ReviewQueueItem {
  id: string;
  tenantId: string;
  classId: string;
  studentProfileId: string;
  learningAttemptId: string;
  reason: ReviewQueueItemReason;
  priority: ReviewQueueItemPriority;
  status: ReviewQueueItemStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewerStaffId: string | null;
  version: number;
}

export interface AttemptReviewDetail {
  attemptId: string;
  item?: Record<string, unknown>;
  canonicalAnswer?: Record<string, unknown>;
  studentAnswer: Record<string, unknown>;
  semanticActions?: Array<Record<string, unknown>>;
  hints?: Array<Record<string, unknown>>;
  validatorOutcome?: Record<string, unknown> | null;
  proposedAiFeedback: Record<string, unknown> | null;
  previousAttempts?: Array<Record<string, unknown>>;
  relatedCompetencies?: Array<Record<string, unknown>>;
  runtimeChannel: AttemptRuntimeChannel;
  reconciliationStatus: CompletionStatus | null;
}

export type TeacherFeedbackPublicationStatus = "DRAFT" | "PUBLISHED" | "REVOKED";
export type TeacherFeedbackDeliveryStatus = "NOT_APPLICABLE" | "PENDING" | "DELIVERED" | "READ" | "FAILED";

export interface TeacherFeedback {
  id: string;
  tenantId: string;
  classId: string;
  studentProfileId: string;
  learningAttemptId: string;
  authorStaffId: string;
  structuredFeedback: Record<string, unknown>;
  freeText: string | null;
  publicationStatus: TeacherFeedbackPublicationStatus;
  deliveryStatus: TeacherFeedbackDeliveryStatus;
  originReviewQueueItemId: string | null;
  recoveryAssignmentId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  revokedAt: string | null;
  version: number;
}

/** School Onboarding + Staff Membership (02_35 v1.2 §11bis, contracts/quest-city-platform-openapi-v1_9.yaml). */
export type StaffTenantMembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED";

export interface StaffMember {
  staffTenantMembershipId: string;
  staffAccountId: string;
  email: string;
  role: StaffRole;
  status: StaffTenantMembershipStatus;
  classScope: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffInvitationResult {
  invitationId: string;
  staffTenantMembershipId: string;
  email: string;
  role: "TEACHER";
  status: "INVITED";
  expiresAt: string;
  acceptanceToken: string;
  identityReused: boolean;
  createdAt: string;
}

export interface AcceptStaffInvitationResult {
  staffTenantMembershipId: string;
  status: "ACTIVE";
  email: string;
}

export type MembershipStatusAction = "SUSPEND" | "REACTIVATE" | "REVOKE";

export interface StaffMembershipStatusResult {
  staffTenantMembershipId: string;
  status: StaffTenantMembershipStatus;
  updatedAt: string;
}

export type SchoolClassStatus = "ACTIVE" | "ARCHIVED";

export interface SchoolClassDetail {
  classId: string;
  name: string;
  status: SchoolClassStatus;
  createdAt: string;
}

export interface TeacherClassAssignment {
  staffTenantMembershipId: string;
  classId: string;
  createdAt: string;
}

export type RosterMode = "NEW" | "EXISTING";

export interface RosterMember {
  studentProfileId: string;
  studentPublicId: string;
  classId: string;
  accessAlias: string;
  pin: string | undefined;
  status: string;
  createdAt: string;
}

export interface RemoveRosterMemberResult {
  studentProfileId: string;
  classId: string;
  status: "LEFT";
}

export interface GeneralAssignment {
  assignmentId: string;
  classId: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  originType: "STAFF_GENERAL";
  createdAt: string;
}

export interface RecoveryAssignment {
  assignmentId: string;
  originTeacherFeedbackId: string;
  studentProfileId: string;
  contentBundleId: string;
  allowedRuntimeChannels: Array<"WEB" | "ROBLOX">;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  createdByStaffId: string;
  createdAt: string;
}

/**
 * Account/Tenant Convergence (contracts/quest-city-platform-openapi-v1_12.yaml,
 * `ConvergenceRequestSummary`/`ConvergenceRequestResponse` -- 02_38 v1.4
 * §9-10/§10.2bis, 02_35 v1.5 §11quater). Eleven-value closed state machine;
 * COMPLETED/REJECTED/BLOCKED are terminal -- a new request row is created
 * to retry, never a resurrection of a terminal row.
 */
export type ConvergenceRequestStatus =
  | "REQUESTED"
  | "PREVIEW_READY"
  | "AWAITING_APPROVALS"
  | "APPROVED"
  | "READY_TO_EXECUTE"
  | "EXECUTING"
  | "COMPLETED"
  | "REJECTED"
  | "BLOCKED"
  | "FAILED"
  | "ROLLBACK_REVIEW_REQUIRED";

export interface ConvergenceRequest {
  id: string;
  sourceTenantId: string;
  targetTenantId: string;
  educatorStaffAccountId: string;
  status: ConvergenceRequestStatus;
  requestedByStaffAccountId: string;
  requestedAt: string;
  teacherConfirmedAt: string | null;
  schoolApprovedAt: string | null;
  platformIdentityVerifiedAt: string | null;
  currentMigrationPlanId: string | null;
  currentMigrationExecutionId: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  /** Only present on `GET /convergence-requests/{id}` (party-scoped detail read), never on the list endpoint. */
  migrationPlan?: MigrationPlan | null;
}

export interface ClassConsidered {
  classId: string;
  suggestedDecision: ClassMigrationDecision;
  studentsInClass: number;
  hasNonSchoolStudents: boolean;
}

export interface ClassDecisionEntry {
  classId: string;
  decision: ClassMigrationDecision;
}

export interface OwnershipDecisionEntry {
  resourceId: string;
  decision: OwnershipDecision;
}

/**
 * `MigrationPlanResponse.data` (contracts/quest-city-platform-openapi-v1_12.yaml).
 * Surfaced additively on `GET /convergence-requests/{id}` for the approving
 * party. `ownershipDecisionsPending` is part of the wire schema but is
 * never populated by `ConvergencePreviewService` in this tranche -- there
 * is no owned-content table yet (same disclosed gap as
 * `ContentPromotionService.promote` always returning CONTENT_NOT_FOUND) --
 * so it is intentionally not declared here; the approve UI renders no
 * ownership-decision controls until a real pending resource can exist.
 */
export interface MigrationPlan {
  id: string;
  convergenceRequestId: string;
  fingerprint: string;
  status: "DRAFT" | "CONFIRMED" | "STALE";
  classesConsidered: ClassConsidered[];
  classDecisions: ClassDecisionEntry[];
  ownershipDecisions: OwnershipDecisionEntry[];
  warnings: string[];
  blockers: string[];
  generatedAt: string;
}

/** Per-class decision, 02_38 v1.4 §12 options A (TRANSFER) and B (RETAIN) -- always explicit and audited per class, never a tenant-wide default. */
export type ClassMigrationDecision = "TRANSFER" | "RETAIN";

/** Per-resource decision, 02_38 v1.4 §14. Default in the absence of an explicit decision is RETAIN -- PROMOTE is never assumed. */
export type OwnershipDecision = "PROMOTE" | "RETAIN";

/** `GET /me/tenant-memberships` (02_35 v1.5 §11quater.5) -- self-read, no capability required. */
export interface TenantMembership {
  tenantId: string;
  tenantType: "SCHOOL" | "INDEPENDENT_EDUCATOR";
  tenantName?: string;
  role: StaffRole;
  membershipStatus: "ACTIVE";
}
