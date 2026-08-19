import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 request signing for the external monitor (02_42 v1.2 PARTE
 * U §53). A fourth, dedicated machine-to-machine authentication mechanism
 * -- never a session cookie, CSRF token, Basic Auth, user credential, or a
 * static secret without the nonce/timestamp/signature triple. Mirrors
 * `packages/identity/src/crypto/class-code.ts`'s
 * `decodeClassCodePepper`/`compareClassCodeHash` shape (byte-secret
 * decode + constant-time compare), but declared here rather than in
 * `@quest-city-web/identity` since this secret is operations-domain
 * specific and never touches identity/session concerns.
 */
export const EXTERNAL_MONITOR_HMAC_SECRET_MIN_BYTES = 32;

export class ExternalMonitorHmacSecretError extends Error {}

/**
 * Decodes and validates an `EXTERNAL_MONITOR_HMAC_SECRET` env value
 * (base64). Never includes the raw value in its error messages -- only
 * lengths and the variable name -- so a validation failure can be logged
 * safely (02_42 §53, AGENTS.md §4.31 rule 3: this secret is server-side
 * only, never a log, never an API response).
 */
export function decodeExternalMonitorHmacSecret(raw: string | undefined): Buffer {
  if (!raw || raw.length === 0) {
    throw new ExternalMonitorHmacSecretError("EXTERNAL_MONITOR_HMAC_SECRET is not set.");
  }
  let secret: Buffer;
  try {
    secret = Buffer.from(raw, "base64");
  } catch {
    throw new ExternalMonitorHmacSecretError("EXTERNAL_MONITOR_HMAC_SECRET is not valid base64.");
  }
  if (secret.length < EXTERNAL_MONITOR_HMAC_SECRET_MIN_BYTES) {
    throw new ExternalMonitorHmacSecretError(
      `EXTERNAL_MONITOR_HMAC_SECRET must decode to at least ${EXTERNAL_MONITOR_HMAC_SECRET_MIN_BYTES} bytes, got ${secret.length}.`,
    );
  }
  return secret;
}

/**
 * SHA-256 hex digest of the raw request body (empty body -> hash of the
 * empty string, 02_42 §53). Accepts either the actual raw bytes
 * (`Uint8Array`/`Buffer` -- the production path, via
 * `readBoundedRequestBody`) or a plain `string` (unit-test convenience,
 * encoded as UTF-8 before hashing). Hashing the real bytes directly,
 * rather than a UTF-8 re-encoding of an already-`request.text()`-decoded
 * string, matters: decoding first replaces any invalid UTF-8 byte
 * sequence with U+FFFD, so re-encoding no longer reproduces the exact
 * bytes the caller actually signed -- a body containing invalid UTF-8
 * would then fail signature verification even with a correct signature.
 */
export function sha256Hex(rawBody: string | Uint8Array): string {
  const bytes = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Canonical string exactly as defined by 02_42 §53:
 * `${method}\n${path}\n${timestamp}\n${nonce}\n${sha256hex(body)}` --
 * uppercase HTTP method, exact request path, Unix timestamp in seconds,
 * opaque nonce, lowercase-hex SHA-256 of the raw body. Never re-derived
 * differently in two places (mirrors `buildIncidentDedupKey`'s own
 * single-source-of-truth rationale, operational-incident-repository.ts).
 */
export function buildCanonicalString(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string | Uint8Array;
}): string {
  return [input.method.toUpperCase(), input.path, input.timestamp, input.nonce, sha256Hex(input.rawBody)].join("\n");
}

/** Lowercase-hex HMAC-SHA256 of the canonical string, keyed by the secret for the presented keyId (02_42 §53). */
export function computeSignatureHex(canonicalString: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(canonicalString, "utf8").digest("hex");
}

/**
 * Constant-time comparison of the presented signature against the
 * recomputed one -- never a naive string/`===` comparison, to avoid a
 * timing oracle (02_42 §53.4, §67). Returns false (never throws) for any
 * malformed presented signature, so a caller can fail closed uniformly.
 */
export function signaturesMatch(presentedHex: string, expectedHex: string): boolean {
  let presented: Buffer;
  try {
    presented = Buffer.from(presentedHex, "hex");
  } catch {
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  if (presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(presented, expected);
}
