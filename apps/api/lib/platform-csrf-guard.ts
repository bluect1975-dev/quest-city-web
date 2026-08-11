import { verifyTokenHash } from "@quest-city-web/identity";
import type { PlatformAdminIdentity } from "@quest-city-web/platform-admin";
import type { ApiEnv } from "./env";

export function getPlatformCsrfTokenHeader(request: Request): string | null {
  return request.headers.get("x-csrf-token");
}

/** Verifies the `x-csrf-token` header against the authenticated session's actual token — presence alone is not sufficient (same FVR-discovered discipline as `isValidStaffCsrfToken`). */
export function isValidPlatformCsrfToken(request: Request, identity: PlatformAdminIdentity): boolean {
  const header = getPlatformCsrfTokenHeader(request);
  if (!header) {
    return false;
  }
  return verifyTokenHash(header, identity.csrfTokenHash);
}

/** `Origin`/`Sec-Fetch-Site` check for every mutating platform request. Fails closed. */
export function isTrustedPlatformOrigin(request: Request, env: ApiEnv): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  return env.platformAuthTrustedOrigins.includes(origin);
}
