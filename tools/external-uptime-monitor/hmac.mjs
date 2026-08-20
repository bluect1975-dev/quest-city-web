// HMAC-SHA256 request signing for the external monitor's own client side
// (02_42 v1.2 PARTE U §53). A standalone, dependency-free reimplementation
// of packages/operations/src/external-monitor/hmac.ts's algorithm -- NOT an
// import of that workspace package. This is deliberate: the external
// monitor is meant to be an observer independent of the repository's own
// build/workspace health (an out-of-band monitor that can only run if the
// full pnpm workspace resolves is not really "external"), so this module
// uses only Node built-ins (node:crypto) and is byte-for-byte compatible by
// construction -- same canonical-string shape, same hex encodings, verified
// against the exact same known-good vector the workspace package's own
// tests use (see hmac.test.mjs: sha256Hex("") ===
// "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855").

import { createHash, createHmac } from "node:crypto";

/** SHA-256 hex digest of the raw request body bytes (empty body -> hash of the empty string, 02_42 §53). */
export function sha256Hex(rawBodyBytes) {
  return createHash("sha256").update(rawBodyBytes).digest("hex");
}

/**
 * Canonical string exactly as defined by 02_42 §53:
 * `${method}\n${path}\n${timestamp}\n${nonce}\n${sha256hex(body)}` --
 * uppercase HTTP method, exact request path (the path the API server
 * itself sees, i.e. AFTER nginx strips the `/api/` prefix -- see
 * apps/api/lib/external-monitor-request-context.ts's `url.pathname` and
 * feedback_windows_node_script_gotchas item 10), Unix timestamp in
 * seconds, opaque nonce, lowercase-hex SHA-256 of the raw body bytes.
 */
export function buildCanonicalString({ method, path, timestamp, nonce, rawBodyBytes }) {
  return [method.toUpperCase(), path, String(timestamp), nonce, sha256Hex(rawBodyBytes)].join("\n");
}

/** Lowercase-hex HMAC-SHA256 of the canonical string, keyed by the raw secret bytes for the presented keyId (02_42 §53). */
export function computeSignatureHex(canonicalString, secretBytes) {
  return createHmac("sha256", secretBytes).update(canonicalString, "utf8").digest("hex");
}

/**
 * Decodes an `EXTERNAL_MONITOR_HMAC_SECRET` env value (base64) into raw
 * bytes. Mirrors the server-side decode (hmac.ts's
 * `decodeExternalMonitorHmacSecret`) but on the client/signing side --
 * never logs or includes the raw value in any error message.
 */
export function decodeHmacSecret(raw) {
  if (!raw || raw.length === 0) {
    throw new Error("EXTERNAL_MONITOR_HMAC_SECRET is not set.");
  }
  let secret;
  try {
    secret = Buffer.from(raw, "base64");
  } catch {
    throw new Error("EXTERNAL_MONITOR_HMAC_SECRET is not valid base64.");
  }
  if (secret.length < 32) {
    throw new Error(`EXTERNAL_MONITOR_HMAC_SECRET must decode to at least 32 bytes, got ${secret.length}.`);
  }
  return secret;
}

/**
 * Builds the full X-QC-Monitor-* header set for a signed request (02_42
 * §53). `nonce` must be unique per (keyId, nonce) -- callers pass a fresh
 * `crypto.randomUUID()` per request (36 chars, within the 16-128 bound).
 */
export function signRequest({ method, path, bodyBytes, secretBytes, keyId, nonce, timestampSeconds }) {
  const timestamp = String(timestampSeconds ?? Math.floor(Date.now() / 1000));
  const canonicalString = buildCanonicalString({ method, path, timestamp, nonce, rawBodyBytes: bodyBytes });
  const signature = computeSignatureHex(canonicalString, secretBytes);
  return {
    "X-QC-Monitor-Timestamp": timestamp,
    "X-QC-Monitor-Nonce": nonce,
    "X-QC-Monitor-Signature": signature,
    "X-QC-Monitor-Key-Id": keyId,
  };
}
