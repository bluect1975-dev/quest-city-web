"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark, Button } from "@quest-city-web/ui";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { usePlatformAuth } from "./platform-auth-context";
import type { Capability, PlatformContext } from "./platform-api-types";

function hasCapability(capabilities: Capability[], capability: Capability): boolean {
  return capabilities.includes(capability);
}

/**
 * Shared header/nav for `/app/platform-admin/**` (pre-staging UI/UX
 * remediation §8-9): dark, visually distinct from the staff/school shell
 * so the administrative area is never mistaken for a school-facing
 * screen. Nav items gated by the same capabilities each page already
 * checked individually.
 */
export function AdminShell({ context, children }: { context: PlatformContext; children: ReactNode }) {
  const { logout } = usePlatformAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await logout();
    router.replace("/app/platform-admin/login");
  }

  const navItems: Array<{ href: string; labelKey: string; visible: boolean }> = [
    { href: "/app/platform-admin", labelKey: "platformAdmin.nav.tenants", visible: true },
    {
      href: "/app/platform-admin/independent-educators",
      labelKey: "platformAdmin.nav.independentEducators",
      visible: true,
    },
    {
      href: "/app/platform-admin/audit",
      labelKey: "platformAdmin.nav.audit",
      visible: hasCapability(context.capabilities, "audit.read.global"),
    },
    {
      href: "/app/platform-admin/convergence-requests",
      labelKey: "platformAdmin.nav.convergenceRequests",
      visible: true,
    },
    {
      href: "/app/platform-admin/control-center/overview",
      labelKey: "platformAdmin.nav.controlCenter",
      visible: hasCapability(context.capabilities, "operations.dashboard.view"),
    },
  ];

  return (
    <div className="qc-shell qc-admin-shell">
      <header className="qc-shell-header">
        <span className="qc-shell-brand">
          <BrandMark />
          {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.brandLabel")}
          <span className="qc-shell-badge">{t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.brandBadge")}</span>
        </span>
        <nav className="qc-shell-nav" aria-label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.brandBadge")}>
          {navItems
            .filter((item) => item.visible)
            .map((item) => (
              <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
                {t(DASHBOARD_CATALOG_IT_IT, item.labelKey)}
              </Link>
            ))}
        </nav>
        <Button variant="secondary" onClick={() => void handleLogout()}>
          {t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.nav.logout")}
        </Button>
      </header>
      <div className="qc-shell-body">{children}</div>
    </div>
  );
}
