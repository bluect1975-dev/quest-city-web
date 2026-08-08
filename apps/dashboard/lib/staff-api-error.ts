/**
 * Client-side mirror of the WEB-M3B ErrorEnvelope (02_35 §13). `code` is
 * the only stable identifier the UI keys off of — `message` (server
 * text) is never rendered directly (02_34 §6); callers pass `code` to
 * `translateErrorCode(ERRORS_CATALOG_IT_IT, code)`.
 */
export class StaffApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "StaffApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
