import { StatusMessage } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";

/**
 * WEB-M0 controlled placeholder (deliverable 11). `/dashboard` is the
 * external reverse-proxy path for this app (07_06 §3 topology). The
 * canonical screen-by-screen IA for the school/teacher dashboard is
 * registered separately in 02_23 §7 under a single shared route root,
 * `/app` — that IA is not implemented yet and is intentionally out of
 * scope here. This placeholder must not be mistaken for a second,
 * competing dashboard: there is exactly one dashboard product, shared by
 * school and teacher roles, per 02_16 / 02_23. Text is sourced from the
 * it-IT catalog (WEB-I18N-FOUNDATION I18N-B) instead of hardcoded — route
 * paths stay separate <code> elements rather than embedded markup so the
 * catalog holds plain text only.
 */
export default function DashboardPlaceholderPage() {
  return (
    <main>
      <h1>{t(DASHBOARD_CATALOG_IT_IT, "home.title")}</h1>
      <StatusMessage kind="empty">
        {t(DASHBOARD_CATALOG_IT_IT, "home.underConstructionPart1")} <code>/dashboard</code>{" "}
        {t(DASHBOARD_CATALOG_IT_IT, "home.underConstructionPart2")} <code>/app</code>{" "}
        {t(DASHBOARD_CATALOG_IT_IT, "home.underConstructionPart3")}
      </StatusMessage>
    </main>
  );
}
