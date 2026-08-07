/**
 * Canonical public error codes for the WEB-M1 student access API (02_26
 * §30.5). CLASS_CODE_EXPIRED and ALIAS_CONFLICT are deliberately absent —
 * retired from the public contract in favour of the uniform
 * anti-enumeration codes below.
 */
export const IDENTITY_ERROR_CODES = [
  "CLASS_CODE_INVALID",
  "ACCESS_CREDENTIALS_INVALID",
  "ENROLLMENT_SUSPENDED",
  "SESSION_EXPIRED",
  "TENANT_ACCESS_DENIED",
  "CSRF_INVALID",
  "RATE_LIMITED",
  "VALIDATION_ERROR",
] as const;

export type IdentityErrorCode = (typeof IDENTITY_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<IdentityErrorCode, number> = {
  CLASS_CODE_INVALID: 404,
  ACCESS_CREDENTIALS_INVALID: 401,
  ENROLLMENT_SUSPENDED: 403,
  SESSION_EXPIRED: 401,
  TENANT_ACCESS_DENIED: 403,
  CSRF_INVALID: 403,
  RATE_LIMITED: 429,
  VALIDATION_ERROR: 400,
};

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  readonly httpStatus: number;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: IdentityErrorCode, message?: string, options?: { retryAfterSeconds?: number }) {
    super(message ?? code);
    this.name = "IdentityError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}
