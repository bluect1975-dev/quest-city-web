"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getStaffContext, staffLogout } from "./staff-api-client";
import { StaffApiError } from "./staff-api-error";
import type { StaffContext } from "./staff-api-types";

type AuthStatus = "loading" | "authenticated" | "authenticated-read-only" | "unauthenticated";

interface StaffAuthState {
  status: AuthStatus;
  context: StaffContext | null;
  csrfToken: string | null;
}

interface StaffAuthContextValue extends StaffAuthState {
  /** Called by the login page right after `startStaffSession` succeeds. */
  setSession: (context: StaffContext, csrfToken: string) => void;
  logout: () => Promise<void>;
  refetchContext: () => Promise<void>;
}

const StaffAuthReactContext = createContext<StaffAuthContextValue | null>(null);

/**
 * The CSRF token is held client-side in memory only (02_35 §4.4) — never
 * in a cookie, `localStorage`, or `sessionStorage`. This is a deliberate
 * trade-off from the canonical contract: a hard page reload always loses
 * it, and there is no endpoint to recover one for an existing session
 * (only `/staff-auth/session/start` issues a fresh CSRF token). After a
 * reload, `GET /me/staff-context` still succeeds off the session cookie
 * alone, so read views keep working (`authenticated-read-only`), but any
 * mutating action requires the user to sign in again.
 */
export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StaffAuthState>({ status: "loading", context: null, csrfToken: null });

  const applyContext = useCallback((context: StaffContext) => {
    setState((prev) => ({
      status: prev.csrfToken ? "authenticated" : "authenticated-read-only",
      context,
      csrfToken: prev.csrfToken,
    }));
  }, []);

  /** For explicit re-checks from event handlers (not the mount effect below, which inlines its own `.then`/`.catch` — react-hooks/set-state-in-effect). */
  const refetchContext = useCallback(async () => {
    try {
      applyContext(await getStaffContext());
    } catch (error) {
      if (error instanceof StaffApiError && error.httpStatus === 401) {
        setState({ status: "unauthenticated", context: null, csrfToken: null });
        return;
      }
      throw error;
    }
  }, [applyContext]);

  useEffect(() => {
    let cancelled = false;
    getStaffContext()
      .then((context) => {
        if (!cancelled) applyContext(context);
      })
      .catch(() => {
        // Fail closed on ANY error (401, network failure, unexpected
        // status) — a stuck "loading" state would leave `RequireStaffAuth`
        // spinning forever instead of redirecting to `/app/login`.
        if (!cancelled) setState({ status: "unauthenticated", context: null, csrfToken: null });
      });
    return () => {
      cancelled = true;
    };
  }, [applyContext]);

  const setSession = useCallback((context: StaffContext, csrfToken: string) => {
    setState({ status: "authenticated", context, csrfToken });
  }, []);

  const logout = useCallback(async () => {
    await staffLogout(state.csrfToken);
    setState({ status: "unauthenticated", context: null, csrfToken: null });
  }, [state.csrfToken]);

  const value = useMemo<StaffAuthContextValue>(
    () => ({ ...state, setSession, logout, refetchContext }),
    [state, setSession, logout, refetchContext],
  );

  return <StaffAuthReactContext.Provider value={value}>{children}</StaffAuthReactContext.Provider>;
}

export function useStaffAuth(): StaffAuthContextValue {
  const value = useContext(StaffAuthReactContext);
  if (!value) {
    throw new Error("useStaffAuth must be used within a StaffAuthProvider");
  }
  return value;
}
