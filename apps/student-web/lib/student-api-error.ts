/**
 * Two distinct error envelope shapes exist across `apps/api` (WEB-M4,
 * §19-20 of the implementation authorization — the client must not assume
 * either one and silently drop the other):
 *  - identity/web-auth routes: `{ error: { code, message }, meta }`
 *    (`apps/api/lib/identity-error-response.ts`)
 *  - attempts/assignments routes: a flat `ErrorEnvelope`
 *    (`domain, code, httpStatus, message, correlationId, retryable`,
 *    `apps/api/lib/attempt-error-response.ts`)
 * `StudentApiError.code` is always populated from whichever shape matched,
 * so the UI only ever keys off `code` (`translateErrorCode`), never off
 * `message`.
 */
export class StudentApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "StudentApiError";
  }
}

export function parseStudentApiErrorBody(json: unknown, httpStatus: number): StudentApiError {
  if (json && typeof json === "object") {
    const asIdentityShape = json as { error?: { code?: unknown; message?: unknown } };
    if (asIdentityShape.error && typeof asIdentityShape.error === "object") {
      const code = asIdentityShape.error.code;
      const message = asIdentityShape.error.message;
      return new StudentApiError(
        typeof code === "string" ? code : "UNKNOWN_ERROR",
        typeof message === "string" ? message : "Unexpected error",
        httpStatus,
      );
    }
    const asFlatShape = json as { code?: unknown; message?: unknown };
    if (typeof asFlatShape.code === "string") {
      return new StudentApiError(asFlatShape.code, typeof asFlatShape.message === "string" ? asFlatShape.message : "Unexpected error", httpStatus);
    }
  }
  return new StudentApiError("UNKNOWN_ERROR", "Unexpected error", httpStatus);
}
