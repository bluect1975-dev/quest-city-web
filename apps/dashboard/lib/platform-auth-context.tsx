"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getPlatformContext, platformLogout } from "./platform-api-client";
import { PlatformApiError } from "./platform-api-error";
import type { PlatformContext } from "./platform-api-types";

type AuthStatus = "loading" | "authenticated" | "authenticated-read-only" | "unauthenticated";

interface PlatformAuthState {
  status: AuthStatus;
  context: PlatformContext | null;
  csrfToken: string | null;
}

interface PlatformAuthContextValue extends PlatformAuthState {
  setSession: (context: PlatformContext, csrfToken: string) => void;
  logout: () => Promise<void>;
}

const PlatformAuthReactContext = createContext<PlatformAuthContextValue | null>(null);

/**
 * Same CSRF-in-memory-only trade-off as `StaffAuthProvider` (a reload
 * always loses it; read views keep working off the session cookie
 * alone). Entirely separate React context, session cookie
 * (`qc_platform_session`), and API surface from `StaffAuthProvider` --
 * never shares state with the staff dashboard's own auth context, the
 * same isolation this codebase already applies at the session-cookie
 * and database-table layers.
 */
export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlatformAuthState>({ status: "loading", context: null, csrfToken: null });

  const applyContext = useCallback((context: PlatformContext) => {
    setState((prev) => ({
      status: prev.csrfToken ? "authenticated" : "authenticated-read-only",
      context,
      csrfToken: prev.csrfToken,
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPlatformContext()
      .then((context) => {
        if (!cancelled) applyContext(context);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          if (error instanceof PlatformApiError && error.httpStatus === 401) {
            setState({ status: "unauthenticated", context: null, csrfToken: null });
            return;
          }
          setState({ status: "unauthenticated", context: null, csrfToken: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyContext]);

  const setSession = useCallback((context: PlatformContext, csrfToken: string) => {
    setState({ status: "authenticated", context, csrfToken });
  }, []);

  const logout = useCallback(async () => {
    await platformLogout(state.csrfToken);
    setState({ status: "unauthenticated", context: null, csrfToken: null });
  }, [state.csrfToken]);

  const value = useMemo<PlatformAuthContextValue>(() => ({ ...state, setSession, logout }), [state, setSession, logout]);

  return <PlatformAuthReactContext.Provider value={value}>{children}</PlatformAuthReactContext.Provider>;
}

export function usePlatformAuth(): PlatformAuthContextValue {
  const value = useContext(PlatformAuthReactContext);
  if (!value) {
    throw new Error("usePlatformAuth must be used within a PlatformAuthProvider");
  }
  return value;
}
