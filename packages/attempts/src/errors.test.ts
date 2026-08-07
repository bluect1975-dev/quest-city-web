import { describe, expect, it } from "vitest";
import { CrossRuntimeError, CROSS_RUNTIME_ERROR_CODES } from "./errors";

describe("CrossRuntimeError / ErrorEnvelope", () => {
  it("has exactly 8 CROSS_RUNTIME error codes", () => {
    expect(CROSS_RUNTIME_ERROR_CODES).toHaveLength(8);
    expect(CROSS_RUNTIME_ERROR_CODES).toContain("ATTEMPT_NOT_COMPLETABLE");
    expect(CROSS_RUNTIME_ERROR_CODES).toContain("ATTEMPT_ALREADY_CONSOLIDATED");
  });

  it("maps ATTEMPT_NOT_COMPLETABLE to HTTP 409, non-retryable, with safeDetails.reason", () => {
    const err = new CrossRuntimeError("ATTEMPT_NOT_COMPLETABLE", "not completable", { reason: "ABANDONED" });
    const envelope = err.toEnvelope("req_01");
    expect(envelope).toEqual({
      domain: "CROSS_RUNTIME",
      code: "ATTEMPT_NOT_COMPLETABLE",
      httpStatus: 409,
      message: "not completable",
      correlationId: "req_01",
      retryable: false,
      safeDetails: { reason: "ABANDONED" },
    });
  });

  it("maps RUNTIME_CHANNEL_NOT_ALLOWED to HTTP 403", () => {
    const err = new CrossRuntimeError("RUNTIME_CHANNEL_NOT_ALLOWED");
    expect(err.httpStatus).toBe(403);
    expect(err.domain).toBe("CROSS_RUNTIME");
  });

  it("omits safeDetails from the envelope when not provided", () => {
    const err = new CrossRuntimeError("LEGACY_RUNTIME_UNKNOWN", "x");
    const envelope = err.toEnvelope("req_02");
    expect(envelope.safeDetails).toBeUndefined();
    expect("safeDetails" in envelope).toBe(false);
  });
});
