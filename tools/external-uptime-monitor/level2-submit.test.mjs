import { describe, it, expect, vi } from "vitest";
import { buildReportBody, submitLevel2Report, SIGNED_PATH } from "./level2-submit.mjs";

const SECRET = Buffer.alloc(32, 3);
const CONDITION = { service: "TLS", conditionType: "TLS_EXPIRY_WARNING", summaryCode: "CERTIFICATE_EXPIRED_SOON", evidence: { httpStatus: null, latencyMs: null, tlsDaysRemaining: 5, backupAgeHours: null, consecutiveFailures: 0 } };

describe("buildReportBody", () => {
  it("never includes a severity field (02_42 §56/§72 principle 4)", () => {
    const body = buildReportBody({ monitorId: "m", observationId: "o", observedAt: "2026-08-20T00:00:00Z", environment: "PRODUCTION", condition: CONDITION, state: "DETECTED" });
    expect("severity" in body).toBe(false);
  });

  it("defaults backfill=false, detectedAt=null, resolvedAt=null for a normal (non-backfill) report", () => {
    const body = buildReportBody({ monitorId: "m", observationId: "o", observedAt: "2026-08-20T00:00:00Z", environment: "PRODUCTION", condition: CONDITION, state: "DETECTED" });
    expect(body.backfill).toBe(false);
    expect(body.detectedAt).toBeNull();
    expect(body.resolvedAt).toBeNull();
  });

  it("carries backfill=true with detectedAt/resolvedAt through unchanged", () => {
    const body = buildReportBody({
      monitorId: "m",
      observationId: "o",
      observedAt: "2026-08-20T00:10:00Z",
      environment: "PRODUCTION",
      condition: { service: "HOST", conditionType: "VPS_UNREACHABLE", summaryCode: "CONNECT_REFUSED", evidence: { httpStatus: null, latencyMs: null, tlsDaysRemaining: null, backupAgeHours: null, consecutiveFailures: 3 } },
      state: "RECOVERED",
      backfill: true,
      detectedAt: "2026-08-20T00:00:00Z",
      resolvedAt: "2026-08-20T00:10:00Z",
    });
    expect(body.backfill).toBe(true);
    expect(body.detectedAt).toBe("2026-08-20T00:00:00Z");
    expect(body.resolvedAt).toBe("2026-08-20T00:10:00Z");
    expect(body.state).toBe("RECOVERED");
  });

  it("maps the condition's service/conditionType/summaryCode/evidence into the body verbatim", () => {
    const body = buildReportBody({ monitorId: "m", observationId: "o", observedAt: "t", environment: "STAGING", condition: CONDITION, state: "DETECTED" });
    expect(body.service).toBe("TLS");
    expect(body.conditionType).toBe("TLS_EXPIRY_WARNING");
    expect(body.summaryCode).toBe("CERTIFICATE_EXPIRED_SOON");
    expect(body.evidence).toEqual(CONDITION.evidence);
  });
});

describe("submitLevel2Report", () => {
  it("requests the client-facing /api-prefixed URL while signing the POST-strip path (nginx strip gotcha)", async () => {
    const fetchImpl = vi.fn(async (url) => ({ ok: true, status: 200, json: async () => ({ data: { incidentPublicId: "inc_1", status: "OPEN", deduped: false, alertTriggered: true } }) }));
    const body = buildReportBody({ monitorId: "m", observationId: "11111111-1111-1111-1111-111111111111", observedAt: "2026-08-20T00:00:00Z", environment: "PRODUCTION", condition: CONDITION, state: "DETECTED" });

    await submitLevel2Report({ apiBaseUrl: "https://staging.example.com", secretBytes: SECRET, keyId: "k1", body }, { fetchImpl, nonce: "test-nonce" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(`https://staging.example.com/api${SIGNED_PATH}`);
  });

  it("signs with the exact SIGNED_PATH (never the /api-prefixed client path)", async () => {
    let capturedHeaders;
    const signRequestImpl = (input) => {
      expect(input.path).toBe(SIGNED_PATH);
      capturedHeaders = { "X-QC-Monitor-Timestamp": "1", "X-QC-Monitor-Nonce": "n", "X-QC-Monitor-Signature": "sig", "X-QC-Monitor-Key-Id": "k1" };
      return capturedHeaders;
    };
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const body = buildReportBody({ monitorId: "m", observationId: "11111111-1111-1111-1111-111111111111", observedAt: "t", environment: "PRODUCTION", condition: CONDITION, state: "DETECTED" });

    await submitLevel2Report({ apiBaseUrl: "https://x.example.com", secretBytes: SECRET, keyId: "k1", body }, { fetchImpl, nonce: "n", signRequestImpl });

    const [, options] = fetchImpl.mock.calls[0];
    expect(options.headers["X-QC-Monitor-Signature"]).toBe("sig");
  });

  it("sends the exact bytes of JSON.stringify(body) as the request body", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const body = buildReportBody({ monitorId: "m", observationId: "11111111-1111-1111-1111-111111111111", observedAt: "t", environment: "PRODUCTION", condition: CONDITION, state: "DETECTED" });

    await submitLevel2Report({ apiBaseUrl: "https://x.example.com", secretBytes: SECRET, keyId: "k1", body }, { fetchImpl, nonce: "n" });

    const [, options] = fetchImpl.mock.calls[0];
    expect(options.body.toString("utf8")).toBe(JSON.stringify(body));
  });

  it("returns ok=false with a captured error code on a non-2xx response, never throwing", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ code: "EXTERNAL_MONITOR_REPLAY_DETECTED" }) }));
    const body = buildReportBody({ monitorId: "m", observationId: "11111111-1111-1111-1111-111111111111", observedAt: "t", environment: "PRODUCTION", condition: CONDITION, state: "DETECTED" });

    const result = await submitLevel2Report({ apiBaseUrl: "https://x.example.com", secretBytes: SECRET, keyId: "k1", body }, { fetchImpl, nonce: "n" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.error).toBe("EXTERNAL_MONITOR_REPLAY_DETECTED");
  });

  it("returns ok=false on a network-level failure (fetch throws), never propagating the exception", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const body = buildReportBody({ monitorId: "m", observationId: "11111111-1111-1111-1111-111111111111", observedAt: "t", environment: "PRODUCTION", condition: CONDITION, state: "DETECTED" });

    const result = await submitLevel2Report({ apiBaseUrl: "https://x.example.com", secretBytes: SECRET, keyId: "k1", body }, { fetchImpl, nonce: "n" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/network unreachable/);
  });

  it("passes an AbortSignal derived from timeoutMs so a hung request cannot block indefinitely", async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const body = buildReportBody({ monitorId: "m", observationId: "11111111-1111-1111-1111-111111111111", observedAt: "t", environment: "PRODUCTION", condition: CONDITION, state: "DETECTED" });

    await submitLevel2Report({ apiBaseUrl: "https://x.example.com", secretBytes: SECRET, keyId: "k1", body, timeoutMs: 5000 }, { fetchImpl, nonce: "n" });

    expect(fetchImpl).toHaveBeenCalled();
  });
});
