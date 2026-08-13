/**
 * ErrorEnvelope (02_26 §18.7/§31.8 pattern, domain `PLATFORM` reused --
 * Tranche A introduces no new error domain, consistent with every prior
 * Web-M3A/M3B-style extension). Declared locally rather than imported
 * from `@quest-city-web/staff-identity`, mirroring how that package
 * itself declares its own codes rather than importing
 * `@quest-city-web/identity`'s or `@quest-city-web/attempts`' -- a
 * stable, documented shape is the contract, not a shared class
 * hierarchy across packages.
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
 * Platform Admin error codes for Tranche A. `PLATFORM_AUTH_REQUIRED`/
 * `PLATFORM_FORBIDDEN`/`PLATFORM_ACCOUNT_LOCKED` mirror the staff-auth
 * precedent (`STAFF_AUTH_REQUIRED`/`STAFF_FORBIDDEN`/
 * `STAFF_ACCOUNT_LOCKED`, 02_35 §13) at platform scope.
 * `CAPABILITY_DENIED` is distinct from `PLATFORM_FORBIDDEN`: the actor is
 * authenticated as a platform admin but lacks the specific capability
 * the operation requires (02_27 §5.3 capability-first authorization) --
 * a coined code, since no prior PLATFORM-domain error models a
 * capability-level (as opposed to identity-level) authorization failure.
 * `IDEMPOTENCY_CONFLICT`/`IDEMPOTENCY_IN_PROGRESS` (02_26 v1.10 §32.4,
 * OpenAPI v1.8) cover `POST /platform/tenants`'s `Idempotency-Key`
 * contract: same key + different payload, and same key + request still
 * in flight or too-soon-to-retry after a retryable failure, respectively
 * -- kept as two distinct codes for this scope specifically because the
 * canonical contract names them separately, unlike the single
 * `IDEMPOTENCY_CONFLICT` some pre-existing staff-identity scopes collapse
 * both cases into.
 */
export const PLATFORM_ADMIN_ERROR_CODES = [
  "PLATFORM_AUTH_REQUIRED",
  "PLATFORM_FORBIDDEN",
  "PLATFORM_ACCOUNT_LOCKED",
  "CAPABILITY_DENIED",
  "TENANT_NOT_FOUND",
  "TENANT_SUSPENDED",
  "TENANT_STATUS_UNCHANGED",
  "SCHOOL_ADMIN_ALREADY_ACTIVE",
  "SCHOOL_ADMIN_IDENTITY_SUSPENDED",
  "INDEPENDENT_EDUCATOR_NOT_FOUND",
  "INDEPENDENT_EDUCATOR_ALREADY_ACTIVE",
  "INDEPENDENT_EDUCATOR_IDENTITY_SUSPENDED",
  "INDEPENDENT_EDUCATOR_STATUS_UNCHANGED",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
  // School Pilot Readiness Tranche D (02_38 v1.4 §9-22, 02_26 v1.14 §36) --
  // codes raised by the PLATFORM_ADMIN-only convergence endpoints (preview
  // with integrated identity verification, execute, rollback-review).
  "CONVERGENCE_REQUEST_NOT_FOUND",
  "CONVERGENCE_IDENTITY_MISMATCH",
  "TENANT_SUSPENDED_FOR_CONVERGENCE",
  "CONVERGENCE_CONFLICT_UNRESOLVED",
  "CONVERGENCE_ALREADY_TERMINAL",
  "CONVERGENCE_ACTIVE_ATTEMPTS_PENDING",
  "CONVERGENCE_EXECUTION_IN_PROGRESS",
  "CONVERGENCE_REQUEST_INVALID_TRANSITION",
] as const;

export type PlatformAdminErrorCode = (typeof PLATFORM_ADMIN_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<PlatformAdminErrorCode, number> = {
  PLATFORM_AUTH_REQUIRED: 401,
  PLATFORM_FORBIDDEN: 403,
  PLATFORM_ACCOUNT_LOCKED: 423,
  CAPABILITY_DENIED: 403,
  TENANT_NOT_FOUND: 404,
  TENANT_SUSPENDED: 409,
  TENANT_STATUS_UNCHANGED: 409,
  SCHOOL_ADMIN_ALREADY_ACTIVE: 409,
  SCHOOL_ADMIN_IDENTITY_SUSPENDED: 409,
  INDEPENDENT_EDUCATOR_NOT_FOUND: 404,
  INDEPENDENT_EDUCATOR_ALREADY_ACTIVE: 409,
  INDEPENDENT_EDUCATOR_IDENTITY_SUSPENDED: 409,
  INDEPENDENT_EDUCATOR_STATUS_UNCHANGED: 409,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  CONVERGENCE_REQUEST_NOT_FOUND: 404,
  CONVERGENCE_IDENTITY_MISMATCH: 409,
  TENANT_SUSPENDED_FOR_CONVERGENCE: 409,
  CONVERGENCE_CONFLICT_UNRESOLVED: 409,
  CONVERGENCE_ALREADY_TERMINAL: 409,
  CONVERGENCE_ACTIVE_ATTEMPTS_PENDING: 409,
  CONVERGENCE_EXECUTION_IN_PROGRESS: 409,
  CONVERGENCE_REQUEST_INVALID_TRANSITION: 409,
};

export class PlatformAdminError extends Error {
  readonly domain: ErrorDomain = "PLATFORM";
  readonly code: PlatformAdminErrorCode;
  readonly httpStatus: number;
  readonly retryAfterSeconds: number | undefined;
  readonly safeDetails: Record<string, unknown> | undefined;

  constructor(
    code: PlatformAdminErrorCode,
    message?: string,
    options?: { retryAfterSeconds?: number; safeDetails?: Record<string, unknown> },
  ) {
    super(message ?? code);
    this.name = "PlatformAdminError";
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
      retryable:
        this.code === "RATE_LIMITED" ||
        this.code === "IDEMPOTENCY_IN_PROGRESS" ||
        this.code === "CONVERGENCE_EXECUTION_IN_PROGRESS",
      ...(this.safeDetails ? { safeDetails: this.safeDetails } : {}),
    };
  }
}
