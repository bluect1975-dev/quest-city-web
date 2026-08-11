import { ERRORS_CATALOG_IT_IT, translateErrorCode } from "@quest-city-web/i18n";
import { PlatformApiError } from "./platform-api-error";

export function platformErrorText(error: unknown): string {
  if (error instanceof PlatformApiError) {
    return translateErrorCode(ERRORS_CATALOG_IT_IT, error.code);
  }
  return translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR");
}
