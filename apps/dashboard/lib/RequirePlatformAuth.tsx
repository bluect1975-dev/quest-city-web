"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { StatusMessage } from "@quest-city-web/ui";
import { COMMON_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { usePlatformAuth } from "./platform-auth-context";
import type { PlatformContext } from "./platform-api-types";

/** Gate for every `/app/platform-admin/**` page except `/app/platform-admin/login`. */
export function RequirePlatformAuth({ children }: { children: (context: PlatformContext) => ReactNode }) {
  const { status, context } = usePlatformAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/app/platform-admin/login");
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
