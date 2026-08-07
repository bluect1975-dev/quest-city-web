import { verifyTokenHash } from "@quest-city-web/identity";
import type { StaffInternalIdentity } from "@quest-city-web/staff-identity";
import type { ApiEnv } from "./env";

export function getStaffCsrfTokenHeader(request: Request): string | null {
  return request.headers.get("x-csrf-token");
}

/**
 * Verifies the `x-csrf-token` header against the authenticated session's
 * actual token (02_35 §4.4) — presence alone is not sufficient (FVR
 * finding: a mutating request with ANY non-empty `x-csrf-token` value
 * passed the guard when only `getStaffCsrfTokenHeader`'s truthiness was
 * checked). Mirrors the same `verifyTokenHash` comparison `StaffAuthService.
 * refresh()`/`logout()` already perform against `session.csrfTokenHash`.
 */
export function isValidStaffCsrfToken(request: Request, identity: StaffInternalIdentity): boolean {
  const header = getStaffCsrfTokenHeader(request);
  if (!header) {
    return false;
  }
  return verifyTokenHash(header, identity.csrfTokenHash);
}

/**
 * `Origin`/`Sec-Fetch-Site` check for every mutating staff request
 * (02_35 §4.4, same discipline as `csrf-guard.ts`'s `isTrustedOrigin` —
 * a separate function only because `apps/dashboard` has its own trusted
 * origin list, distinct from `apps/student-web`'s). Fails closed.
 */
export function isTrustedStaffOrigin(request: Request, env: ApiEnv): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  return env.staffAuthTrustedOrigins.includes(origin);
}
