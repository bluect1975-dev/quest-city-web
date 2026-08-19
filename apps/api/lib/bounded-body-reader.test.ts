import { describe, expect, it } from "vitest";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { readBoundedRequestBody } from "./bounded-body-reader";

const MAX_BYTES = 16 * 1024;

function streamOf(chunks: Uint8Array[], opts: { onPull?: (index: number) => void } = {}): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      opts.onPull?.(index);
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index += 1;
      } else {
        controller.close();
      }
    },
  });
}

function poisonedStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull() {
      throw new Error("this stream must never be read -- the Content-Length fast path should have rejected first");
    },
  });
}

/** Minimal stand-in for `Request` -- only `.headers`/`.body` are used by `readBoundedRequestBody`. */
function makeRequest(opts: { contentLength?: string; body: ReadableStream<Uint8Array> | null }): Request {
  const headers = new Headers();
  if (opts.contentLength !== undefined) headers.set("content-length", opts.contentLength);
  return { headers, body: opts.body } as unknown as Request;
}

describe("readBoundedRequestBody (Tranche E2 Level 2 micro-closure gap 1)", () => {
  it("accepts an ASCII body exactly at the byte limit", async () => {
    const bytes = new TextEncoder().encode("a".repeat(MAX_BYTES));
    const request = makeRequest({ body: streamOf([bytes]) });
    const result = await readBoundedRequestBody(request, MAX_BYTES);
    expect(result.byteLength).toBe(MAX_BYTES);
    expect(result.toString("utf8")).toBe("a".repeat(MAX_BYTES));
  });

  it("rejects an ASCII body one byte over the limit, streamed with no Content-Length header", async () => {
    const bytes = new TextEncoder().encode("a".repeat(MAX_BYTES + 1));
    const request = makeRequest({ body: streamOf([bytes]) });
    await expect(readBoundedRequestBody(request, MAX_BYTES)).rejects.toMatchObject({
      code: "EXTERNAL_MONITOR_PAYLOAD_INVALID",
    } satisfies Partial<PlatformAdminError>);
  });

  it("rejects a Unicode body whose CHARACTER count is under the limit but whose UTF-8 BYTE count exceeds it -- the exact bug being fixed", async () => {
    // "€" (U+20AC) is 1 UTF-16 code unit (so `.length` would have under-counted it) but 3 UTF-8 bytes.
    const text = "€".repeat(6000); // .length === 6000 (< 16384) -- but 18000 bytes (> 16384).
    expect(text.length).toBeLessThan(MAX_BYTES);
    const bytes = new TextEncoder().encode(text);
    expect(bytes.byteLength).toBeGreaterThan(MAX_BYTES);
    const request = makeRequest({ body: streamOf([bytes]) });
    await expect(readBoundedRequestBody(request, MAX_BYTES)).rejects.toMatchObject({
      code: "EXTERNAL_MONITOR_PAYLOAD_INVALID",
    } satisfies Partial<PlatformAdminError>);
  });

  it("rejects immediately on a Content-Length header declared above the limit, WITHOUT ever reading the stream", async () => {
    const request = makeRequest({ contentLength: String(MAX_BYTES + 1), body: poisonedStream() });
    await expect(readBoundedRequestBody(request, MAX_BYTES)).rejects.toMatchObject({
      code: "EXTERNAL_MONITOR_PAYLOAD_INVALID",
    } satisfies Partial<PlatformAdminError>);
  });

  it("rejects a chunked/streamed body that exceeds the limit cumulatively, without ever pulling past the chunk that crosses the threshold", async () => {
    const chunk = new Uint8Array(4000).fill(97); // 4000 'a' bytes per chunk, 5 chunks = 20000 > 16384.
    const pulledIndexes: number[] = [];
    const request = makeRequest({
      body: streamOf([chunk, chunk, chunk, chunk, chunk], { onPull: (i) => pulledIndexes.push(i) }),
    });
    await expect(readBoundedRequestBody(request, MAX_BYTES)).rejects.toMatchObject({
      code: "EXTERNAL_MONITOR_PAYLOAD_INVALID",
    } satisfies Partial<PlatformAdminError>);
    // 4 chunks (16000 bytes) is still <= 16384; the 5th chunk (20000 total) crosses it and
    // must stop the read -- never pulling a 6th chunk that was never provided anyway confirms
    // no unbounded continued reading past the violation.
    expect(pulledIndexes.length).toBeLessThanOrEqual(5);
  });

  it("accepts a chunked/streamed body within the limit, concatenating chunks in order", async () => {
    const part1 = new TextEncoder().encode("hello-");
    const part2 = new TextEncoder().encode("world");
    const request = makeRequest({ body: streamOf([part1, part2]) });
    const result = await readBoundedRequestBody(request, MAX_BYTES);
    expect(result.toString("utf8")).toBe("hello-world");
  });

  it("returns an empty buffer for a null body (no stream at all)", async () => {
    const request = makeRequest({ body: null });
    const result = await readBoundedRequestBody(request, MAX_BYTES);
    expect(result.byteLength).toBe(0);
  });

  it("never throws a raw Error for an over-limit body -- always the safe PlatformAdminError, no signature/canonical-string detail leaked", async () => {
    const bytes = new TextEncoder().encode("x".repeat(MAX_BYTES + 10));
    const request = makeRequest({ body: streamOf([bytes]) });
    let caught: unknown;
    try {
      await readBoundedRequestBody(request, MAX_BYTES);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlatformAdminError);
    const asPlatformError = caught as PlatformAdminError;
    expect(asPlatformError.safeDetails).toBeUndefined();
    expect(asPlatformError.message).not.toMatch(/signature|secret|canonical/i);
  });
});
