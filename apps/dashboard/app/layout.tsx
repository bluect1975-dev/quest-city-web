import type { ReactNode } from "react";
import { QC_THEME_CORE } from "@quest-city-web/theme-system";
import { DASHBOARD_CATALOG_IT_IT, DEFAULT_LOCALE, t } from "@quest-city-web/i18n";
import "@quest-city-web/ui/styles.css";

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
    <html lang={DEFAULT_LOCALE} data-theme={QC_THEME_CORE.themeId}>
      <body>{children}</body>
    </html>
  );
}
