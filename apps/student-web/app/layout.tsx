import type { ReactNode } from "react";
import { QC_THEME_CORE } from "@quest-city-web/theme-system";
import { DEFAULT_LOCALE, STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";

/**
 * `lang` and metadata are sourced from the locale model (DEFAULT_LOCALE),
 * not hardcoded, replacing the previous `lang="en"` mismatch. Real
 * per-request locale resolution for page-level rendering (student/class/
 * school hierarchy) is out of scope for this foundation milestone — see
 * docs/implementation/web-i18n-foundation.md, "Limits".
 */
export const metadata = {
  title: t(STUDENT_WEB_CATALOG_IT_IT, "meta.title"),
  description: t(STUDENT_WEB_CATALOG_IT_IT, "meta.description"),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} data-theme={QC_THEME_CORE.themeId}>
      <body>{children}</body>
    </html>
  );
}
