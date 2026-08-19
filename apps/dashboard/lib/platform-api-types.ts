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
  | "convergence.rollback.review"
  | "operations.dashboard.view"
  | "operations.infrastructure.view"
  | "operations.usage.view"
  | "operations.presence.view"
  | "operations.errors.view"
  | "operations.incidents.view"
  | "operations.incidents.manage"
  | "operations.alerting.view"
  | "operations.alerting.manage";

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

// -- Master Admin Operations Control Center (02_42 v1.1, contracts v1.17.0/v1.18.0) --

export type ServiceHealthState = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";
export type MetricSource = "APPLICATION" | "DATABASE" | "HOST" | "CONTAINER" | "REVERSE_PROXY" | "BACKUP" | "TLS" | "EXTERNAL_MONITOR";
export type OperationalIncidentSeverity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";
export type OperationalIncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "SUPPRESSED";
export type AlertConfigurationStatus = "CONFIGURED" | "NOT_CONFIGURED";
export type AlertDeliveryStatus = "PENDING" | "SENT" | "FAILED";

export interface OperationsOverview {
  platformStatus: ServiceHealthState;
  kpi: {
    schoolsTotal: number;
    schoolsActive: number;
    schoolsSuspended: number;
    independentEducatorsTotal: number;
    classesTotal: number;
    staffByRole: Array<{ role: string; activeMemberships: number; uniqueHumans: number }>;
    staffUniqueHumansTotal: number;
    studentsEnrolled: number;
    studentsOnlineNow: number;
    staffOnlineNow: number;
    activeLearningAttempts: number;
  };
  openIncidents: number;
  lastBackup: { status: string };
}

export interface ServiceHealthEntry {
  service: string;
  state: ServiceHealthState;
  latencyMs: number | null;
  checkedAt: string;
}

export interface OperationsServices {
  platformStatus: ServiceHealthState;
  services: ServiceHealthEntry[];
}

export interface MetricSample {
  source: MetricSource;
  metricKey: string;
  value: number;
  unit: string;
  sampledAt: string;
  status: "OK" | "WARNING" | "CRITICAL" | "UNKNOWN";
  threshold: number | null;
}

export interface OperationsPresence {
  concurrentStudents: number;
  concurrentStaff: number;
  concurrentTotal: number;
  tenantId: string | null;
  peak: Record<string, number | null>;
}

export interface OperationalIncidentSummary {
  id: string;
  publicId: string;
  type: string;
  severity: OperationalIncidentSeverity;
  source: MetricSource;
  service: string;
  summary: string;
  status: OperationalIncidentStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolutionType: string | null;
  tenantId: string | null;
  /** Tranche E2 (02_42 v1.2 §60, §63): true only for an incident retroactively recorded after an already-sent Level 1 direct Telegram notification -- never a real-time observation. */
  backfilled: boolean;
}

export interface OperationalIncidentEventSummary {
  id: string;
  eventType: string;
  detail: Record<string, unknown>;
  actorType: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface OperationalIncidentDetail {
  incident: OperationalIncidentSummary;
  events: OperationalIncidentEventSummary[];
}

export interface AlertConfiguration {
  status: AlertConfigurationStatus;
  enabled: boolean;
  severityThreshold: OperationalIncidentSeverity;
  cooldownSeconds: number;
  recipientMasked: string | null;
}

export interface AlertTestResult {
  deliveryStatus: AlertDeliveryStatus;
  sentAt: string;
  failureCategory: string | null;
}
