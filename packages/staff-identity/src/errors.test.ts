import { describe, expect, it } from "vitest";
import { StaffIdentityError } from "./errors";

describe("StaffIdentityError", () => {
  it("maps each staff-specific code to its documented HTTP status (02_35 §13)", () => {
    expect(new StaffIdentityError("STAFF_AUTH_REQUIRED").httpStatus).toBe(401);
    expect(new StaffIdentityError("STAFF_FORBIDDEN").httpStatus).toBe(403);
    expect(new StaffIdentityError("CLASS_ACCESS_DENIED").httpStatus).toBe(404);
    expect(new StaffIdentityError("REVIEW_ITEM_NOT_FOUND").httpStatus).toBe(404);
    expect(new StaffIdentityError("FEEDBACK_NOT_PUBLISHABLE").httpStatus).toBe(409);
    expect(new StaffIdentityError("FEEDBACK_ALREADY_REVOKED").httpStatus).toBe(409);
    expect(new StaffIdentityError("STAFF_ACCOUNT_LOCKED").httpStatus).toBe(423);
    expect(new StaffIdentityError("RECOVERY_ASSIGNMENT_SOURCE_NOT_PUBLISHED").httpStatus).toBe(409);
  });

  it("maps the 4 reused generic codes to their conventional HTTP statuses", () => {
    expect(new StaffIdentityError("VALIDATION_ERROR").httpStatus).toBe(400);
    expect(new StaffIdentityError("ETAG_MISMATCH").httpStatus).toBe(412);
    expect(new StaffIdentityError("RATE_LIMITED").httpStatus).toBe(429);
    expect(new StaffIdentityError("IDEMPOTENCY_CONFLICT").httpStatus).toBe(409);
  });

  it("toEnvelope() is domain PLATFORM for every code — no new error domain is introduced", () => {
    expect(new StaffIdentityError("STAFF_AUTH_REQUIRED").toEnvelope("req_1").domain).toBe("PLATFORM");
    expect(new StaffIdentityError("RECOVERY_ASSIGNMENT_SOURCE_NOT_PUBLISHED").toEnvelope("req_1").domain).toBe("PLATFORM");
  });

  it("toEnvelope() marks only RATE_LIMITED as retryable", () => {
    expect(new StaffIdentityError("RATE_LIMITED").toEnvelope("req_1").retryable).toBe(true);
    expect(new StaffIdentityError("STAFF_AUTH_REQUIRED").toEnvelope("req_1").retryable).toBe(false);
    expect(new StaffIdentityError("ETAG_MISMATCH").toEnvelope("req_1").retryable).toBe(false);
  });

  it("carries retryAfterSeconds through to the envelope's headers-source, not the body itself", () => {
    const error = new StaffIdentityError("RATE_LIMITED", "too many attempts", { retryAfterSeconds: 42 });
    expect(error.retryAfterSeconds).toBe(42);
    expect(error.toEnvelope("req_1")).not.toHaveProperty("retryAfterSeconds");
  });

  it("includes safeDetails in the envelope only when provided", () => {
    const withDetails = new StaffIdentityError("VALIDATION_ERROR", "bad body", { safeDetails: { field: "email" } });
    expect(withDetails.toEnvelope("req_1").safeDetails).toEqual({ field: "email" });

    const withoutDetails = new StaffIdentityError("VALIDATION_ERROR");
    expect(withoutDetails.toEnvelope("req_1").safeDetails).toBeUndefined();
  });

  it("defaults message to the code itself when none is given", () => {
    expect(new StaffIdentityError("CLASS_ACCESS_DENIED").message).toBe("CLASS_ACCESS_DENIED");
  });

  it("carries the correlationId passed to toEnvelope(), not a fixed one", () => {
    const error = new StaffIdentityError("STAFF_FORBIDDEN");
    expect(error.toEnvelope("req_abc").correlationId).toBe("req_abc");
    expect(error.toEnvelope("req_xyz").correlationId).toBe("req_xyz");
  });
});
