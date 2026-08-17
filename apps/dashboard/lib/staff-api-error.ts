/**
 * Client-side mirror of the WEB-M3B ErrorEnvelope (02_35 §13). `code` is
 * the only stable identifier the UI keys off of — `message` (server
 * text) is never rendered directly (02_34 §6); callers pass `code` to
 * `translateErrorCode(ERRORS_CATALOG_IT_IT, code)`.
 */
export class StaffApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  /** Structured, non-sensitive detail (e.g. AMBIGUOUS_TENANT_MEMBERSHIP's candidate list) -- never rendered as raw text, only consumed by code that already knows the shape for a specific `code`. */
  readonly safeDetails: Record<string, unknown> | undefined;

  constructor(code: string, message: string, httpStatus: number, safeDetails?: Record<string, unknown>) {
    super(message);
    this.name = "StaffApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.safeDetails = safeDetails;
  }
}
