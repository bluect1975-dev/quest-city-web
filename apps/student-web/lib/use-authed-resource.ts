"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ERRORS_CATALOG_IT_IT, translateErrorCode } from "@quest-city-web/i18n";
import { useStudentAuth } from "./student-auth-context";
import { StudentApiError } from "./student-api-error";

/**
 * Shared "fetch one resource once the session is ready, redirect if not
 * logged in, translate any error" sequence (Pilot Product Experience
 * Remediation G4) — the same three-effect shape `/w/home` (UI-R2) already
 * had inline for `getMyAssignments`, now reused by `/w/class`, `/w/path`,
 * `/w/assignments`, `/w/progress` and `/w/profile` instead of being
 * copy-pasted five more times. `fetchResource` must be a stable reference
 * (a module-level API-client function, e.g. `getMyClass`) — never a new
 * inline closure — so it does not need to be a `useEffect` dependency.
 */
export function useAuthedResource<T>(fetchResource: () => Promise<T>) {
  const { status } = useStudentAuth();
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/w/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "authenticated-read-only") {
      return;
    }
    let cancelled = false;
    fetchResource()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(
          caught instanceof StudentApiError
            ? translateErrorCode(ERRORS_CATALOG_IT_IT, caught.code)
            : translateErrorCode(ERRORS_CATALOG_IT_IT, "UNKNOWN_ERROR"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchResource is a stable module-level function reference by contract, not new per render.
  }, [status]);

  return { authStatus: status, data, error, loading };
}
