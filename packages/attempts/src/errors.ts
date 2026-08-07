/**
 * ErrorEnvelope (02_26 v1.6 §18.7): domain discriminant across three
 * non-overlapping families — never a flat global enum. PLATFORM/
 * VALIDATION-level codes live in @quest-city-web/contracts
 * (DOMAIN_ERROR_CODES); CONTENT_RUNTIME codes belong to 07_08 §18 (not
 * implemented by this package); CROSS_RUNTIME codes are this package's
 * responsibility (07_15_01 v1.1 §14, 02_26 v1.6 §18.8).
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
 * The 8 CROSS_RUNTIME error codes (02_26 v1.6 §18.8), exact emission
 * conditions fixed in 07_15_01 v1.1 §14 / §11-bis.7.
 */
export const CROSS_RUNTIME_ERROR_CODES = [
  "RUNTIME_CHANNEL_NOT_ALLOWED",
  "RUNTIME_CAPABILITY_MISMATCH",
  "PRESENTATION_ADAPTER_UNAVAILABLE",
  "CROSS_RUNTIME_ATTEMPT_CONFLICT",
  "ATTEMPT_ALREADY_CONSOLIDATED",
  "RECONCILIATION_REQUIRED",
  "LEGACY_RUNTIME_UNKNOWN",
  "ATTEMPT_NOT_COMPLETABLE",
] as const;

export type CrossRuntimeErrorCode = (typeof CROSS_RUNTIME_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<CrossRuntimeErrorCode, number> = {
  RUNTIME_CHANNEL_NOT_ALLOWED: 403,
  RUNTIME_CAPABILITY_MISMATCH: 422,
  PRESENTATION_ADAPTER_UNAVAILABLE: 422,
  CROSS_RUNTIME_ATTEMPT_CONFLICT: 409,
  ATTEMPT_ALREADY_CONSOLIDATED: 409,
  RECONCILIATION_REQUIRED: 409,
  LEGACY_RUNTIME_UNKNOWN: 422,
  ATTEMPT_NOT_COMPLETABLE: 409,
};

const RETRYABLE_BY_CODE: Record<CrossRuntimeErrorCode, boolean> = {
  RUNTIME_CHANNEL_NOT_ALLOWED: false,
  RUNTIME_CAPABILITY_MISMATCH: false,
  PRESENTATION_ADAPTER_UNAVAILABLE: false,
  CROSS_RUNTIME_ATTEMPT_CONFLICT: false,
  ATTEMPT_ALREADY_CONSOLIDATED: false,
  RECONCILIATION_REQUIRED: false,
  LEGACY_RUNTIME_UNKNOWN: false,
  ATTEMPT_NOT_COMPLETABLE: false,
};

export class CrossRuntimeError extends Error {
  readonly domain: ErrorDomain = "CROSS_RUNTIME";
  readonly code: CrossRuntimeErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly safeDetails: Record<string, unknown> | undefined;

  constructor(code: CrossRuntimeErrorCode, message?: string, safeDetails?: Record<string, unknown>) {
    super(message ?? code);
    this.name = "CrossRuntimeError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.retryable = RETRYABLE_BY_CODE[code];
    this.safeDetails = safeDetails;
  }

  toEnvelope(correlationId: string): ErrorEnvelope {
    return {
      domain: this.domain,
      code: this.code,
      httpStatus: this.httpStatus,
      message: this.message,
      correlationId,
      retryable: this.retryable,
      ...(this.safeDetails ? { safeDetails: this.safeDetails } : {}),
    };
  }
}
