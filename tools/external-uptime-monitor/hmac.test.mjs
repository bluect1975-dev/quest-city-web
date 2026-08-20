import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { sha256Hex, buildCanonicalString, computeSignatureHex, decodeHmacSecret, signRequest } from "./hmac.mjs";
// Cross-checked against the REAL server-side implementation the API
// verifies against -- the strongest possible proof of byte-for-byte
// compatibility (mission requirement §13), not just a re-derivation of the
// same spec independently.
import {
  sha256Hex as serverSha256Hex,
  buildCanonicalString as serverBuildCanonicalString,
  computeSignatureHex as serverComputeSignatureHex,
} from "@quest-city-web/operations";

const SECRET = Buffer.alloc(32, 7);

describe("sha256Hex", () => {
  it("matches the known-good empty-string vector (same as the server's own test suite)", () => {
    expect(sha256Hex(Buffer.alloc(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the server-side implementation for arbitrary bytes", () => {
    const bytes = Buffer.from('{"a":1,"b":"x"}', "utf8");
    expect(sha256Hex(bytes)).toBe(serverSha256Hex(bytes));
  });
});

describe("buildCanonicalString", () => {
  it("produces the exact 02_42 §53 shape: METHOD\\npath\\ntimestamp\\nnonce\\nsha256hex(body)", () => {
    const bodyBytes = Buffer.from('{"a":1}', "utf8");
    const canonical = buildCanonicalString({ method: "post", path: "/platform/operations/external-monitor-report", timestamp: "1700000000", nonce: "abc-nonce", rawBodyBytes: bodyBytes });
    const expected = ["POST", "/platform/operations/external-monitor-report", "1700000000", "abc-nonce", sha256Hex(bodyBytes)].join("\n");
    expect(canonical).toBe(expected);
  });

  it("matches the server-side buildCanonicalString for identical inputs, byte-for-byte", () => {
    const bodyBytes = Buffer.from(JSON.stringify({ x: 1, y: [1, 2, 3] }), "utf8");
    const input = { method: "POST", path: "/platform/operations/external-monitor-report", timestamp: "1700000042", nonce: "cross-check-nonce" };
    const client = buildCanonicalString({ ...input, rawBodyBytes: bodyBytes });
    const server = serverBuildCanonicalString({ ...input, rawBody: bodyBytes });
    expect(client).toBe(server);
  });

  it("uppercases method regardless of caller casing", () => {
    const canonical = buildCanonicalString({ method: "post", path: "/x", timestamp: "1", nonce: "n", rawBodyBytes: Buffer.alloc(0) });
    expect(canonical.startsWith("POST\n")).toBe(true);
  });

  it("hashes the empty body as the empty-string SHA-256", () => {
    const canonical = buildCanonicalString({ method: "GET", path: "/x", timestamp: "1", nonce: "n", rawBodyBytes: Buffer.alloc(0) });
    expect(canonical.endsWith("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(true);
  });
});

describe("computeSignatureHex", () => {
  it("matches the server-side computeSignatureHex for the same canonical string and secret", () => {
    const canonical = buildCanonicalString({ method: "POST", path: "/x", timestamp: "1", nonce: "n", rawBodyBytes: Buffer.from("{}") });
    const client = computeSignatureHex(canonical, SECRET);
    const server = serverComputeSignatureHex(canonical, SECRET);
    expect(client).toBe(server);
  });

  it("is deterministic for identical inputs", () => {
    const canonical = buildCanonicalString({ method: "POST", path: "/x", timestamp: "1", nonce: "n", rawBodyBytes: Buffer.from("{}") });
    expect(computeSignatureHex(canonical, SECRET)).toBe(computeSignatureHex(canonical, SECRET));
  });

  it("differs for a different secret", () => {
    const canonical = buildCanonicalString({ method: "POST", path: "/x", timestamp: "1", nonce: "n", rawBodyBytes: Buffer.from("{}") });
    expect(computeSignatureHex(canonical, SECRET)).not.toBe(computeSignatureHex(canonical, Buffer.alloc(32, 9)));
  });
});

describe("decodeHmacSecret", () => {
  it("decodes a valid base64 secret of sufficient length", () => {
    const raw = randomBytes(32).toString("base64");
    const decoded = decodeHmacSecret(raw);
    expect(decoded.length).toBe(32);
  });

  it("throws, without echoing the value, when unset", () => {
    expect(() => decodeHmacSecret(undefined)).toThrow(/not set/);
    expect(() => decodeHmacSecret("")).toThrow(/not set/);
  });

  it("throws when the decoded secret is shorter than 32 bytes", () => {
    const raw = Buffer.alloc(8, 1).toString("base64");
    expect(() => decodeHmacSecret(raw)).toThrow(/at least 32 bytes/);
  });

  it("error message never contains the raw secret value", () => {
    const raw = "not-valid-base64-!!!@@@";
    try {
      decodeHmacSecret(raw);
      throw new Error("expected decodeHmacSecret to throw");
    } catch (error) {
      expect(String(error.message)).not.toContain(raw);
    }
  });
});

describe("signRequest", () => {
  it("produces the exact X-QC-Monitor-* header quartet", () => {
    const headers = signRequest({
      method: "POST",
      path: "/platform/operations/external-monitor-report",
      bodyBytes: Buffer.from("{}"),
      secretBytes: SECRET,
      keyId: "monitor-key-2026-08",
      nonce: "fixed-test-nonce-0001",
      timestampSeconds: 1700000000,
    });
    expect(Object.keys(headers).sort()).toEqual([
      "X-QC-Monitor-Key-Id",
      "X-QC-Monitor-Nonce",
      "X-QC-Monitor-Signature",
      "X-QC-Monitor-Timestamp",
    ]);
    expect(headers["X-QC-Monitor-Timestamp"]).toBe("1700000000");
    expect(headers["X-QC-Monitor-Nonce"]).toBe("fixed-test-nonce-0001");
    expect(headers["X-QC-Monitor-Key-Id"]).toBe("monitor-key-2026-08");
    expect(headers["X-QC-Monitor-Signature"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the produced signature is exactly what a server verifying with the same secret would recompute", () => {
    const bodyBytes = Buffer.from(JSON.stringify({ monitorId: "github-actions:questcity-external-monitor" }), "utf8");
    const headers = signRequest({
      method: "POST",
      path: "/platform/operations/external-monitor-report",
      bodyBytes,
      secretBytes: SECRET,
      keyId: "k1",
      nonce: "n1",
      timestampSeconds: 1700000123,
    });
    const serverCanonical = serverBuildCanonicalString({
      method: "POST",
      path: "/platform/operations/external-monitor-report",
      timestamp: "1700000123",
      nonce: "n1",
      rawBody: bodyBytes,
    });
    const serverSignature = serverComputeSignatureHex(serverCanonical, SECRET);
    expect(headers["X-QC-Monitor-Signature"]).toBe(serverSignature);
  });

  it("defaults the timestamp to the current time in seconds when not provided", () => {
    const before = Math.floor(Date.now() / 1000);
    const headers = signRequest({ method: "POST", path: "/x", bodyBytes: Buffer.alloc(0), secretBytes: SECRET, keyId: "k", nonce: "n" });
    const after = Math.floor(Date.now() / 1000);
    const ts = Number(headers["X-QC-Monitor-Timestamp"]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
