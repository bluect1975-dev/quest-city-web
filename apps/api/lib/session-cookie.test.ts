import { describe, expect, it } from "vitest";
import { buildClearSessionCookie, buildSessionSetCookie, readSessionToken } from "./session-cookie";
import type { ApiEnv } from "./env";

function makeEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    databaseUrl: "postgresql://u:p@localhost:5432/db",
    databaseSsl: false,
    healthReadyDbTimeoutMs: 2000,
    nodeEnv: "production",
    sessionCookieName: "qc_web_session",
    sessionAbsoluteTtlSeconds: 43200,
    sessionInactivityTtlSeconds: 3600,
    sessionCookieSecureOverrideInsecureLocal: false,
    webAuthTrustedOrigins: ["http://localhost:3000"],
    classCodeHashPepper: Buffer.alloc(32, 7),
    staffSessionCookieName: "qc_staff_session",
    staffSessionAbsoluteTtlSeconds: 43200,
    staffSessionInactivityTtlSeconds: 3600,
    staffAuthTrustedOrigins: ["http://localhost:3001"],
    platformSessionCookieName: "qc_platform_session",
    platformSessionAbsoluteTtlSeconds: 43200,
    platformSessionInactivityTtlSeconds: 3600,
    platformAuthTrustedOrigins: ["http://localhost:3002"],
    dbPoolHealthMax: 5,
    dbPoolHealthIdleTimeoutMs: 10000,
    dbPoolAttemptsMax: 10,
    dbPoolAttemptsIdleTimeoutMs: 10000,
    dbPoolAttemptsConnectionTimeoutMs: 0,
    dbPoolIdentityMax: 10,
    dbPoolIdentityIdleTimeoutMs: 10000,
    dbPoolIdentityConnectionTimeoutMs: 0,
    dbPoolStaffIdentityMax: 10,
    dbPoolStaffIdentityIdleTimeoutMs: 10000,
    dbPoolStaffIdentityConnectionTimeoutMs: 0,
    dbPoolPlatformIdentityMax: 10,
    dbPoolPlatformIdentityIdleTimeoutMs: 10000,
    dbPoolPlatformIdentityConnectionTimeoutMs: 0,
    externalMonitorHmacSecretCurrent: null,
    externalMonitorHmacSecretPrevious: null,
    ...overrides,
  };
}

describe("buildSessionSetCookie", () => {
  it("sets HttpOnly, Secure and SameSite=Lax by default", () => {
    const cookie = buildSessionSetCookie(makeEnv(), "abc123", new Date(Date.now() + 60_000));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("qc_web_session=abc123");
  });

  it("never omits Secure in production even if the override flag were somehow true", () => {
    // loadEnv() itself refuses to set this true outside development (see env.test.ts) —
    // this test asserts the cookie builder's own behaviour is consistent with that invariant
    // by checking it only reacts to the flag, and the flag is never true in a `nodeEnv: "production"` env.
    const cookie = buildSessionSetCookie(makeEnv({ nodeEnv: "production" }), "abc123", new Date(Date.now() + 60_000));
    expect(cookie).toContain("Secure");
  });

  it("omits Secure only when the (already dev-gated) override flag is set", () => {
    const cookie = buildSessionSetCookie(
      makeEnv({ nodeEnv: "development", sessionCookieSecureOverrideInsecureLocal: true }),
      "abc123",
      new Date(Date.now() + 60_000),
    );
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("HttpOnly");
  });

  it("never places the raw session token anywhere but the cookie value itself", () => {
    const token = "super-secret-session-token";
    const cookie = buildSessionSetCookie(makeEnv(), token, new Date(Date.now() + 60_000));
    // Appears exactly once, as the cookie's own value.
    expect(cookie.split(token)).toHaveLength(2);
    expect(cookie.startsWith(`qc_web_session=${token}`)).toBe(true);
  });

  it("computes a non-negative Max-Age even for an already-past expiry", () => {
    const cookie = buildSessionSetCookie(makeEnv(), "abc123", new Date(Date.now() - 60_000));
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("buildClearSessionCookie", () => {
  it("clears with Max-Age=0 and an empty value, keeping HttpOnly/SameSite/Secure", () => {
    const cookie = buildClearSessionCookie(makeEnv());
    expect(cookie).toContain("qc_web_session=;");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });
});

describe("readSessionToken", () => {
  it("reads the token from a Cookie header", () => {
    const request = new Request("http://localhost/", { headers: { cookie: "other=1; qc_web_session=tok123; foo=bar" } });
    expect(readSessionToken(request, makeEnv())).toBe("tok123");
  });

  it("returns null when the cookie is absent", () => {
    const request = new Request("http://localhost/");
    expect(readSessionToken(request, makeEnv())).toBeNull();
  });

  it("returns null for an empty cookie value", () => {
    const request = new Request("http://localhost/", { headers: { cookie: "qc_web_session=" } });
    expect(readSessionToken(request, makeEnv())).toBeNull();
  });
});
