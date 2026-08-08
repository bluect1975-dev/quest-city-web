"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStaffAuth } from "./staff-auth-context";
import type { StaffContext } from "./staff-api-types";

/**
 * Gate for every `/app/**` page except `/app/login` (07_04 §19: loading/
 * unauthorized states). Redirects to `/app/login` when the session cookie
 * itself is invalid or absent; `authenticated-read-only` (valid cookie,
 * no in-memory CSRF token after a reload) still renders `children` —
 * individual mutating actions are what enforce the CSRF requirement.
 */
export function RequireStaffAuth({ children }: { children: (context: StaffContext) => ReactNode }) {
  const { status, context } = useStaffAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/app/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return <StatusMessage kind="loading">{t(COMMON_CATALOG_IT_IT, "status.loading")}</StatusMessage>;
  }
  if (status === "unauthenticated" || !context) {
    return <StatusMessage kind="unauthorized">{t(COMMON_CATALOG_IT_IT, "status.unauthorized")}</StatusMessage>;
  }
  return <>{children(context)}</>;
}
