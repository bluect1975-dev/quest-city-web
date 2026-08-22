"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark, Button } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStudentAuth } from "./student-auth-context";

/**
 * Persistent header for every authenticated `/w/**` student page. Originally
 * (Pilot UX/UI Redesign UI-R1) this had a single nav link ("Home") — a real
 * user-acceptance session found that inadequate for a pilot product (see
 * `PILOT_UI_ACCEPTED = CONTESTED_BY_USER_ACCEPTANCE`, Pilot Product
 * Experience Remediation mission mandate §10-11). Extended here (Tranche
 * G1) to a full, real nav: every entry below has a corresponding real page
 * shipped in the same tranche (G2-G5) — never a link to a page that
 * doesn't exist yet (mission §42 "no fake navigation"). Reuses the same
 * `.qc-shell-header`/`.qc-shell-nav` pattern as `apps/dashboard`'s
 * `AppShell` (already responsive/flex-wrap-tested for up to ~9 items there)
 * rather than introducing a new sidebar paradigm that would need its own
 * fresh responsive/accessibility validation — an "equivalent professional
 * structure" per the mission's own wording, not a deviation from it.
 *
 * Intentionally NOT rendered on `/w/login` or `/w` (the redirect gate) —
 * both stand alone, matching the existing `qc-auth-page` pattern.
 */
const NO_SHELL_PATHS = new Set(["/w", "/w/login"]);

const NAV_ITEMS: Array<{ href: string; labelKey: string }> = [
  { href: "/w/home", labelKey: "shell.navHome" },
  { href: "/w/class", labelKey: "shell.navClass" },
  { href: "/w/path", labelKey: "shell.navPath" },
  { href: "/w/assignments", labelKey: "shell.navAssignments" },
  { href: "/w/progress", labelKey: "shell.navProgress" },
  { href: "/w/profile", labelKey: "shell.navProfile" },
];

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
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
              {t(STUDENT_WEB_CATALOG_IT_IT, item.labelKey)}
            </Link>
          ))}
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
