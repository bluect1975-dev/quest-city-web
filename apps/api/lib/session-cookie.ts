import type { ApiEnv } from "./env";

/**
 * Student session cookie: `HttpOnly`, `Secure`, `SameSite=Lax` (AGENTS.md
 * WEB-M1 baseline, rule 3; contracts/quest-city-platform-openapi-v1_3.yaml
 * `studentSessionCookie` security scheme). `Secure` is unconditional in
 * every environment except `development`, and even there only omitted
 * when `SESSION_COOKIE_SECURE_OVERRIDE_INSECURE_LOCAL=true` is explicitly
 * set (already gated to `development` by `loadEnv`, WEB-M1 Fase 2
 * correction report §6) — this module does not re-derive that gate, it
 * only trusts the already-validated env flag.
 */
export function buildSessionSetCookie(env: ApiEnv, token: string, expiresAt: Date): string {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = !env.sessionCookieSecureOverrideInsecureLocal;
  const attributes = [
    `${env.sessionCookieName}=${token}`,
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

/** `logout` always clears the cookie, regardless of prior session state (02_26 §30.1). */
export function buildClearSessionCookie(env: ApiEnv): string {
  const secure = !env.sessionCookieSecureOverrideInsecureLocal;
  const attributes = [`${env.sessionCookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

/** Reads the raw session token from the request's Cookie header, or null if absent. */
export function readSessionToken(request: Request, env: ApiEnv): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  const prefix = `${env.sessionCookieName}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
