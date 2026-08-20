import { describe, it, expect } from "vitest";
import { runProbe } from "./probe.mjs";

const BASE_CONFIG = { host: "example.invalid", tlsPort: 443, healthUrl: "https://example.invalid/api/health/ready", timeoutMs: 5000 };

function deps({ tcp, tlsResult, http }) {
  return {
    checkTcpReachable: async () => tcp,
    checkTlsHandshake: async () => tlsResult,
    checkHttpHealth: async () => http,
  };
}

describe("runProbe — Level 1 (unreachable) classification", () => {
  it("VPS_UNREACHABLE when TCP connect fails with DNS resolution failure", async () => {
    const result = await runProbe(BASE_CONFIG, deps({ tcp: { ok: false, summaryCode: "DNS_RESOLUTION_FAILED" }, tlsResult: null, http: null }));
    expect(result.reachable).toBe(false);
    expect(result.level1.conditionType).toBe("VPS_UNREACHABLE");
    expect(result.level1.service).toBe("HOST");
    expect(result.level1.summaryCode).toBe("DNS_RESOLUTION_FAILED");
    expect(result.level2Conditions).toEqual([]);
  });

  it("VPS_UNREACHABLE when TCP connect is refused", async () => {
    const result = await runProbe(BASE_CONFIG, deps({ tcp: { ok: false, summaryCode: "CONNECT_REFUSED" }, tlsResult: null, http: null }));
    expect(result.level1.conditionType).toBe("VPS_UNREACHABLE");
    expect(result.level1.summaryCode).toBe("CONNECT_REFUSED");
  });

  it("TLS_HANDSHAKE_FAILURE when TCP succeeds but TLS handshake fails", async () => {
    const result = await runProbe(
      BASE_CONFIG,
      deps({ tcp: { ok: true }, tlsResult: { ok: false, summaryCode: "TLS_HANDSHAKE_ERROR" }, http: null }),
    );
    expect(result.reachable).toBe(false);
    expect(result.level1.conditionType).toBe("TLS_HANDSHAKE_FAILURE");
    expect(result.level1.service).toBe("TLS");
  });

  it("REVERSE_PROXY_UNREACHABLE when TCP+TLS succeed but the HTTP health request fails", async () => {
    const result = await runProbe(
      BASE_CONFIG,
      deps({
        tcp: { ok: true },
        tlsResult: { ok: true, daysRemaining: 200 },
        http: { ok: false, status: null, latencyMs: 5000, summaryCode: "CONNECT_TIMEOUT" },
      }),
    );
    expect(result.reachable).toBe(false);
    expect(result.level1.conditionType).toBe("REVERSE_PROXY_UNREACHABLE");
    expect(result.level1.service).toBe("REVERSE_PROXY");
    expect(result.level1.evidence.tlsDaysRemaining).toBe(200);
  });

  it("REVERSE_PROXY_UNREACHABLE on a non-2xx HTTP status", async () => {
    const result = await runProbe(
      BASE_CONFIG,
      deps({ tcp: { ok: true }, tlsResult: { ok: true, daysRemaining: 200 }, http: { ok: false, status: 502, latencyMs: 120 } }),
    );
    expect(result.level1.conditionType).toBe("REVERSE_PROXY_UNREACHABLE");
    expect(result.level1.evidence.httpStatus).toBe(502);
    expect(result.level1.summaryCode).toBe("HTTP_STATUS_ERROR");
  });
});

describe("runProbe — fully healthy", () => {
  it("reachable=true with zero Level 2 conditions when everything is nominal", async () => {
    const result = await runProbe(
      BASE_CONFIG,
      deps({ tcp: { ok: true }, tlsResult: { ok: true, daysRemaining: 200 }, http: { ok: true, status: 200, latencyMs: 80 } }),
    );
    expect(result.reachable).toBe(true);
    expect(result.level1).toBeNull();
    expect(result.level2Conditions).toEqual([]);
  });
});

describe("runProbe — Level 2 (degraded but reachable) classification", () => {
  it("TLS_EXPIRY_WARNING when the certificate has fewer days remaining than the threshold", async () => {
    const result = await runProbe(
      { ...BASE_CONFIG, tlsExpiryWarningDays: 14 },
      deps({ tcp: { ok: true }, tlsResult: { ok: true, daysRemaining: 5 }, http: { ok: true, status: 200, latencyMs: 80 } }),
    );
    expect(result.reachable).toBe(true);
    const tlsCondition = result.level2Conditions.find((c) => c.conditionType === "TLS_EXPIRY_WARNING");
    expect(tlsCondition).toBeTruthy();
    expect(tlsCondition.service).toBe("TLS");
    expect(tlsCondition.summaryCode).toBe("CERTIFICATE_EXPIRED_SOON");
    expect(tlsCondition.evidence.tlsDaysRemaining).toBe(5);
  });

  it("does NOT raise TLS_EXPIRY_WARNING when days remaining is at or above the threshold", async () => {
    const result = await runProbe(
      { ...BASE_CONFIG, tlsExpiryWarningDays: 14 },
      deps({ tcp: { ok: true }, tlsResult: { ok: true, daysRemaining: 14 }, http: { ok: true, status: 200, latencyMs: 80 } }),
    );
    expect(result.level2Conditions.find((c) => c.conditionType === "TLS_EXPIRY_WARNING")).toBeUndefined();
  });

  it("EXTERNAL_HTTP_DEGRADED when latency exceeds the threshold while still reachable", async () => {
    const result = await runProbe(
      { ...BASE_CONFIG, httpLatencyThresholdMs: 3000 },
      deps({ tcp: { ok: true }, tlsResult: { ok: true, daysRemaining: 200 }, http: { ok: true, status: 200, latencyMs: 4500 } }),
    );
    expect(result.reachable).toBe(true);
    const degraded = result.level2Conditions.find((c) => c.conditionType === "EXTERNAL_HTTP_DEGRADED");
    expect(degraded).toBeTruthy();
    expect(degraded.service).toBe("API");
    expect(degraded.evidence.latencyMs).toBe(4500);
  });

  it("can raise BOTH TLS_EXPIRY_WARNING and EXTERNAL_HTTP_DEGRADED simultaneously", async () => {
    const result = await runProbe(
      { ...BASE_CONFIG, tlsExpiryWarningDays: 14, httpLatencyThresholdMs: 3000 },
      deps({ tcp: { ok: true }, tlsResult: { ok: true, daysRemaining: 3 }, http: { ok: true, status: 200, latencyMs: 5000 } }),
    );
    expect(result.level2Conditions).toHaveLength(2);
    const types = result.level2Conditions.map((c) => c.conditionType).sort();
    expect(types).toEqual(["EXTERNAL_HTTP_DEGRADED", "TLS_EXPIRY_WARNING"]);
  });
});

describe("runProbe — only canonical condition types/services/summary codes are ever produced", () => {
  const CANONICAL_CONDITION_TYPES = new Set([
    "VPS_UNREACHABLE",
    "REVERSE_PROXY_UNREACHABLE",
    "TLS_HANDSHAKE_FAILURE",
    "BACKUP_FAILED",
    "EXTERNAL_HTTP_DEGRADED",
    "BACKUP_STALE",
    "TLS_EXPIRY_WARNING",
  ]);
  const CANONICAL_SERVICES = new Set(["HOST", "REVERSE_PROXY", "API", "DATABASE", "BACKUP", "TLS"]);

  it("every produced conditionType/service is one of the canonical 02_42 §57/§56 values", async () => {
    const scenarios = [
      deps({ tcp: { ok: false, summaryCode: "DNS_RESOLUTION_FAILED" }, tlsResult: null, http: null }),
      deps({ tcp: { ok: true }, tlsResult: { ok: false, summaryCode: "TLS_HANDSHAKE_ERROR" }, http: null }),
      deps({ tcp: { ok: true }, tlsResult: { ok: true, daysRemaining: 200 }, http: { ok: false, status: 500, latencyMs: 10 } }),
      deps({ tcp: { ok: true }, tlsResult: { ok: true, daysRemaining: 1 }, http: { ok: true, status: 200, latencyMs: 9000 } }),
    ];
    for (const d of scenarios) {
      const result = await runProbe(BASE_CONFIG, d);
      if (result.level1) {
        expect(CANONICAL_CONDITION_TYPES.has(result.level1.conditionType)).toBe(true);
        expect(CANONICAL_SERVICES.has(result.level1.service)).toBe(true);
      }
      for (const c of result.level2Conditions) {
        expect(CANONICAL_CONDITION_TYPES.has(c.conditionType)).toBe(true);
        expect(CANONICAL_SERVICES.has(c.service)).toBe(true);
      }
    }
  });
});
