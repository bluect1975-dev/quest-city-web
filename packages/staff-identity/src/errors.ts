/**
 * ErrorEnvelope (02_26 v1.8 §31.8, 02_35 §13): all 8 new staff error codes
 * are `domain: PLATFORM` — no new error domain is introduced. Same shape
 * as `@quest-city-web/attempts`' `ErrorEnvelope` (not imported, to keep
 * this package's public surface self-contained — the shape is a stable,
 * documented contract, not a class hierarchy worth coupling across
 * packages for).
 */
export type ErrorDomain = "PLATFORM" | "CONTENT_RUNTIME" | "CROSS_RUNTIME";

export interface ErrorEnvelope {
  domain: ErrorDomain;
  code: string;
  httpStatus: number;
  message: string;
  correlationId: string;
  retryable: boolean;
  safeDetails?: Record<string, unknown>;
}

/**
 * The 8 new staff error codes (02_35 §13), plus 4 generic PLATFORM-domain
 * codes this package's own operations raise (02_26 §8.2 ETAG_MISMATCH;
 * fixed-window rate limiting on login; malformed request bodies; a
 * same-key-different-payload idempotency reuse) — declared locally the
 * same way `@quest-city-web/identity`'s `IdentityError` and
 * `@quest-city-web/attempts`' `CrossRuntimeError` each declare their own
 * generic codes rather than importing a shared literal union.
 */
export const STAFF_ERROR_CODES = [
  "STAFF_AUTH_REQUIRED",
  "STAFF_FORBIDDEN",
  "CLASS_ACCESS_DENIED",
  "REVIEW_ITEM_NOT_FOUND",
  "FEEDBACK_NOT_PUBLISHABLE",
  "FEEDBACK_ALREADY_REVOKED",
  "STAFF_ACCOUNT_LOCKED",
  "RECOVERY_ASSIGNMENT_SOURCE_NOT_PUBLISHED",
  "VALIDATION_ERROR",
  "ETAG_MISMATCH",
  "RATE_LIMITED",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
  // School Pilot Readiness Tranche A (02_38 §10): a suspended tenant's
  // staff cannot authenticate or keep using an existing session.
  "TENANT_SUSPENDED",
  // School Pilot Readiness Tranche B (02_35 v1.2 §11bis.13, 02_26 v1.11
  // §33.6, contracts/quest-city-platform-openapi-v1_9.yaml) — 17 new
  // codes, all domain PLATFORM, same ErrorEnvelope shape.
  "INVITATION_ALREADY_PENDING",
  "INVITATION_NOT_FOUND",
  "INVITATION_EXPIRED",
  "INVITATION_ALREADY_CONSUMED",
  "TEACHER_ACCOUNT_SUSPENDED",
  "MEMBERSHIP_ALREADY_ACTIVE",
  "MEMBERSHIP_SUSPENDED_USE_REACTIVATE",
  "MEMBERSHIP_NOT_FOUND",
  "MEMBERSHIP_STATUS_UNCHANGED",
  "LAST_SCHOOL_ADMIN_PROTECTED",
  "CLASS_ALREADY_ARCHIVED",
  "TEACHER_MEMBERSHIP_NOT_ACTIVE",
  "TEACHER_ALREADY_ASSIGNED",
  "STUDENT_NOT_FOUND",
  "STUDENT_ALREADY_ENROLLED",
  "ENROLLMENT_NOT_ACTIVE",
  "ASSIGNMENT_CONTENT_NOT_PUBLISHED",
] as const;

export type StaffErrorCode = (typeof STAFF_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<StaffErrorCode, number> = {
  STAFF_AUTH_REQUIRED: 401,
  STAFF_FORBIDDEN: 403,
  CLASS_ACCESS_DENIED: 404,
  REVIEW_ITEM_NOT_FOUND: 404,
  FEEDBACK_NOT_PUBLISHABLE: 409,
  FEEDBACK_ALREADY_REVOKED: 409,
  STAFF_ACCOUNT_LOCKED: 423,
  RECOVERY_ASSIGNMENT_SOURCE_NOT_PUBLISHED: 409,
  VALIDATION_ERROR: 400,
  ETAG_MISMATCH: 412,
  RATE_LIMITED: 429,
  TENANT_SUSPENDED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  INVITATION_ALREADY_PENDING: 409,
  INVITATION_NOT_FOUND: 404,
  INVITATION_EXPIRED: 409,
  INVITATION_ALREADY_CONSUMED: 409,
  TEACHER_ACCOUNT_SUSPENDED: 409,
  MEMBERSHIP_ALREADY_ACTIVE: 409,
  MEMBERSHIP_SUSPENDED_USE_REACTIVATE: 409,
  MEMBERSHIP_NOT_FOUND: 404,
  MEMBERSHIP_STATUS_UNCHANGED: 409,
  LAST_SCHOOL_ADMIN_PROTECTED: 409,
  CLASS_ALREADY_ARCHIVED: 409,
  TEACHER_MEMBERSHIP_NOT_ACTIVE: 409,
  TEACHER_ALREADY_ASSIGNED: 409,
  STUDENT_NOT_FOUND: 404,
  STUDENT_ALREADY_ENROLLED: 409,
  ENROLLMENT_NOT_ACTIVE: 409,
  ASSIGNMENT_CONTENT_NOT_PUBLISHED: 409,
};

export class StaffIdentityError extends Error {
  readonly domain: ErrorDomain = "PLATFORM";
  readonly code: StaffErrorCode;
  readonly httpStatus: number;
  readonly retryAfterSeconds: number | undefined;
  readonly safeDetails: Record<string, unknown> | undefined;

  constructor(
    code: StaffErrorCode,
    message?: string,
    options?: { retryAfterSeconds?: number; safeDetails?: Record<string, unknown> },
  ) {
    super(message ?? code);
    this.name = "StaffIdentityError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.safeDetails = options?.safeDetails;
  }

  toEnvelope(correlationId: string): ErrorEnvelope {
    return {
      domain: this.domain,
      code: this.code,
      httpStatus: this.httpStatus,
      message: this.message,
      correlationId,
      retryable: this.code === "RATE_LIMITED" || this.code === "IDEMPOTENCY_IN_PROGRESS",
      ...(this.safeDetails ? { safeDetails: this.safeDetails } : {}),
    };
  }
}
