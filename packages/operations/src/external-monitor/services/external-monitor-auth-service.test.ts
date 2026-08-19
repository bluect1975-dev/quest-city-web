import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { ExternalMonitorAuthService, ExternalMonitorAuthError } from "./external-monitor-auth-service";

/**
 * A pool that throws if actually queried -- proves the structural
 * header-format checks below reject BEFORE any database round-trip, per
 * 02_42 v1.2 §53.4's own ordering (fail-fast, cheapest checks first).
 * The remaining checks (keyId lookup, nonce replay, signature match) all
 * require a real database and are covered by the integration test suite
 * (`tests/integration/tranche-e2-external-monitor-*.test.ts`), mirroring
 * this codebase's existing split between `operational-incident-repository.test.ts`
 * (pure-function unit test) and the MAOCC integration suites.
 */
function poisonedPool(): Pool {
  return {
    query: () => {
      throw new Error("unexpected database call from a structural-validation-only test");
    },
  } as unknown as Pool;
}

const BASE_INPUT = {
  method: "POST",
  path: "/platform/operations/external-monitor-report",
  timestampHeader: String(Math.floor(Date.now() / 1000)),
  nonceHeader: "a".repeat(32),
  keyIdHeader: "key-2026-08",
  signatureHeader: "deadbeef",
  rawBody: "{}",
  resolveSecret: () => Buffer.alloc(32, 1),
};

describe("ExternalMonitorAuthService structural checks (02_42 v1.2 §53.4) -- fail before any DB call", () => {
  it("rejects a missing X-QC-Monitor-Key-Id", async () => {
    const service = new ExternalMonitorAuthService(poisonedPool());
    await expect(service.verify({ ...BASE_INPUT, keyIdHeader: "" })).rejects.toMatchObject({
      reason: "AUTH_INVALID",
    } satisfies Partial<ExternalMonitorAuthError>);
  });

  it("rejects a X-QC-Monitor-Key-Id longer than 64 characters", async () => {
    const service = new ExternalMonitorAuthService(poisonedPool());
    await expect(service.verify({ ...BASE_INPUT, keyIdHeader: "k".repeat(65) })).rejects.toBeInstanceOf(ExternalMonitorAuthError);
  });

  it("rejects a X-QC-Monitor-Nonce shorter than 16 characters", async () => {
    const service = new ExternalMonitorAuthService(poisonedPool());
    await expect(service.verify({ ...BASE_INPUT, nonceHeader: "short" })).rejects.toMatchObject({ reason: "AUTH_INVALID" });
  });

  it("rejects a X-QC-Monitor-Nonce longer than 128 characters", async () => {
    const service = new ExternalMonitorAuthService(poisonedPool());
    await expect(service.verify({ ...BASE_INPUT, nonceHeader: "n".repeat(129) })).rejects.toMatchObject({ reason: "AUTH_INVALID" });
  });

  it("rejects a missing X-QC-Monitor-Signature", async () => {
    const service = new ExternalMonitorAuthService(poisonedPool());
    await expect(service.verify({ ...BASE_INPUT, signatureHeader: "" })).rejects.toMatchObject({ reason: "AUTH_INVALID" });
  });
});
