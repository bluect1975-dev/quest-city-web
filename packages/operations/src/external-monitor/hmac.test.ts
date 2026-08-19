import { describe, expect, it } from "vitest";
import {
  decodeExternalMonitorHmacSecret,
  ExternalMonitorHmacSecretError,
  sha256Hex,
  buildCanonicalString,
  computeSignatureHex,
  signaturesMatch,
} from "./hmac";

const SECRET = Buffer.alloc(32, 7);

describe("decodeExternalMonitorHmacSecret (02_42 v1.2 §53)", () => {
  it("decodes a valid base64 secret of sufficient length", () => {
    const raw = SECRET.toString("base64");
    expect(decodeExternalMonitorHmacSecret(raw)).toEqual(SECRET);
  });

  it("rejects an unset value", () => {
    expect(() => decodeExternalMonitorHmacSecret(undefined)).toThrow(ExternalMonitorHmacSecretError);
  });

  it("rejects an empty string", () => {
    expect(() => decodeExternalMonitorHmacSecret("")).toThrow(ExternalMonitorHmacSecretError);
  });

  it("rejects a secret shorter than 32 bytes", () => {
    const short = Buffer.alloc(16, 1).toString("base64");
    expect(() => decodeExternalMonitorHmacSecret(short)).toThrow(ExternalMonitorHmacSecretError);
  });
});

describe("sha256Hex / buildCanonicalString (02_42 v1.2 §53)", () => {
  it("hashes the empty string deterministically", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("builds the canonical string in the exact contract order", () => {
    const canonical = buildCanonicalString({
      method: "post",
      path: "/platform/operations/external-monitor-report",
      timestamp: "1700000000",
      nonce: "nonce-value-0123456789",
      rawBody: '{"a":1}',
    });
    const expected = [
      "POST",
      "/platform/operations/external-monitor-report",
      "1700000000",
      "nonce-value-0123456789",
      sha256Hex('{"a":1}'),
    ].join("\n");
    expect(canonical).toBe(expected);
  });

  it("uppercases the method even when given lowercase", () => {
    const canonical = buildCanonicalString({ method: "post", path: "/x", timestamp: "1", nonce: "n", rawBody: "" });
    expect(canonical.startsWith("POST\n")).toBe(true);
  });

  it("hashing a Buffer of the same UTF-8 bytes as a string produces the identical digest (production Buffer path == test string-convenience path)", () => {
    const text = "hello world";
    expect(sha256Hex(Buffer.from(text, "utf8"))).toBe(sha256Hex(text));
  });

  it("hashes the real bytes of a body containing invalid UTF-8, never a lossy re-encoding -- byte-safety gain of the micro-closure fix", () => {
    // 0xFF is not valid UTF-8 anywhere; decoding it as a string first would
    // replace it with U+FFFD (as `request.text()` does), so hashing that
    // decoded-then-re-encoded string would NOT reproduce these exact bytes.
    const invalidUtf8Bytes = Buffer.from([0x7b, 0xff, 0x7d]); // '{', 0xFF, '}'
    const lossyRoundTrip = Buffer.from(invalidUtf8Bytes.toString("utf8"), "utf8");
    expect(lossyRoundTrip.equals(invalidUtf8Bytes)).toBe(false); // proves the round-trip is genuinely lossy
    expect(sha256Hex(invalidUtf8Bytes)).not.toBe(sha256Hex(lossyRoundTrip)); // the two hashes must differ
  });
});

describe("computeSignatureHex / signaturesMatch (02_42 v1.2 §53.4)", () => {
  it("recomputing the same canonical string with the same secret produces a matching signature", () => {
    const canonical = buildCanonicalString({ method: "POST", path: "/x", timestamp: "1", nonce: "n", rawBody: "{}" });
    const sig1 = computeSignatureHex(canonical, SECRET);
    const sig2 = computeSignatureHex(canonical, SECRET);
    expect(sig1).toBe(sig2);
    expect(signaturesMatch(sig1, sig2)).toBe(true);
  });

  it("a different secret produces a non-matching signature", () => {
    const canonical = buildCanonicalString({ method: "POST", path: "/x", timestamp: "1", nonce: "n", rawBody: "{}" });
    const sigA = computeSignatureHex(canonical, SECRET);
    const sigB = computeSignatureHex(canonical, Buffer.alloc(32, 9));
    expect(signaturesMatch(sigA, sigB)).toBe(false);
  });

  it("a single-byte-different canonical string produces a non-matching signature", () => {
    const canonicalA = buildCanonicalString({ method: "POST", path: "/x", timestamp: "1", nonce: "n", rawBody: "{}" });
    const canonicalB = buildCanonicalString({ method: "POST", path: "/x", timestamp: "2", nonce: "n", rawBody: "{}" });
    const sigA = computeSignatureHex(canonicalA, SECRET);
    const sigB = computeSignatureHex(canonicalB, SECRET);
    expect(signaturesMatch(sigA, sigB)).toBe(false);
  });

  it("fails closed (returns false, never throws) on a malformed presented signature", () => {
    expect(signaturesMatch("not-hex-zzz", computeSignatureHex("x", SECRET))).toBe(false);
    expect(signaturesMatch("", computeSignatureHex("x", SECRET))).toBe(false);
  });

  it("fails closed on a presented signature of a different length (no length-leak crash)", () => {
    expect(signaturesMatch("ab", computeSignatureHex("x", SECRET))).toBe(false);
  });
});
