"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { usePlatformAuth } from "./platform-auth-context";
import { AdminShell } from "./AdminShell";

/**
 * Renders `AdminShell` around every `/app/platform-admin/**` page except
 * `/app/platform-admin/login` itself (pre-staging UI/UX remediation §9).
 */
export function AdminShellGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, context } = usePlatformAuth();

  if (
    pathname === "/app/platform-admin/login" ||
    (status !== "authenticated" && status !== "authenticated-read-only") ||
    !context
  ) {
    return <>{children}</>;
  }

  return <AdminShell context={context}>{children}</AdminShell>;
}
