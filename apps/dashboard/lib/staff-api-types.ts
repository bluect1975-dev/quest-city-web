/** TypeScript mirror of the WEB-M3B OpenAPI v1.6 schemas (contracts/quest-city-platform-openapi-v1_6.yaml). */

export type StaffRole = "TEACHER" | "SCHOOL_ADMIN";

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
