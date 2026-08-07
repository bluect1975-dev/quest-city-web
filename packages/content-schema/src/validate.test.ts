import { describe, expect, it } from "vitest";
import { validateAgainst } from "./validate";

describe("content-schema v2.0.0 validation", () => {
  it("accepts a well-formed RUNTIME_FIXTURE_BUNDLE manifest with entries and integrity", () => {
    const result = validateAgainst("webContentBundleManifest", {
      bundleSchemaVersion: "1.0.0",
      bundleId: "fixture-balance-machine-v1",
      bundleVersion: "1.0.0",
      bundleType: "RUNTIME_FIXTURE_BUNDLE",
      status: "PUBLISHED",
      contentVersion: "0.0.1-fixture",
      publishedAt: "2026-08-05T00:00:00.000Z",
      compatibleRuntimes: ["WEB"],
      entries: [
        {
          entryId: "MAT-M06-BALANCE-001",
          entryType: "activity",
          path: "activities/MAT-M06-BALANCE-001.json",
          schemaRef: "qc://schemas/activity-definition/1.0.0",
          contentDigest: "sha256:" + "a".repeat(64),
          required: true,
        },
      ],
      integrity: { algorithm: "sha256", digest: "b".repeat(64) },
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

  it("rejects a manifest with an unknown bundleType", () => {
    const result = validateAgainst("webContentBundleManifest", {
      bundleSchemaVersion: "1.0.0",
      bundleId: "bad-type",
      bundleVersion: "1.0.0",
      bundleType: "NOT_A_REAL_TYPE",
      status: "PUBLISHED",
      contentVersion: "1.0.0",
      publishedAt: "2026-08-05T00:00:00.000Z",
      entries: [],
      integrity: { algorithm: "sha256", digest: "a".repeat(64) },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a manifest entry with a path-traversal path (schema-level defense in depth)", () => {
    const result = validateAgainst("bundleEntry", {
      entryId: "evil",
      entryType: "activity",
      path: "../../etc/passwd",
      schemaRef: "qc://schemas/activity-definition/1.0.0",
      contentDigest: "sha256:" + "a".repeat(64),
      required: true,
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed semantic action envelope (canonical vocabulary)", () => {
    const result = validateAgainst("semanticAction", {
      actionId: "act-1",
      attemptId: "attempt-1",
      activityId: "MAT-M06-BALANCE-001",
      actionType: "SELECT_OPTION",
      payload: { optionId: "opt-a" },
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: "2026-08-05T00:00:00.000Z",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a raw device event masquerading as a semantic action", () => {
    const result = validateAgainst("semanticAction", {
      actionId: "act-1",
      attemptId: "attempt-1",
      activityId: "MAT-M06-BALANCE-001",
      actionType: "MOUSE_DOWN_AT_440_217",
      payload: {},
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: "2026-08-05T00:00:00.000Z",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects the retired non-canonical SUBMIT_ATTEMPT action type", () => {
    const result = validateAgainst("semanticAction", {
      actionId: "act-1",
      attemptId: "attempt-1",
      activityId: "MAT-M06-BALANCE-001",
      actionType: "SUBMIT_ATTEMPT",
      payload: {},
      clientSequence: 0,
      runtimeChannel: "WEB",
      occurredAt: "2026-08-05T00:00:00.000Z",
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed attempt context with the attemptState lifecycle field", () => {
    const result = validateAgainst("attemptContext", {
      attemptId: "att_01",
      attemptVersion: 1,
      userPublicId: "usr_01",
      activityId: "MAT-M06-BALANCE-001",
      activityVersion: "1.0.0",
      runtimeChannel: "WEB",
      state: "IN_PROGRESS",
      serverSequence: 3,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an attempt context with a non-canonical state value", () => {
    const result = validateAgainst("attemptContext", {
      attemptId: "att_01",
      attemptVersion: 1,
      userPublicId: "usr_01",
      activityId: "MAT-M06-BALANCE-001",
      activityVersion: "1.0.0",
      runtimeChannel: "WEB",
      state: "evaluated",
      serverSequence: 3,
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed ErrorEnvelope with a CROSS_RUNTIME domain", () => {
    const result = validateAgainst("runtimeError", {
      domain: "CROSS_RUNTIME",
      code: "ATTEMPT_NOT_COMPLETABLE",
      httpStatus: 409,
      message: "Il tentativo non è completabile nel suo stato attuale.",
      correlationId: "req_01",
      retryable: false,
      safeDetails: { reason: "ABANDONED" },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an ErrorEnvelope with an unknown domain", () => {
    const result = validateAgainst("runtimeError", {
      domain: "NOT_A_DOMAIN",
      code: "X",
      httpStatus: 400,
      message: "x",
      correlationId: "x",
      retryable: false,
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed CONSOLIDATED outcome", () => {
    const result = validateAgainst("outcome", {
      attemptId: "att_01",
      completionStatus: "CONSOLIDATED",
      score: 0.86,
      consolidatedAt: "2026-08-05T00:00:00.000Z",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an outcome with a non-CONSOLIDATED completionStatus", () => {
    const result = validateAgainst("outcome", {
      attemptId: "att_01",
      completionStatus: "ACCEPTED_NOT_CONSOLIDATED",
      consolidatedAt: "2026-08-05T00:00:00.000Z",
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed validator fixture with nested semantic actions ($ref resolution)", () => {
    const result = validateAgainst("validatorFixture", {
      fixtureId: "fx-balance-001",
      activityId: "MAT-M06-BALANCE-001",
      activityVersion: "1.0.0",
      runtimeChannel: "WEB",
      validatorRef: "qc://validators/balance-machine/1.0.0",
      semanticActions: [
        {
          actionId: "act-1",
          attemptId: "attempt-fixture",
          activityId: "MAT-M06-BALANCE-001",
          actionType: "PLACE_ITEM",
          payload: { weight: 5 },
          clientSequence: 0,
          runtimeChannel: "WEB",
          occurredAt: "2026-08-05T00:00:00.000Z",
        },
      ],
      expectedOutcome: { score: 1 },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a validator fixture whose nested semantic action is invalid", () => {
    const result = validateAgainst("validatorFixture", {
      fixtureId: "fx-balance-002",
      activityId: "MAT-M06-BALANCE-001",
      activityVersion: "1.0.0",
      runtimeChannel: "WEB",
      validatorRef: "qc://validators/balance-machine/1.0.0",
      semanticActions: [
        {
          actionId: "act-1",
          attemptId: "attempt-fixture",
          activityId: "MAT-M06-BALANCE-001",
          actionType: "MOUSE_DOWN_AT_440_217",
          payload: {},
          clientSequence: 0,
          runtimeChannel: "WEB",
          occurredAt: "2026-08-05T00:00:00.000Z",
        },
      ],
      expectedOutcome: {},
    });
    expect(result.valid).toBe(false);
  });
});
