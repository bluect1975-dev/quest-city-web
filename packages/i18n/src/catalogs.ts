import type { Catalog } from "./translate";
import commonItIT from "./locales/it-IT/common.json";
import studentWebItIT from "./locales/it-IT/student-web.json";
import dashboardItIT from "./locales/it-IT/dashboard.json";
import errorsItIT from "./locales/it-IT/errors.json";

/**
 * Only it-IT is populated (02_34 §2.2). These exports are the sole source
 * of catalog content for this milestone -- there is no locale-keyed lookup
 * here on purpose, since introducing one before a second locale exists
 * would be speculative.
 */
export const COMMON_CATALOG_IT_IT: Catalog = commonItIT;
export const STUDENT_WEB_CATALOG_IT_IT: Catalog = studentWebItIT;
export const DASHBOARD_CATALOG_IT_IT: Catalog = dashboardItIT;
export const ERRORS_CATALOG_IT_IT: Catalog = errorsItIT;
