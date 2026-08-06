import type { ReactNode } from "react";
import { QC_THEME_CORE } from "@quest-city-web/theme-system";

export const metadata = {
  title: "Quest City Dashboard",
  description: "Quest City shared school/teacher dashboard.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme={QC_THEME_CORE.themeId}>
      <body>{children}</body>
    </html>
  );
}
