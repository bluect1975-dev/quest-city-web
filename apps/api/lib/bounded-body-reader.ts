import { PlatformAdminError } from "@quest-city-web/platform-admin";

/**
 * Reads a `Request` body as raw bytes, bounded by `maxBytes`, without ever
 * materializing more than `maxBytes` (plus at most one final chunk's
 * worth) in memory -- the fix for the Tranche E2 Level 2 micro-closure
 * gap 1 finding: `request.text()` followed by a `.length` comparison is
 * neither byte-safe (`String.length` counts UTF-16 code units, not UTF-8
 * bytes -- a body under the character limit can still exceed it in
 * bytes) nor memory-safe (the full body is materialized before the check
 * ever runs).
 *
 * Two independent layers, per the mission spec's own preference order:
 * (1) an immediate `Content-Length`-based rejection when the header is
 * present and already over the limit -- cheapest possible check, never
 * even opens the stream reader; (2) a genuine bounded streaming read that
 * enforces the limit on the ACTUAL bytes received regardless of what
 * `Content-Length` claimed (a lying/absent header, or chunked transfer
 * encoding, still gets caught here) -- this second layer is the real
 * enforcement, the first is purely an optimization.
 *
 * Returns the exact bytes read (never decoded) so callers can compute
 * SHA-256/HMAC over the real wire bytes (02_42 v1.2 §53's canonical
 * string is defined over the raw body) rather than over a UTF-8
 * re-encoding of an already-decoded string, which can silently diverge
 * from the original bytes for any body containing invalid UTF-8
 * sequences (`String`-based decoding replaces those with U+FFFD).
 */
export async function readBoundedRequestBody(request: Request, maxBytes: number): Promise<Buffer> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declaredBytes = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new PlatformAdminError("EXTERNAL_MONITOR_PAYLOAD_INVALID", "Request body exceeds the maximum allowed size.");
    }
  }

  const bodyStream = request.body;
  if (!bodyStream) {
    return Buffer.alloc(0);
  }

  const reader = bodyStream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      // Stop reading immediately -- never buffer the remainder of an
      // over-limit body, chunked or not.
      await reader.cancel().catch(() => {});
      throw new PlatformAdminError("EXTERNAL_MONITOR_PAYLOAD_INVALID", "Request body exceeds the maximum allowed size.");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
