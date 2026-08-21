"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark, Button } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStudentAuth } from "./student-auth-context";

/**
 * Persistent header for every authenticated `/w/**` student page (Pilot
 * UX/UI Redesign, UI-R1 — Design System + Shell). Before this, student-web
 * had no shell at all: `/w/home` rendered a bare heading with no
 * navigation, brand, or session indicator, unlike the dashboard app's own
 * `AppShell` (`apps/dashboard/lib/AppShell.tsx`), which every staff page
 * has had since the pre-staging remediation. Reuses the same `.qc-shell-*`
 * CSS (already app-agnostic in `packages/ui/src/styles.css`) rather than
 * introducing a parallel shared component — the dashboard shell's
 * role/capability-driven nav logic is dashboard-specific and not
 * generalized here, since student-web only has one real destination
 * (`/w/home`) plus the activities launched from it.
 *
 * Intentionally NOT rendered on `/w/login` or `/w` (the redirect gate) —
 * both stand alone, matching the existing `qc-auth-page` pattern.
 */
const NO_SHELL_PATHS = new Set(["/w", "/w/login"]);

export function StudentShell({ children }: { children: ReactNode }) {
  const { status, context, logout } = useStudentAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (NO_SHELL_PATHS.has(pathname) || status === "loading" || status === "unauthenticated") {
    return <>{children}</>;
  }

  async function handleLogout() {
    await logout();
    router.replace("/w/login");
  }

  return (
    <div className="qc-shell">
      <header className="qc-shell-header">
        <span className="qc-auth-brand qc-shell-brand">
          <BrandMark />
          {t(STUDENT_WEB_CATALOG_IT_IT, "shell.brand")}
        </span>
        <nav className="qc-shell-nav" aria-label={t(STUDENT_WEB_CATALOG_IT_IT, "shell.navHome")}>
          <Link href="/w/home" aria-current={pathname === "/w/home" ? "page" : undefined}>
            {t(STUDENT_WEB_CATALOG_IT_IT, "shell.navHome")}
          </Link>
        </nav>
        <div className="qc-shell-context">
          <div className="qc-shell-context-tenant">
            <strong>{context?.displayAlias ?? ""}</strong>
            <span>{t(STUDENT_WEB_CATALOG_IT_IT, "shell.roleLabel")}</span>
          </div>
          <Button variant="secondary" onClick={() => void handleLogout()}>
            {t(STUDENT_WEB_CATALOG_IT_IT, "shell.logout")}
          </Button>
        </div>
      </header>
      <div className="qc-shell-body">{children}</div>
    </div>
  );
}
