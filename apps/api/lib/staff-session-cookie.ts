import type { ApiEnv } from "./env";

/**
 * Staff session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, distinct
 * name/table from the student session cookie (02_35 §2.1, §4.4;
 * `staffSessionCookie` security scheme in OpenAPI v1.6). Same `Secure`
 * gating discipline as `session-cookie.ts` — never omitted outside
 * `development`.
 */
export function buildStaffSessionSetCookie(env: ApiEnv, token: string, expiresAt: Date): string {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = !env.sessionCookieSecureOverrideInsecureLocal;
  const attributes = [
    `${env.staffSessionCookieName}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

/** `staffLogout` always clears the cookie, regardless of prior session state (02_35 §4.4). */
export function buildClearStaffSessionCookie(env: ApiEnv): string {
  const secure = !env.sessionCookieSecureOverrideInsecureLocal;
  const attributes = [`${env.staffSessionCookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

/** Reads the raw staff session token from the request's Cookie header, or null if absent. */
export function readStaffSessionToken(request: Request, env: ApiEnv): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  const prefix = `${env.staffSessionCookieName}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
