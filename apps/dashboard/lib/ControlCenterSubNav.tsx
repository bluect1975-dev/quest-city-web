"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASHBOARD_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import type { Capability } from "./platform-api-types";

interface ControlCenterSubNavProps {
  capabilities: Capability[];
}

const SECTIONS: Array<{ href: string; labelKey: string; capability: Capability }> = [
  { href: "/app/platform-admin/control-center/overview", labelKey: "platformAdmin.controlCenter.nav.overview", capability: "operations.dashboard.view" },
  { href: "/app/platform-admin/control-center/infrastructure", labelKey: "platformAdmin.controlCenter.nav.infrastructure", capability: "operations.infrastructure.view" },
  { href: "/app/platform-admin/control-center/usage", labelKey: "platformAdmin.controlCenter.nav.usage", capability: "operations.usage.view" },
  { href: "/app/platform-admin/control-center/live-users", labelKey: "platformAdmin.controlCenter.nav.liveUsers", capability: "operations.presence.view" },
  { href: "/app/platform-admin/control-center/errors", labelKey: "platformAdmin.controlCenter.nav.errors", capability: "operations.errors.view" },
  { href: "/app/platform-admin/control-center/incidents", labelKey: "platformAdmin.controlCenter.nav.incidents", capability: "operations.incidents.view" },
  { href: "/app/platform-admin/control-center/alerting", labelKey: "platformAdmin.controlCenter.nav.alerting", capability: "operations.alerting.view" },
];

/** Sub-navigation for the seven Control Center sections (02_42 v1.1 §8, §39-54) -- reused on every control-center/** page. */
export function ControlCenterSubNav({ capabilities }: ControlCenterSubNavProps) {
  const pathname = usePathname();
  return (
    <nav className="qc-shell-subnav" aria-label={t(DASHBOARD_CATALOG_IT_IT, "platformAdmin.controlCenter.title")}>
      {SECTIONS.filter((section) => capabilities.includes(section.capability)).map((section) => (
        <Link key={section.href} href={section.href} aria-current={pathname === section.href ? "page" : undefined}>
          {t(DASHBOARD_CATALOG_IT_IT, section.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
