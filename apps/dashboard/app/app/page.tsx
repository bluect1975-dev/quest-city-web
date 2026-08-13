"use client";

import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../lib/RequireStaffAuth";

/**
 * `/app` home (02_23 §7, 02_35 §3.2). Minimal landing: who is signed in
 * and their scope. Navigation into the other areas now lives in the
 * persistent `AppShell` (pre-staging UI/UX remediation §9), not
 * duplicated here.
 */
export default function StaffHomePage() {
  return (
    <RequireStaffAuth>
      {(context) => (
        <main>
          <h1>{t(DASHBOARD_CATALOG_IT_IT, "app.home.title")}</h1>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.home.welcome")}{" "}
            {context.role === "TEACHER"
              ? t(DASHBOARD_CATALOG_IT_IT, "app.home.roleTeacher")
              : context.role === "INDEPENDENT_EDUCATOR"
                ? t(DASHBOARD_CATALOG_IT_IT, "app.home.roleIndependentEducator")
                : t(DASHBOARD_CATALOG_IT_IT, "app.home.roleSchoolAdmin")}
          </p>
          <p>
            {t(DASHBOARD_CATALOG_IT_IT, "app.home.classScopeLabel")}:{" "}
            {context.classScope ? context.classScope.length : t(DASHBOARD_CATALOG_IT_IT, "app.home.classScopeAll")}
          </p>
        </main>
      )}
    </RequireStaffAuth>
  );
}
