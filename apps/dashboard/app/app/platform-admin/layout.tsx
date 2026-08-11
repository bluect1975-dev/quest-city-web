import type { ReactNode } from "react";
import { PlatformAuthProvider } from "../../../lib/platform-auth-context";

/** Root layout for the Platform Admin surface -- wraps every route under `/app/platform-admin`, including `/app/platform-admin/login`, with its own session context. */
export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  return <PlatformAuthProvider>{children}</PlatformAuthProvider>;
}
