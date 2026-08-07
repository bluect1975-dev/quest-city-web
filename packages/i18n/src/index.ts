export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  PLANNED_LOCALES,
  isSyntacticallyValidLocale,
  isSupportedLocale,
  isPlannedLocale,
} from "./locale-model";
export type { SupportedLocale, PlannedLocale } from "./locale-model";

export { resolveLocaleHierarchy, validatePresentationLocaleInput, resolvePresentationLocale } from "./resolver";
export type {
  LocaleHierarchyInput,
  PresentationLocaleValidation,
  ResolvePresentationLocaleResult,
} from "./resolver";

export { t, translateErrorCode } from "./translate";
export type { Catalog, TranslateOptions, MissingKeyStrategy } from "./translate";

export { formatDate, formatNumber, formatPercent } from "./formatters";

export {
  COMMON_CATALOG_IT_IT,
  STUDENT_WEB_CATALOG_IT_IT,
  DASHBOARD_CATALOG_IT_IT,
  ERRORS_CATALOG_IT_IT,
} from "./catalogs";
