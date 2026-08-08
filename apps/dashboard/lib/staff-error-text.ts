import { ERRORS_CATALOG_IT_IT, translateErrorCode } from "@quest-city-web/i18n";
import { StaffApiError } from "./staff-api-error";

/** Maps any caught error to localized, staff-facing text — `error.message` (server text) is never rendered directly (02_34 §6). */
export function staffErrorText(error: unknown): string {
  const code = error instanceof StaffApiError ? error.code : "UNKNOWN_ERROR";
  return translateErrorCode(ERRORS_CATALOG_IT_IT, code);
}
