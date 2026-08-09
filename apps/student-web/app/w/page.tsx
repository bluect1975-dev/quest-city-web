"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { StatusMessage } from "@quest-city-web/ui";
import { STUDENT_WEB_CATALOG_IT_IT, t } from "@quest-city-web/i18n";
import { useStudentAuth } from "../../lib/student-auth-context";

/**
 * `/w` (WEB-M4, 07_25 v1.0 §15: "root Web (redirect esistente)"). Real
 * entry-point gate, replacing the WEB-M0/R3C.1 placeholder shell:
 * authenticated (or read-only-authenticated, §16) -> `/w/home`;
 * unauthenticated -> `/w/login`. The R3C.1/R3C.2 demo surfaces
 * (`/w/engine/:runtimeAdapterId`, `/w/sequence`) are unaffected and remain
 * reachable at their existing URLs — `/w/home` links to them as a
 * secondary "developer demo" section (§17 theme boundary: no regression to
 * prior foundation work).
 */
export default function StudentWebRootPage() {
  const { status } = useStudentAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" || status === "authenticated-read-only") {
      router.replace("/w/home");
    } else if (status === "unauthenticated") {
      router.replace("/w/login");
    }
  }, [status, router]);

  return (
    <main>
      <StatusMessage kind="loading">{t(STUDENT_WEB_CATALOG_IT_IT, "home.title")}</StatusMessage>
    </main>
  );
}
