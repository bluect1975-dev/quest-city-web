import { describe, expect, it } from "vitest";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { requirePlatformIdempotencyKey } from "./platform-validation";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/platform/tenants", { method: "POST", headers });
}

describe("requirePlatformIdempotencyKey", () => {
  it("throws VALIDATION_ERROR when the header is missing (02_26 v1.10 §32.4)", () => {
    expect(() => requirePlatformIdempotencyKey(makeRequest())).toThrow(PlatformAdminError);
    try {
      requirePlatformIdempotencyKey(makeRequest());
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformAdminError);
      expect((error as PlatformAdminError).code).toBe("VALIDATION_ERROR");
      expect((error as PlatformAdminError).httpStatus).toBe(400);
    }
  });

  it("throws VALIDATION_ERROR when the header is shorter than 16 characters", () => {
    expect(() => requirePlatformIdempotencyKey(makeRequest({ "idempotency-key": "short" }))).toThrow(PlatformAdminError);
  });

  it("throws VALIDATION_ERROR when the header exceeds 128 characters", () => {
    expect(() => requirePlatformIdempotencyKey(makeRequest({ "idempotency-key": "a".repeat(129) }))).toThrow(PlatformAdminError);
  });

  it("returns the header value when it is 16-128 characters", () => {
    const key = "a".repeat(36);
    expect(requirePlatformIdempotencyKey(makeRequest({ "idempotency-key": key }))).toBe(key);
  });
});
