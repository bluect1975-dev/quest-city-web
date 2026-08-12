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
      max: 10,
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
