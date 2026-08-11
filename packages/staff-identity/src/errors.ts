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
  // School Pilot Readiness Tranche A (02_38 §10): a suspended tenant's
  // staff cannot authenticate or keep using an existing session.
  "TENANT_SUSPENDED",
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
      retryable: this.code === "RATE_LIMITED",
      ...(this.safeDetails ? { safeDetails: this.safeDetails } : {}),
    };
  }
}
