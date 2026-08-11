import type { ApiEnv } from "./env";

/**
 * Platform admin session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`,
 * its own distinct name/table from both the staff and student session
 * cookies (02_38 §20, same "never the same cookie, never the same
 * table" discipline as 02_35 §2.1/§4.4).
 */
export function buildPlatformSessionSetCookie(env: ApiEnv, token: string, expiresAt: Date): string {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = !env.sessionCookieSecureOverrideInsecureLocal;
  const attributes = [
    `${env.platformSessionCookieName}=${token}`,
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

export function buildClearPlatformSessionCookie(env: ApiEnv): string {
  const secure = !env.sessionCookieSecureOverrideInsecureLocal;
  const attributes = [`${env.platformSessionCookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function readPlatformSessionToken(request: Request, env: ApiEnv): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  const prefix = `${env.platformSessionCookieName}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
