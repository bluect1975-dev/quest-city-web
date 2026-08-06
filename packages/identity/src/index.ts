export { IdentityError, IDENTITY_ERROR_CODES, type IdentityErrorCode } from "./errors";
export { normalizeAlias, normalizeClassCode } from "./normalize";
export { DEFAULT_SESSION_SECURITY_CONFIG, type SessionSecurityConfig } from "./config";

export {
  hashPin,
  verifyPin,
  needsRehash,
  formatPinHash,
  parsePinHash,
  PIN_SCRYPT_PARAMS,
  PIN_SCRYPT_SALT_LENGTH,
  PIN_SCRYPT_MAXMEM,
  PinHashFormatError,
  type ScryptParams,
  type ParsedPinHash,
} from "./crypto/pin";
export {
  generateToken,
  hashToken,
  verifyTokenHash,
  SESSION_TOKEN_BYTES,
  CSRF_TOKEN_BYTES,
} from "./crypto/token";
export { generateClassCode, generatePin, CLASS_CODE_LENGTH, GENERATED_PIN_LENGTH } from "./crypto/class-code";
export {
  decodeClassCodePepper,
  hashClassCode,
  compareClassCodeHash,
  CLASS_CODE_PEPPER_MIN_BYTES,
  ClassCodePepperError,
} from "./crypto/class-code";

export { checkFixedWindow, RATE_LIMITS, type RateLimitDimension, type RateLimitResult } from "./rate-limit/fixed-window";

export { TenantRepository, type Tenant, type TenantType, type TenantStatus } from "./repository/tenant-repository";
export { SchoolClassRepository, type SchoolClass, type SchoolClassStatus } from "./repository/school-class-repository";
export {
  StudentProfileRepository,
  type StudentProfile,
  type StudentProfileStatus,
} from "./repository/student-profile-repository";
export {
  ClassAccessCodeRepository,
  type ClassAccessCode,
  type ClassAccessCodeStatus,
} from "./repository/class-access-code-repository";
export {
  SchoolEnrollmentRepository,
  type SchoolEnrollment,
  type SchoolEnrollmentStatus,
} from "./repository/school-enrollment-repository";
export {
  StudentSessionRepository,
  type StudentSession,
  type SessionRevokedReason,
} from "./repository/student-session-repository";
export { AuditRepository, type AuditEventInput, type AuditActorType, type AuditResult } from "./repository/audit-repository";

export { ClassCodeService, type ClassCodeResolution } from "./services/class-code-service";
export {
  SessionService,
  type SessionStartResult,
  type SessionRefreshResult,
  type StudentContext,
} from "./services/session-service";
