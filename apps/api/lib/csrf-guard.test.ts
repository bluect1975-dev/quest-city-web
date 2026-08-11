import { describe, expect, it } from "vitest";
import { getCsrfTokenHeader, isTrustedOrigin } from "./csrf-guard";
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
    ...overrides,
  };
}

describe("getCsrfTokenHeader", () => {
  it("reads X-CSRF-Token", () => {
    const request = new Request("http://localhost/", { headers: { "x-csrf-token": "abc" } });
    expect(getCsrfTokenHeader(request)).toBe("abc");
  });

  it("returns null when absent", () => {
    expect(getCsrfTokenHeader(new Request("http://localhost/"))).toBeNull();
  });
});

describe("isTrustedOrigin", () => {
  it("trusts Sec-Fetch-Site: same-origin regardless of the Origin header value", () => {
    const request = new Request("http://localhost/", {
      headers: { "sec-fetch-site": "same-origin", origin: "https://evil.example" },
    });
    expect(isTrustedOrigin(request, makeEnv())).toBe(true);
  });

  it("rejects Sec-Fetch-Site: cross-site", () => {
    const request = new Request("http://localhost/", { headers: { "sec-fetch-site": "cross-site" } });
    expect(isTrustedOrigin(request, makeEnv())).toBe(false);
  });

  it("falls back to the Origin allow-list when Sec-Fetch-Site is absent", () => {
    const trusted = new Request("http://localhost/", { headers: { origin: "http://localhost:3000" } });
    expect(isTrustedOrigin(trusted, makeEnv())).toBe(true);

    const untrusted = new Request("http://localhost/", { headers: { origin: "https://evil.example" } });
    expect(isTrustedOrigin(untrusted, makeEnv())).toBe(false);
  });

  it("fails closed when neither Sec-Fetch-Site nor Origin is present", () => {
    const request = new Request("http://localhost/");
    expect(isTrustedOrigin(request, makeEnv())).toBe(false);
  });
});
