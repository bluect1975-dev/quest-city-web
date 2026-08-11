/**
 * Client-side mirror of the Platform Admin ErrorEnvelope. `code` is the
 * only stable identifier the UI keys off of; `message` (server text) is
 * never rendered directly — callers pass `code` to
 * `translateErrorCode(ERRORS_CATALOG_IT_IT, code)`.
 */
export class PlatformApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "PlatformApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
