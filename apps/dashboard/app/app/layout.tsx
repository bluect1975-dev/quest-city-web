import type { ReactNode } from "react";
import { StaffAuthProvider } from "../../lib/staff-auth-context";

/**
 * Root layout for the staff review dashboard IA (02_23 §7, 02_35). Wraps
 * every route under `/app` — including `/app/login` — with the staff
 * session context; `/app/login` itself checks `status` and redirects
 * away if already authenticated, rather than this layout special-casing
 * one child route.
 */
export default function StaffAppLayout({ children }: { children: ReactNode }) {
  return <StaffAuthProvider>{children}</StaffAuthProvider>;
}
