import type { ReactNode } from "react";
import { Bricolage_Grotesque, Manrope } from "next/font/google";
import { QC_THEME_CORE } from "@quest-city-web/theme-system";
import { DEFAULT_LOCALE, STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { StudentAuthProvider } from "../lib/student-auth-context";
import { StudentShell } from "../lib/StudentShell";
import "@quest-city-web/ui/styles.css";
import "./globals.css";

/**
 * Quest City visual identity (UAT Failure Remediation,
 * `UAT-RC4-VISUAL-DIRECTION-01`) — self-hosted at build time (never a
 * runtime fonts.googleapis.com request), exposed as the CSS custom
 * properties `packages/ui/src/styles.css`'s `--qc-font-display`/
 * `--qc-font-sans` tokens already know to prefer.
 */
const displayFont = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--qc-font-display-loaded" });
const bodyFont = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--qc-font-sans-loaded" });

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
    <html lang={DEFAULT_LOCALE} data-theme={QC_THEME_CORE.themeId} className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <StudentAuthProvider>
          <StudentShell>{children}</StudentShell>
        </StudentAuthProvider>
      </body>
    </html>
  );
}
