"use client";

import Link from "next/link";
import { Button } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { RequireStaffAuth } from "../../lib/RequireStaffAuth";
import { useStaffAuth } from "../../lib/staff-auth-context";

/** `/app` home (02_23 §7, 02_35 §3.2). Minimal landing: who is signed in, their scope, links into the two main areas. */
export default function StaffHomePage() {
  const { logout } = useStaffAuth();

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
          <nav>
            <Link href="/app/classes">{t(DASHBOARD_CATALOG_IT_IT, "app.home.goToClasses")}</Link>{" "}
            {context.role === "SCHOOL_ADMIN" ? (
              <>
                <Link href="/app/staff">{t(DASHBOARD_CATALOG_IT_IT, "app.home.goToStaff")}</Link>{" "}
              </>
            ) : null}
            <Link href="/app/review">{t(DASHBOARD_CATALOG_IT_IT, "app.home.goToReview")}</Link>{" "}
            {context.role === "INDEPENDENT_EDUCATOR" || context.role === "SCHOOL_ADMIN" ? (
              <Link href="/app/convergence">{t(DASHBOARD_CATALOG_IT_IT, "app.home.goToConvergence")}</Link>
            ) : null}
          </nav>
          <Button variant="secondary" onClick={() => void logout()}>
            {t(DASHBOARD_CATALOG_IT_IT, "app.nav.logout")}
          </Button>
        </main>
      )}
    </RequireStaffAuth>
  );
}
