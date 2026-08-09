/**
 * Client-side holder for the CSRF token issued by `POST
 * /web-auth/session/*` (R3C.3). The session token itself is httpOnly by
 * design (never readable by JS — `apps/api/lib/session-cookie.ts`); the
 * CSRF token is deliberately NOT httpOnly and is returned once, in the
 * session-start JSON body, so the client can attach it as `x-csrf-token`
 * on subsequent mutating requests (`isTrustedOrigin`/`getCsrfTokenHeader`,
 * `apps/api/lib/csrf-guard.ts`). `sessionStorage` (not `localStorage`):
 * scoped to one tab, cleared on tab close — no login UI exists yet in
 * `apps/student-web` (out of R3C.3 scope), so nothing else populates this
 * key today; a real login flow would call `setStoredCsrfToken` right
 * after a successful `session/start` response.
 */
const CSRF_TOKEN_STORAGE_KEY = "qc_web_csrf_token";

export function getStoredCsrfToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage.getItem(CSRF_TOKEN_STORAGE_KEY);
}

export function setStoredCsrfToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(CSRF_TOKEN_STORAGE_KEY, token);
}
