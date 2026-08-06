import { describe, expect, it } from "vitest";
import { IDENTITY_ERROR_CODES, IdentityError } from "./errors";

const EXPECTED_STATUS: Record<string, number> = {
  CLASS_CODE_INVALID: 404,
  ACCESS_CREDENTIALS_INVALID: 401,
  ENROLLMENT_SUSPENDED: 403,
  SESSION_EXPIRED: 401,
  TENANT_ACCESS_DENIED: 403,
  CSRF_INVALID: 403,
  RATE_LIMITED: 429,
  VALIDATION_ERROR: 400,
};

describe("IdentityError", () => {
  it("does not include the retired narrative-only codes CLASS_CODE_EXPIRED / ALIAS_CONFLICT (02_26 §30.5)", () => {
    expect(IDENTITY_ERROR_CODES).not.toContain("CLASS_CODE_EXPIRED");
    expect(IDENTITY_ERROR_CODES).not.toContain("ALIAS_CONFLICT");
  });

  it.each(IDENTITY_ERROR_CODES)("maps %s to its documented HTTP status (02_26 §30.5)", (code) => {
    const error = new IdentityError(code);
    expect(error.httpStatus).toBe(EXPECTED_STATUS[code]);
  });

  it("carries an optional retryAfterSeconds for RATE_LIMITED", () => {
    const error = new IdentityError("RATE_LIMITED", "too many attempts", { retryAfterSeconds: 42 });
    expect(error.retryAfterSeconds).toBe(42);
  });

  it("leaves retryAfterSeconds undefined when not provided", () => {
    const error = new IdentityError("CLASS_CODE_INVALID");
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});
