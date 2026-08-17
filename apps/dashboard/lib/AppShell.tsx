"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStaffAuth } from "./staff-auth-context";
import { useTenantMemberships } from "./useTenantMemberships";
import type { StaffContext } from "./staff-api-types";

const ROLE_LABEL_KEY: Record<StaffContext["role"], string> = {
  TEACHER: "app.home.roleTeacher",
  SCHOOL_ADMIN: "app.home.roleSchoolAdmin",
  INDEPENDENT_EDUCATOR: "app.home.roleIndependentEducator",
};

/**
 * Shared header/nav/context bar for every authenticated `/app/**` staff
 * page (pre-staging UI/UX remediation §9-11) — replaces the per-page
 * inline `<nav>` + logout button previously duplicated on the home page
 * only (every other page had no persistent navigation at all, forcing
 * back-button reliance). Nav items are capability/role-driven, same
 * conditions each page already applied individually. Tenant name/type
 * resolved via the existing `GET /me/tenant-memberships` (no new API,
 * §10) by matching the active session's tenantId.
 */
export function AppShell({ context, children }: { context: StaffContext; children: ReactNode }) {
  const { logout } = useStaffAuth();
  const router = useRouter();
  const pathname = usePathname();
  const memberships = useTenantMemberships();

  const activeMembership =
    memberships.status === "success" ? memberships.data.find((m) => m.tenantId === context.tenantId) : undefined;

  async function handleLogout() {
    await logout();
    router.replace("/app/login");
  }

  const navItems: Array<{ href: string; labelKey: string }> = [
    { href: "/app", labelKey: "app.nav.home" },
    { href: "/app/classes", labelKey: "app.nav.classes" },
    ...(context.role === "SCHOOL_ADMIN" ? [{ href: "/app/staff", labelKey: "app.nav.staff" }] : []),
    { href: "/app/review", labelKey: "app.nav.review" },
    ...(context.role === "INDEPENDENT_EDUCATOR" || context.role === "SCHOOL_ADMIN"
      ? [{ href: "/app/convergence", labelKey: "app.nav.convergence" }]
      : []),
  ];

  return (
    <div className="qc-shell">
      <header className="qc-shell-header">
        <span className="qc-auth-brand qc-shell-brand">{t(DASHBOARD_CATALOG_IT_IT, "app.brandLabel")}</span>
        <nav className="qc-shell-nav" aria-label={t(DASHBOARD_CATALOG_IT_IT, "app.nav.home")}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
              {t(DASHBOARD_CATALOG_IT_IT, item.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="qc-shell-context">
          <div className="qc-shell-context-tenant">
            <strong>{activeMembership?.tenantName ?? t(DASHBOARD_CATALOG_IT_IT, ROLE_LABEL_KEY[context.role])}</strong>
            <span>{t(DASHBOARD_CATALOG_IT_IT, ROLE_LABEL_KEY[context.role])}</span>
          </div>
          <Button variant="secondary" onClick={() => void handleLogout()}>
            {t(DASHBOARD_CATALOG_IT_IT, "app.nav.logout")}
          </Button>
        </div>
      </header>
      <div className="qc-shell-body">{children}</div>
    </div>
  );
}
