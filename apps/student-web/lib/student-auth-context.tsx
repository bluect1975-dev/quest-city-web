"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getStudentContext, studentLogout, type StudentContext } from "./student-api-client";
import { getStoredCsrfToken, setStoredCsrfToken } from "./session-client";

type AuthStatus = "loading" | "authenticated" | "authenticated-read-only" | "unauthenticated";

interface StudentAuthState {
  status: AuthStatus;
  context: StudentContext | null;
  csrfToken: string | null;
}

interface StudentAuthContextValue extends StudentAuthState {
  /** Called by the login page right after `startStudentSession` succeeds. */
  setSession: (context: StudentContext, csrfToken: string) => void;
  logout: () => Promise<void>;
}

const StudentAuthReactContext = createContext<StudentAuthContextValue | null>(null);

/**
 * Unlike `apps/dashboard/lib/staff-auth-context.tsx` (CSRF held in-memory
 * only, deliberately lost on reload), the student CSRF token is read from
 * `session-client.ts`'s `sessionStorage` key — the convention already
 * established by R3C.2/R3C.3's `SequenceHost` — so it survives a reload
 * within the same tab. `authenticated-read-only` still covers the edge
 * case of a valid session cookie with no stored CSRF token (e.g. a session
 * that predates this tab's `sessionStorage`).
 */
export function StudentAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudentAuthState>({ status: "loading", context: null, csrfToken: null });

  useEffect(() => {
    let cancelled = false;
    getStudentContext()
      .then((context) => {
        if (cancelled) return;
        const csrfToken = getStoredCsrfToken();
        setState({ status: csrfToken ? "authenticated" : "authenticated-read-only", context, csrfToken });
      })
      .catch(() => {
        if (cancelled) return;
        // Fail closed on ANY error (401, network failure, unexpected
        // status) — a stuck "loading" state would leave gated routes
        // spinning forever instead of redirecting to /w/login.
        setState({ status: "unauthenticated", context: null, csrfToken: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSession = useCallback((context: StudentContext, csrfToken: string) => {
    setStoredCsrfToken(csrfToken);
    setState({ status: "authenticated", context, csrfToken });
  }, []);

  const logout = useCallback(async () => {
    await studentLogout(state.csrfToken);
    setState({ status: "unauthenticated", context: null, csrfToken: null });
  }, [state.csrfToken]);

  const value = useMemo<StudentAuthContextValue>(() => ({ ...state, setSession, logout }), [state, setSession, logout]);

  return <StudentAuthReactContext.Provider value={value}>{children}</StudentAuthReactContext.Provider>;
}

export function useStudentAuth(): StudentAuthContextValue {
  const value = useContext(StudentAuthReactContext);
  if (!value) {
    throw new Error("useStudentAuth must be used within a StudentAuthProvider");
  }
  return value;
}
