import { describe, expect, it } from "vitest";
import { validateAgainst } from "./validate";

describe("content-schema fixture validation", () => {
  it("accepts a well-formed RUNTIME_FIXTURE_BUNDLE manifest", () => {
    const result = validateAgainst("webContentBundleManifest", {
      bundleId: "fixture-balance-machine-v1",
      bundleType: "RUNTIME_FIXTURE_BUNDLE",
      schemaVersion: "1.0",
      contentVersion: "0.0.1-fixture",
      checksum: "sha256:" + "a".repeat(64),
      publishedAt: "2026-08-05T00:00:00.000Z",
      compatibleRuntimes: ["WEB"],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a manifest missing required fields", () => {
    const result = validateAgainst("webContentBundleManifest", {
      bundleId: "incomplete",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a bundle manifest served as production content without an allowed bundleType", () => {
    const result = validateAgainst("webContentBundleManifest", {
      bundleId: "bad-type",
      bundleType: "NOT_A_REAL_TYPE",
      schemaVersion: "1.0",
      contentVersion: "1.0.0",
      checksum: "sha256:" + "a".repeat(64),
      publishedAt: "2026-08-05T00:00:00.000Z",
      compatibleRuntimes: ["WEB"],
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed semantic action envelope", () => {
    const result = validateAgainst("semanticAction", {
      actionType: "SELECT_OPTION",
      attemptId: "attempt-1",
      idempotencyKey: "0123456789abcdef", // gitleaks:allow — fixture placeholder, not a credential
      occurredAt: "2026-08-05T00:00:00.000Z",
      payload: { optionId: "opt-a" },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a raw device event masquerading as a semantic action", () => {
    const result = validateAgainst("semanticAction", {
      actionType: "MOUSE_DOWN_AT_440_217",
      attemptId: "attempt-1",
      idempotencyKey: "0123456789abcdef", // gitleaks:allow — fixture placeholder, not a credential
      occurredAt: "2026-08-05T00:00:00.000Z",
      payload: {},
    });
    expect(result.valid).toBe(false);
  });
});
