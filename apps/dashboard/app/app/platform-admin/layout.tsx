import type { ReactNode } from "react";
import { PlatformAuthProvider } from "../../../lib/platform-auth-context";
import { AdminShellGate } from "../../../lib/AdminShellGate";

/**
 * Root layout for the Platform Admin surface -- wraps every route under
 * `/app/platform-admin`, including `/app/platform-admin/login`, with its
 * own session context. `AdminShellGate` (pre-staging UI/UX remediation
 * §9) adds the persistent, visually distinct admin shell around every
 * authenticated page, skipping the login page itself.
 */
export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformAuthProvider>
      <AdminShellGate>{children}</AdminShellGate>
    </PlatformAuthProvider>
  );
}
