export {
  PlatformAdminError,
  PLATFORM_ADMIN_ERROR_CODES,
  type PlatformAdminErrorCode,
  type ErrorDomain,
  type ErrorEnvelope,
} from "./errors";
export {
  DEFAULT_PLATFORM_ADMIN_SESSION_SECURITY_CONFIG,
  type PlatformAdminSessionSecurityConfig,
} from "./config";

export {
  PlatformAdminGrantRepository,
  CAPABILITIES,
  type PlatformAdminGrant,
  type PlatformAdminGrantStatus,
  type PlatformAdminGrantedByActorType,
  type Capability,
} from "./repository/platform-admin-grant-repository";
export {
  PlatformAdminSessionRepository,
  type PlatformAdminSession,
  type PlatformAdminSessionRevokedReason,
} from "./repository/platform-admin-session-repository";

export {
  PlatformAuthService,
  type PlatformAdminSessionStartResult,
  type PlatformAdminSessionRefreshResult,
  type PlatformAdminIdentity,
} from "./services/platform-auth-service";
export { assertCapability } from "./services/authorization";
export { TenantProvisioningService, type TenantProvisioningResult } from "./services/tenant-provisioning-service";
export { TenantStatusService } from "./services/tenant-status-service";
export {
  SchoolAdminActivationService,
  type SchoolAdminActivationResult,
} from "./services/school-admin-activation-service";
export {
  IndependentEducatorActivationService,
  type IndependentEducatorSummary,
  type IndependentEducatorActivationResult,
} from "./services/independent-educator-activation-service";
export {
  IndependentEducatorStatusService,
  type IndependentEducatorStatusResult,
} from "./services/independent-educator-status-service";
