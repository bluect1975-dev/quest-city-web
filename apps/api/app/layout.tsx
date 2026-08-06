import type { ReactNode } from "react";

export const metadata = {
  title: "Quest City Web API",
  description: "Quest City Web platform API — health and (later) shared runtime services.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
