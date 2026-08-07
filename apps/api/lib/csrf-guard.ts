import type { ApiEnv } from "./env";

export function getCsrfTokenHeader(request: Request): string | null {
  return request.headers.get("x-csrf-token");
}

/**
 * `Origin`/`Sec-Fetch-Site` check for every mutating web-auth request
 * (AGENTS.md WEB-M1 baseline, rule 1 — combined with, not a replacement
 * for, the synchronizer CSRF token comparison done by SessionService).
 * Fails closed: a request with neither header is untrusted.
 */
export function isTrustedOrigin(request: Request, env: ApiEnv): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  return env.webAuthTrustedOrigins.includes(origin);
}
