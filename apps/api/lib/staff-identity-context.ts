import { Pool } from "pg";
import {
  StaffAuthService,
  ReviewService,
  FeedbackService,
  RecoveryAssignmentService,
  StaffInvitationService,
  StaffMembershipService,
  SchoolClassManagementService,
  RosterManagementService,
  GeneralAssignmentService,
  type StaffSessionSecurityConfig,
  StaffAccountRepository,
} from "@quest-city-web/staff-identity";
import { AuditRepository, SchoolClassRepository, SchoolEnrollmentRepository, StudentProfileRepository } from "@quest-city-web/identity";
import {
  ConvergenceRequestService,
  ConvergenceApprovalService,
  ContentPromotionService,
  TenantContextService,
} from "@quest-city-web/convergence";
import {
  SupportAssignmentService,
  SupportEventService,
  ObservationService,
  FacilitationService,
  FacilitationProposalService,
  type LearningPathAdjustmentAcceptHook,
} from "@quest-city-web/student-support";
import { LearningPathPolicyService, LearningPathAlternativeService, applyLearningPathAdjustmentAcceptance } from "@quest-city-web/learning-path-control";
import { loadEnv } from "./env";

/**
 * Separate connection pool from `lib/db.ts`, `lib/identity-context.ts` and
 * `lib/attempts-context.ts` — staff request traffic gets its own pool,
 * same separation rationale as every prior milestone's own pool.
 */
let pool: Pool | undefined;

function getStaffIdentityPool(): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: true } : undefined,
      max: env.dbPoolStaffIdentityMax,
      idleTimeoutMillis: env.dbPoolStaffIdentityIdleTimeoutMs,
      connectionTimeoutMillis: env.dbPoolStaffIdentityConnectionTimeoutMs,
    });
  }
  return pool;
}

function getStaffSessionSecurityConfig(): StaffSessionSecurityConfig {
  const env = loadEnv();
  return {
    absoluteTtlSeconds: env.staffSessionAbsoluteTtlSeconds,
    inactivityTtlSeconds: env.staffSessionInactivityTtlSeconds,
    maxFailedLoginAttempts: 5,
    lockoutDurationSeconds: 15 * 60,
  };
}

export function getStaffAuthService(): StaffAuthService {
  return new StaffAuthService(getStaffIdentityPool(), getStaffSessionSecurityConfig());
}

export function getReviewService(): ReviewService {
  return new ReviewService(getStaffIdentityPool());
}

export function getFeedbackService(): FeedbackService {
  return new FeedbackService(getStaffIdentityPool());
}

export function getRecoveryAssignmentService(): RecoveryAssignmentService {
  return new RecoveryAssignmentService(getStaffIdentityPool());
}

export function getStaffInvitationService(): StaffInvitationService {
  return new StaffInvitationService(getStaffIdentityPool());
}

export function getStaffMembershipService(): StaffMembershipService {
  return new StaffMembershipService(getStaffIdentityPool());
}

export function getSchoolClassManagementService(): SchoolClassManagementService {
  return new SchoolClassManagementService(getStaffIdentityPool(), loadEnv().classCodeHashPepper);
}

export function getRosterManagementService(): RosterManagementService {
  return new RosterManagementService(getStaffIdentityPool());
}

export function getGeneralAssignmentService(): GeneralAssignmentService {
  return new GeneralAssignmentService(getStaffIdentityPool());
}

/** Used by `GET /staff/members` to project `email` alongside each `StaffTenantMembershipRepository` row (StaffMembershipService.list's emailByAccountId callback). */
export function getStaffAccountRepository(): StaffAccountRepository {
  return new StaffAccountRepository(getStaffIdentityPool());
}

/** Read-only class/roster composition (02_35 §5) reuses WEB-M1's own repositories — never a copy of school_class/student_profile/school_enrollment. */
export function getSchoolClassRepository(): SchoolClassRepository {
  return new SchoolClassRepository(getStaffIdentityPool());
}

export function getSchoolEnrollmentRepository(): SchoolEnrollmentRepository {
  return new SchoolEnrollmentRepository(getStaffIdentityPool());
}

export function getStudentProfileRepository(): StudentProfileRepository {
  return new StudentProfileRepository(getStaffIdentityPool());
}

/** For routes that audit a sensitive read directly (e.g. attempt review detail, AGENTS.md §4.22 rule 10) without going through a staff-identity service. */
export function getStaffAuditRepository(): AuditRepository {
  return new AuditRepository(getStaffIdentityPool());
}

/** Account/Tenant Convergence (02_38, 02_35 v1.5 §11quater) — staff-session-authed surfaces, same pool-reuse convention as every other factory in this file. */
export function getConvergenceRequestService(): ConvergenceRequestService {
  return new ConvergenceRequestService(getStaffIdentityPool());
}

export function getConvergenceApprovalService(): ConvergenceApprovalService {
  return new ConvergenceApprovalService(getStaffIdentityPool());
}

export function getContentPromotionService(): ContentPromotionService {
  return new ContentPromotionService(getStaffIdentityPool());
}

export function getTenantContextService(): TenantContextService {
  return new TenantContextService(getStaffIdentityPool());
}

/** Student Support Roles (02_25 v1.12 §6.16, 02_35 v1.7 §11quinquies/§11sexies, 02_39 v1.2, 02_26 v1.17 §37/§37bis/§38) — same pool-reuse convention as every other factory in this file. */
export function getSupportAssignmentService(): SupportAssignmentService {
  return new SupportAssignmentService(getStaffIdentityPool());
}

export function getSupportEventService(): SupportEventService {
  return new SupportEventService(getStaffIdentityPool());
}

export function getObservationService(): ObservationService {
  return new ObservationService(getStaffIdentityPool());
}

export function getFacilitationService(): FacilitationService {
  return new FacilitationService(getStaffIdentityPool());
}

/**
 * GLPC (02_41 §23): the hook that lets `FacilitationProposalService`'s
 * transactional review() atomically write the resulting `learning_path_policy`
 * row on ACCEPT of a LEARNING_PATH_ADJUSTMENT proposal, without
 * `@quest-city-web/student-support` ever importing
 * `@quest-city-web/learning-path-control` (which already depends on
 * student-support for `resolveStudentSupportScope` -- the reverse import
 * would be circular). Wired here, the one place both packages are already
 * imported together.
 */
const onAcceptLearningPathAdjustment: LearningPathAdjustmentAcceptHook = async (client, proposal, reviewerIdentity) => {
  if (!proposal.targetResourceType || !proposal.targetResourceRef || !proposal.targetRequestedState) {
    throw new Error("LEARNING_PATH_ADJUSTMENT proposal is missing its targetLearningPath fields (facilitation_proposal_target_learning_path_ck should have prevented this).");
  }
  await applyLearningPathAdjustmentAcceptance(client, {
    tenantId: proposal.tenantId,
    studentProfileId: proposal.studentProfileId,
    resourceType: proposal.targetResourceType,
    resourceRef: proposal.targetResourceRef,
    requestedState: proposal.targetRequestedState,
    requestedAlternativeContentRef: proposal.targetRequestedAlternativeContentRef,
    reviewerStaffAccountId: reviewerIdentity.staffAccountId,
    sourceProposalPublicId: proposal.publicId,
  });
};

export function getFacilitationProposalService(): FacilitationProposalService {
  return new FacilitationProposalService(getStaffIdentityPool(), onAcceptLearningPathAdjustment);
}

/** Granular Learning Path Control (02_41 v1.1, contracts/quest-city-platform-openapi-v1_15.yaml) — same pool-reuse convention as every other factory in this file. */
export function getLearningPathPolicyService(): LearningPathPolicyService {
  return new LearningPathPolicyService(getStaffIdentityPool());
}

export function getLearningPathAlternativeService(): LearningPathAlternativeService {
  return new LearningPathAlternativeService(getStaffIdentityPool());
}
