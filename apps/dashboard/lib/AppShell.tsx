"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark, Button } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStaffAuth } from "./staff-auth-context";
import { useTenantMemberships } from "./useTenantMemberships";
import { ActiveRoleSwitcher } from "./ActiveRoleSwitcher";
import { ROLE_LABEL_KEY } from "./role-labels";
import type { StaffContext } from "./staff-api-types";

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
  const { logout, csrfToken } = useStaffAuth();
  const router = useRouter();
  const pathname = usePathname();
  const memberships = useTenantMemberships();

  const activeMembership =
    memberships.status === "success" ? memberships.data.find((m) => m.tenantId === context.tenantId && m.role === context.role) : undefined;

  async function handleLogout() {
    await logout();
    router.replace("/app/login");
  }

  const navItems: Array<{ href: string; labelKey: string }> = [
    { href: "/app", labelKey: "app.nav.home" },
    // ASACOM has no class-level scope at all (02_39 §4.3) -- never shown /app/classes.
    ...(context.role !== "ASACOM" ? [{ href: "/app/classes", labelKey: "app.nav.classes" }] : []),
    ...(context.role === "SCHOOL_ADMIN" ? [{ href: "/app/staff", labelKey: "app.nav.staff" }] : []),
    { href: "/app/review", labelKey: "app.nav.review" },
    ...(context.role === "INDEPENDENT_EDUCATOR" || context.role === "SCHOOL_ADMIN"
      ? [{ href: "/app/convergence", labelKey: "app.nav.convergence" }]
      : []),
    // Student Support Roles (02_39 v1.2) -- role-specific nav, never
    // reused wholesale from TEACHER's own nav (§30 of the governing
    // instruction: "Do not blindly reuse TEACHER nav").
    ...(context.role === "ASACOM" || context.role === "SUPPORT_TEACHER"
      ? [{ href: "/app/support/my-students", labelKey: "app.nav.myAssignedStudents" }]
      : []),
    ...(context.role === "TEACHER" || context.role === "SUPPORT_TEACHER"
      ? [{ href: "/app/facilitation-review", labelKey: "app.nav.facilitationReview" }]
      : []),
    ...(context.role === "SCHOOL_ADMIN"
      ? [
          { href: "/app/support-assignments", labelKey: "app.nav.supportAssignments" },
          { href: "/app/support-coverage", labelKey: "app.nav.supportCoverage" },
        ]
      : []),
    // Granular Learning Path Control (02_41 v1.1 §16, §44) -- School-level
    // default management is SCHOOL_ADMIN-only; TEACHER/SUPPORT_TEACHER
    // reach the Class/Student-scoped views contextually from the class and
    // student detail pages instead, same pattern as support-events.
    ...(context.role === "SCHOOL_ADMIN" ? [{ href: "/app/learning-path-policies", labelKey: "app.nav.learningPathPolicies" }] : []),
  ];

  return (
    <div className="qc-shell">
      <header className="qc-shell-header">
        <span className="qc-auth-brand qc-shell-brand">
          <BrandMark />
          {t(DASHBOARD_CATALOG_IT_IT, "app.brandLabel")}
        </span>
        <nav className="qc-shell-nav" aria-label={t(DASHBOARD_CATALOG_IT_IT, "app.nav.home")}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
              {t(DASHBOARD_CATALOG_IT_IT, item.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="qc-shell-context">
          {memberships.status === "success" && memberships.data.length > 1 ? (
            <ActiveRoleSwitcher context={context} csrfToken={csrfToken} />
          ) : (
            <div className="qc-shell-context-tenant">
              <strong>{activeMembership?.tenantName ?? t(DASHBOARD_CATALOG_IT_IT, ROLE_LABEL_KEY[context.role])}</strong>
              <span>{t(DASHBOARD_CATALOG_IT_IT, ROLE_LABEL_KEY[context.role])}</span>
            </div>
          )}
          <Button variant="secondary" onClick={() => void handleLogout()}>
            {t(DASHBOARD_CATALOG_IT_IT, "app.nav.logout")}
          </Button>
        </div>
      </header>
      <div className="qc-shell-body">{children}</div>
    </div>
  );
}
