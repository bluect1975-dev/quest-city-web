import type { ReactNode } from "react";
import { Bricolage_Grotesque, Manrope } from "next/font/google";
import { QC_THEME_CORE } from "@quest-city-web/theme-system";
import { DASHBOARD_CATALOG_IT_IT, DEFAULT_LOCALE, t } from "@quest-city-web/i18n";
import "@quest-city-web/ui/styles.css";

/**
 * Quest City visual identity (UAT Failure Remediation,
 * `UAT-RC4-VISUAL-DIRECTION-01`) — same brand pairing as apps/student-web
 * (self-hosted, build-time-loaded) for real Student/Teacher visual
 * coherence; `packages/ui/src/styles.css` keeps the display face out of
 * `.qc-admin-shell` specifically, so Platform Admin is unaffected.
 */
const displayFont = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--qc-font-display-loaded" });
const bodyFont = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--qc-font-sans-loaded" });

/**
 * `lang` and metadata are sourced from the locale model (DEFAULT_LOCALE),
 * not hardcoded, replacing the previous `lang="en"` mismatch. Real
 * per-request locale resolution for page-level rendering is out of scope
 * for this foundation milestone — see
 * docs/implementation/web-i18n-foundation.md, "Limits".
 */
export const metadata = {
  title: t(DASHBOARD_CATALOG_IT_IT, "meta.title"),
  description: t(DASHBOARD_CATALOG_IT_IT, "meta.description"),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} data-theme={QC_THEME_CORE.themeId} className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
