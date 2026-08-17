"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useStaffAuth } from "./staff-auth-context";
import { AppShell } from "./AppShell";

/**
 * Renders `AppShell` around every `/app/**` page except `/app/login`
 * (the auth entry point, which must render standalone) and whenever no
 * authenticated context exists yet -- each page's own `RequireStaffAuth`
 * still owns the loading/unauthorized states, this gate only decides
 * whether the persistent shell chrome wraps them.
 */
export function StaffShellGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, context } = useStaffAuth();

  if (pathname === "/app/login" || status !== "authenticated" && status !== "authenticated-read-only" || !context) {
    return <>{children}</>;
  }

  return <AppShell context={context}>{children}</AppShell>;
}
