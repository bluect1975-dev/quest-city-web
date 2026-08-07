import { Button, StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";

/**
 * WEB-M0 placeholder for the Web Student Experience shell (07_02, 07_03 §4).
 * No lesson/activity content, no engines, no authentication — 07_16
 * confirms no auth stub is mandated before the pilot-readiness step. This
 * page only proves the route resolves and honors the baseline accessible
 * shell principles from 07_02 §2 / 07_04 (keyboard-operable, no essential
 * meaning by color alone, announced state). Text is sourced from the it-IT
 * catalog (WEB-I18N-FOUNDATION I18N-B) instead of hardcoded — the route
 * path stays a separate <code> element rather than embedded markup so the
 * catalog holds plain text only.
 */
export default function StudentWebHomePage() {
  return (
    <main>
      <h1>{t(STUDENT_WEB_CATALOG_IT_IT, "home.title")}</h1>
      <StatusMessage kind="empty">
        {t(STUDENT_WEB_CATALOG_IT_IT, "home.underConstructionBefore")} <code>/w</code>{" "}
        {t(STUDENT_WEB_CATALOG_IT_IT, "home.underConstructionAfter")}
      </StatusMessage>
      <Button type="button" disabled>
        {t(STUDENT_WEB_CATALOG_IT_IT, "home.continueButton")}
      </Button>
    </main>
  );
}
