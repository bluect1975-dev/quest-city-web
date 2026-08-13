export type Capability =
  | "tenant.create"
  | "tenant.read"
  | "tenant.suspend"
  | "school_admin.activate"
  | "audit.read.global"
  | "independent_educator.activate"
  | "independent_educator.read"
  | "independent_educator.status.manage"
  | "convergence.read"
  | "convergence.preview"
  | "convergence.execute"
  | "convergence.rollback.review";

export interface PlatformContext {
  staffAccountId: string;
  capabilities: Capability[];
}

export interface TenantSummary {
  id: string;
  publicId: string;
  type: "SCHOOL" | "INDEPENDENT_EDUCATOR";
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  name: string;
  createdAt: string;
}

export interface IndependentEducatorSummary {
  tenantId: string;
  tenantPublicId: string;
  tenantStatus: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  tenantName: string;
  staffAccountId: string;
  email: string;
  membershipStatus: "ACTIVE" | "SUSPENDED";
  createdAt: string;
}

export interface IndependentEducatorActivationResponse {
  tenantId: string;
  tenantPublicId: string;
  staffAccountId: string;
  email: string;
  temporaryPassword: string | null;
  identityReused: boolean;
}

export interface IndependentEducatorStatusResponse {
  tenantId: string;
  tenantPublicId: string;
  tenantStatus: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  membershipStatus: "ACTIVE" | "SUSPENDED";
}

export interface SchoolAdminActivationResponse {
  staffAccountId: string;
  email: string;
  temporaryPassword: string | null;
  identityReused: boolean;
  reactivated: boolean;
}

export interface AuditEventSummary {
  id: string;
  tenantId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: string;
  createdAt: string;
}

/**
 * Account/Tenant Convergence, Platform Admin surface
 * (contracts/quest-city-platform-openapi-v1_12.yaml -- 02_38 v1.4 §9-10,
 * §10.2bis). Kept as its own copy of the shape also defined in
 * `staff-api-types.ts` rather than a shared import -- same domain-isolation
 * discipline as `useAsyncPlatform` (this file never couples to the staff
 * surface).
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
}

export type ClassMigrationDecision = "TRANSFER" | "RETAIN";

export interface ClassConsidered {
  classId: string;
  suggestedDecision: ClassMigrationDecision;
  studentsInClass?: number;
  hasNonSchoolStudents?: boolean;
}

export interface MigrationPlanConflict {
  code: string;
  blocking: boolean;
  description?: string;
}

/** `MigrationPlanResponse.data` (`POST /convergence-requests/{id}/preview`). */
export interface MigrationPlan {
  id: string;
  convergenceRequestId: string;
  fingerprint: string;
  status: "DRAFT" | "CONFIRMED" | "STALE";
  classesConsidered: ClassConsidered[];
  studentsAffected: Array<{ studentPublicId: string; conflict: "ALREADY_ENROLLED_IN_TARGET" | "DUAL_MEMBERSHIP" | null }>;
  conflicts: MigrationPlanConflict[];
  warnings: string[];
  blockers: string[];
  generatedAt: string;
}

export type MigrationExecutionStatus = "COMPLETED" | "FAILED" | "ROLLBACK_REVIEW_REQUIRED";

/** `MigrationExecutionResponse.data` (`POST /convergence-requests/{id}/execute`). Field is `executionStatus`, not `status` -- see quest-city-platform-openapi-v1_12.yaml. */
export interface MigrationExecution {
  id: string;
  migrationPlanId: string;
  convergenceRequestId: string;
  convergenceRunId: string;
  executionStatus: MigrationExecutionStatus;
  unitsTotal: number;
  unitsMigrated: number;
  unitsFailed: number;
  failureReason: string | null;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
}

export type RollbackReviewDecision = "ACCEPT_PARTIAL" | "RETRY_REMAINING";
