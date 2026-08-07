export { StaffIdentityError, STAFF_ERROR_CODES, type StaffErrorCode, type ErrorDomain, type ErrorEnvelope } from "./errors";
export { DEFAULT_STAFF_SESSION_SECURITY_CONFIG, type StaffSessionSecurityConfig } from "./config";

export {
  hashPassword,
  verifyPassword,
  needsRehash,
  formatPasswordHash,
  parsePasswordHash,
  PASSWORD_SCRYPT_PARAMS,
  PasswordHashFormatError,
} from "./crypto/password";

export { StaffAccountRepository, type StaffAccount, type StaffAccountStatus } from "./repository/staff-account-repository";
export {
  StaffTenantMembershipRepository,
  type StaffTenantMembership,
  type StaffRole,
  type StaffTenantMembershipStatus,
} from "./repository/staff-tenant-membership-repository";
export {
  StaffClassAssignmentRepository,
  type StaffClassAssignment,
} from "./repository/staff-class-assignment-repository";
export {
  StaffSessionRepository,
  type StaffSession,
  type StaffSessionRevokedReason,
} from "./repository/staff-session-repository";
export {
  ReviewQueueItemRepository,
  type ReviewQueueItem,
  type ReviewQueueItemReason,
  type ReviewQueueItemPriority,
  type ReviewQueueItemStatus,
} from "./repository/review-queue-item-repository";
export {
  TeacherFeedbackRepository,
  type TeacherFeedback,
  type TeacherFeedbackPublicationStatus,
  type TeacherFeedbackDeliveryStatus,
} from "./repository/teacher-feedback-repository";

export {
  StaffAuthService,
  type StaffSessionStartResult,
  type StaffSessionRefreshResult,
  type StaffContext,
  type StaffInternalIdentity,
} from "./services/staff-auth-service";
export { ReviewService } from "./services/review-service";
export { FeedbackService } from "./services/feedback-service";
export { RecoveryAssignmentService, type RecoveryAssignmentResult } from "./services/recovery-assignment-service";
export { assertClassInScope, isClassInScope } from "./services/authorization";
