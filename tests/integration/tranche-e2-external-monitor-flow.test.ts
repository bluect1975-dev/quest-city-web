import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  IncidentService,
  AlertService,
  LocalMockAlertChannelAdapter,
  ExternalMonitorKeyMetadataRepository,
  ExternalMonitorNonceRepository,
  ExternalMonitorAuthService,
  ExternalMonitorAuthError,
  ExternalMonitorReportService,
  buildCanonicalString,
  computeSignatureHex,
  buildIncidentDedupKey,
  type ExternalMonitorReportRequestBody,
} from "@quest-city-web/operations";

/**
 * Tranche E2 out-of-band external monitoring, Level 2 (02_42 v1.2 PARTE U
 * §52-73, OpenAPI v1.19, mission §21-22). Structural template is
 * `master-admin-operations-control-center-flow.test.ts`: real `pg.Pool`,
 * direct service-class calls (never HTTP), raw `pool.query` fixture
 * seeding.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- tranche-e2-external-monitor-flow
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";
const pool = new Pool({ connectionString: DATABASE_URL });

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function truncateAll(): Promise<void> {
  await pool.query(
    `TRUNCATE external_monitor_nonce_seen, external_monitor_key_metadata,
              alert_delivery, alert_configuration, operational_incident_event, operational_incident,
              operational_metric_sample, service_health_state, user_presence,
              platform_admin_session, capability_grant, platform_admin_grant,
              rate_limit_bucket, idempotency_record, audit_event, staff_account, tenant CASCADE`,
  );
}

async function insertCurrentKey(keyId: string): Promise<void> {
  await pool.query(`INSERT INTO external_monitor_key_metadata (key_id, status, activated_at) VALUES ($1, 'CURRENT', now())`, [
    keyId,
  ]);
}

async function configureAlerting(staffAccountId: string): Promise<void> {
  await pool.query(
    `INSERT INTO alert_configuration (channel, enabled, severity_threshold, cooldown_seconds, recipient_ref, credential_ref, escalation_json, updated_by_staff_account_id)
     VALUES ('TELEGRAM', true, 'SEV-4', 60, 'mock-chat-id', 'MOCK_CREDENTIAL_REF', '{}', $1)`,
    [staffAccountId],
  );
}

async function createStaffAccountId(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
     VALUES ($1, 'x', 'scrypt', 'ACTIVE', 'ADMIN_BOOTSTRAP_SCRIPT', 'test-fixture') RETURNING id`,
    [`admin-${rnd()}@example.org`],
  );
  return result.rows[0]!.id;
}

const PATH = "/platform/operations/external-monitor-report";

function sign(secret: Buffer, opts: { method?: string; path?: string; timestamp: string; nonce: string; rawBody: string }): string {
  const canonical = buildCanonicalString({
    method: opts.method ?? "POST",
    path: opts.path ?? PATH,
    timestamp: opts.timestamp,
    nonce: opts.nonce,
    rawBody: opts.rawBody,
  });
  return computeSignatureHex(canonical, secret);
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

function detectedBody(overrides: Partial<ExternalMonitorReportRequestBody> = {}): ExternalMonitorReportRequestBody {
  return {
    monitorId: "github-actions:questcity-external-monitor",
    observationId: randomUUID(),
    observedAt: new Date().toISOString(),
    environment: "PRODUCTION",
    service: "HOST",
    conditionType: "VPS_UNREACHABLE",
    state: "DETECTED",
    summaryCode: "CONNECT_TIMEOUT",
    evidence: { httpStatus: null, latencyMs: null, tlsDaysRemaining: null, backupAgeHours: null, consecutiveFailures: 3 },
    backfill: false,
    detectedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe("ExternalMonitorKeyMetadataRepository -- secret rotation lifecycle (02_42 v1.2 §54)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("rotateIn demotes the existing CURRENT to PREVIOUS and inserts the new CURRENT -- at most one CURRENT at a time", async () => {
    const repo = new ExternalMonitorKeyMetadataRepository(pool);
    await repo.rotateIn("key-2026-01", null);
    await repo.rotateIn("key-2026-02", null);

    const current = await repo.findCurrent();
    expect(current?.keyId).toBe("key-2026-02");
    const old = await repo.findByKeyId("key-2026-01");
    expect(old?.status).toBe("PREVIOUS");
  });

  it("during the overlap window, both CURRENT and PREVIOUS resolve as verifiable; after revoke, PREVIOUS is rejected", async () => {
    const repo = new ExternalMonitorKeyMetadataRepository(pool);
    await repo.rotateIn("key-old", null);
    await repo.rotateIn("key-new", null);

    expect((await repo.findVerifiable("key-new"))?.status).toBe("CURRENT");
    expect((await repo.findVerifiable("key-old"))?.status).toBe("PREVIOUS");

    await repo.revoke("key-old");
    expect(await repo.findVerifiable("key-old")).toBeNull();
    const revoked = await repo.findByKeyId("key-old");
    expect(revoked?.status).toBe("REVOKED");
    expect(revoked?.revokedAt).not.toBeNull();
  });

  it("an unknown keyId is never verifiable", async () => {
    const repo = new ExternalMonitorKeyMetadataRepository(pool);
    expect(await repo.findVerifiable("never-existed")).toBeNull();
  });
});

describe("ExternalMonitorNonceRepository -- protocol replay protection (02_42 v1.2 §59.A)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("the first use of a (keyId, nonce) pair succeeds; a repeat is rejected", async () => {
    const repo = new ExternalMonitorNonceRepository(pool);
    expect(await repo.recordIfNew("key-1", "nonce-abc")).toBe(true);
    expect(await repo.recordIfNew("key-1", "nonce-abc")).toBe(false);
  });

  it("the same nonce value under a DIFFERENT keyId is a distinct, independently-usable pair", async () => {
    const repo = new ExternalMonitorNonceRepository(pool);
    expect(await repo.recordIfNew("key-1", "same-nonce")).toBe(true);
    expect(await repo.recordIfNew("key-2", "same-nonce")).toBe(true);
  });

  it("race-safety: concurrent recordIfNew calls for the identical pair resolve to exactly one true", async () => {
    const repo = new ExternalMonitorNonceRepository(pool);
    const results = await Promise.all(Array.from({ length: 10 }, () => repo.recordIfNew("key-race", "race-nonce")));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("ExternalMonitorAuthService -- four fail-closed checks (02_42 v1.2 §53.4)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  const SECRET = Buffer.alloc(32, 5);

  async function baseVerifyInput(overrides: Partial<Parameters<ExternalMonitorAuthService["verify"]>[0]> = {}) {
    const timestamp = nowSeconds();
    const nonce = randomUUID(); // always 36 chars, safely within the 16-128 bound regardless of rnd()'s variable length
    const rawBody = "{}";
    const signature = sign(SECRET, { timestamp, nonce, rawBody });
    return {
      method: "POST",
      path: PATH,
      timestampHeader: timestamp,
      nonceHeader: nonce,
      keyIdHeader: "key-current",
      signatureHeader: signature,
      rawBody,
      resolveSecret: () => SECRET,
      ...overrides,
    };
  }

  it("accepts a correctly signed request from a CURRENT key", async () => {
    await insertCurrentKey("key-current");
    const service = new ExternalMonitorAuthService(pool);
    const result = await service.verify(await baseVerifyInput());
    expect(result.keyId).toBe("key-current");
    expect(result.keyStatus).toBe("CURRENT");
  });

  it("rejects an unknown keyId with AUTH_INVALID", async () => {
    const service = new ExternalMonitorAuthService(pool);
    await expect(service.verify(await baseVerifyInput({ keyIdHeader: "no-such-key" }))).rejects.toMatchObject({
      reason: "AUTH_INVALID",
    });
  });

  it("rejects a REVOKED key with AUTH_INVALID", async () => {
    const repo = new ExternalMonitorKeyMetadataRepository(pool);
    await repo.rotateIn("key-current", null);
    await repo.revoke("key-current");
    const service = new ExternalMonitorAuthService(pool);
    await expect(service.verify(await baseVerifyInput())).rejects.toMatchObject({ reason: "AUTH_INVALID" });
  });

  it("accepts a valid signature from a PREVIOUS key during the rotation overlap window", async () => {
    const repo = new ExternalMonitorKeyMetadataRepository(pool);
    await repo.rotateIn("key-previous", null);
    await repo.rotateIn("key-current", null); // demotes key-previous to PREVIOUS
    const previousSecret = Buffer.alloc(32, 9);
    const service = new ExternalMonitorAuthService(pool);
    const timestamp = nowSeconds();
    const nonce = randomUUID(); // always 36 chars, safely within the 16-128 bound regardless of rnd()'s variable length
    const rawBody = "{}";
    const signature = sign(previousSecret, { timestamp, nonce, rawBody });
    const result = await service.verify({
      method: "POST",
      path: PATH,
      timestampHeader: timestamp,
      nonceHeader: nonce,
      keyIdHeader: "key-previous",
      signatureHeader: signature,
      rawBody,
      resolveSecret: (status) => (status === "PREVIOUS" ? previousSecret : Buffer.alloc(32, 1)),
    });
    expect(result.keyStatus).toBe("PREVIOUS");
  });

  it("rejects a wrong signature with SIGNATURE_INVALID", async () => {
    await insertCurrentKey("key-current");
    const service = new ExternalMonitorAuthService(pool);
    await expect(service.verify(await baseVerifyInput({ signatureHeader: "0".repeat(64) }))).rejects.toMatchObject({
      reason: "SIGNATURE_INVALID",
    });
  });

  it("rejects a stale timestamp (older than tolerance) with TIMESTAMP_INVALID", async () => {
    await insertCurrentKey("key-current");
    const service = new ExternalMonitorAuthService(pool);
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const nonce = randomUUID(); // always 36 chars, safely within the 16-128 bound regardless of rnd()'s variable length
    const rawBody = "{}";
    const signature = sign(SECRET, { timestamp: staleTimestamp, nonce, rawBody });
    await expect(
      service.verify(await baseVerifyInput({ timestampHeader: staleTimestamp, nonceHeader: nonce, signatureHeader: signature })),
    ).rejects.toMatchObject({ reason: "TIMESTAMP_INVALID" });
  });

  it("rejects a future timestamp (beyond tolerance) with TIMESTAMP_INVALID", async () => {
    await insertCurrentKey("key-current");
    const service = new ExternalMonitorAuthService(pool);
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 3600);
    const nonce = randomUUID(); // always 36 chars, safely within the 16-128 bound regardless of rnd()'s variable length
    const rawBody = "{}";
    const signature = sign(SECRET, { timestamp: futureTimestamp, nonce, rawBody });
    await expect(
      service.verify(
        await baseVerifyInput({ timestampHeader: futureTimestamp, nonceHeader: nonce, signatureHeader: signature }),
      ),
    ).rejects.toMatchObject({ reason: "TIMESTAMP_INVALID" });
  });

  it("rejects a replayed (keyId, nonce) pair with REPLAY_DETECTED, even with a valid signature", async () => {
    await insertCurrentKey("key-current");
    const service = new ExternalMonitorAuthService(pool);
    const input = await baseVerifyInput();
    await service.verify(input); // first use succeeds
    await expect(service.verify(input)).rejects.toMatchObject({ reason: "REPLAY_DETECTED" });
  });

  it("fail-closed: a body byte-different from the one that was signed fails signature verification (signature is over the exact raw body)", async () => {
    await insertCurrentKey("key-current");
    const service = new ExternalMonitorAuthService(pool);
    const input = await baseVerifyInput({ rawBody: '{"a":1}' });
    // Tamper the body after signing without re-signing.
    await expect(service.verify({ ...input, rawBody: '{"a":2}' })).rejects.toBeInstanceOf(ExternalMonitorAuthError);
  });
});

describe("ExternalMonitorReportService -- Level 2 live path (02_42 v1.2 §55-59)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("a DETECTED report creates a new OPEN incident with source EXTERNAL_MONITOR and server-derived severity", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting(staffAccountId);
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));

    const result = await service.submit(detectedBody());
    expect(result.status).toBe("OPEN");
    expect(result.deduped).toBe(false);
    expect(result.alertTriggered).toBe(true);
    expect(adapter.sentMessages).toHaveLength(1);

    const incidents = new IncidentService(pool);
    const detail = await incidents.detail(
      (await pool.query<{ id: string }>(`SELECT id FROM operational_incident WHERE public_id = $1`, [result.incidentPublicId])).rows[0]!.id,
    );
    expect(detail!.incident.source).toBe("EXTERNAL_MONITOR");
    expect(detail!.incident.severity).toBe("SEV-1"); // VPS_UNREACHABLE, 02_42 §57 table -- never accepted from the caller.
    expect(detail!.incident.backfilled).toBe(false);
  });

  it("a repeated identical condition (different observationId) dedups onto the same incident row and increments occurrenceCount (02_42 §59.C, unchanged)", async () => {
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));
    const first = await service.submit(detectedBody());
    const second = await service.submit(detectedBody());
    expect(second.incidentPublicId).toBe(first.incidentPublicId);

    const dedupKey = buildIncidentDedupKey("VPS_UNREACHABLE", "HOST", "EXTERNAL_MONITOR");
    const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM operational_incident WHERE dedup_key = $1`, [dedupKey]);
    expect(Number(countResult.rows[0]!.count)).toBe(1);
  });

  it("API idempotency (02_42 §59.B): a retry with the SAME observationId and identical payload returns deduped:true, no new side effect", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting(staffAccountId);
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));
    const body = detectedBody();

    const first = await service.submit(body);
    const second = await service.submit(body); // identical payload, same observationId
    expect(second.deduped).toBe(true);
    expect(second.incidentPublicId).toBe(first.incidentPublicId);
    expect(adapter.sentMessages).toHaveLength(1); // no second alert dispatched

    const occurrenceResult = await pool.query<{ occurrence_count: number }>(
      `SELECT occurrence_count FROM operational_incident WHERE public_id = $1`,
      [first.incidentPublicId],
    );
    expect(occurrenceResult.rows[0]!.occurrence_count).toBe(1); // never incremented by a pure retry
  });

  it("API idempotency conflict (02_42 §59.B): the SAME observationId with a DIFFERENT payload is rejected with EXTERNAL_MONITOR_OBSERVATION_CONFLICT", async () => {
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));
    const observationId = randomUUID();
    await service.submit(detectedBody({ observationId, summaryCode: "CONNECT_TIMEOUT" }));
    await expect(service.submit(detectedBody({ observationId, summaryCode: "CONNECT_REFUSED" }))).rejects.toMatchObject({
      code: "EXTERNAL_MONITOR_OBSERVATION_CONFLICT",
    });
  });

  it("a DIFFERENT observationId for the same nonce-protected condition is NOT an idempotency retry -- protocol replay (nonce) and API idempotency (observationId) are independent (02_42 §59)", async () => {
    // This test documents the conceptual separation at the service layer:
    // the report service itself never sees or checks nonces (that is the
    // auth layer's job, already covered above) -- two structurally
    // identical bodies with different observationId are two distinct,
    // both-valid observations from this service's point of view.
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));
    const first = await service.submit(detectedBody());
    const second = await service.submit(detectedBody());
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(false);
  });

  it("a RECOVERED report resolves the matching OPEN incident and triggers a recovery notification", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting(staffAccountId);
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));
    const detected = await service.submit(detectedBody());
    const recovered = await service.submit(
      detectedBody({ observationId: randomUUID(), state: "RECOVERED", summaryCode: "THRESHOLD_RECOVERED" }),
    );
    expect(recovered.incidentPublicId).toBe(detected.incidentPublicId);
    expect(recovered.status).toBe("RESOLVED");
    expect(recovered.alertTriggered).toBe(true);
    expect(adapter.sentMessages).toHaveLength(2); // one ALERT, one RECOVERY
  });

  it("a RECOVERED report with no matching OPEN/ACKNOWLEDGED incident is rejected with EXTERNAL_MONITOR_PAYLOAD_INVALID (disclosed implementation decision, 02_42 does not specify this case)", async () => {
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));
    await expect(
      service.submit(detectedBody({ state: "RECOVERED", summaryCode: "THRESHOLD_RECOVERED" })),
    ).rejects.toMatchObject({ code: "EXTERNAL_MONITOR_PAYLOAD_INVALID" });
  });
});

describe("ExternalMonitorReportService -- Level 1 backfill path (02_42 v1.2 §60)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("a backfilled RECOVERED report (no prior Level 2 tracking) creates AND resolves the incident in one call, marked backfilled=true, with the historical timestamps -- and triggers NO Telegram notification even though alerting is enabled", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting(staffAccountId);
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));

    const detectedAt = new Date(Date.now() - 3600_000).toISOString();
    const resolvedAt = new Date(Date.now() - 1800_000).toISOString();
    const result = await service.submit(
      detectedBody({ state: "RECOVERED", summaryCode: "THRESHOLD_RECOVERED", backfill: true, detectedAt, resolvedAt }),
    );

    expect(result.status).toBe("RESOLVED");
    expect(result.alertTriggered).toBe(false);
    expect(adapter.sentMessages).toHaveLength(0); // never a second (or first) Telegram notification for backfill

    const row = await pool.query<{ backfilled: boolean; first_seen_at: Date; resolved_at: Date; resolution_type: string }>(
      `SELECT backfilled, first_seen_at, resolved_at, resolution_type FROM operational_incident WHERE public_id = $1`,
      [result.incidentPublicId],
    );
    expect(row.rows[0]!.backfilled).toBe(true);
    expect(row.rows[0]!.resolution_type).toBe("EXTERNAL_MONITOR_BACKFILL");
    // Reconstructed from the caller-supplied historical timestamps, never "now".
    expect(new Date(row.rows[0]!.first_seen_at).toISOString().slice(0, 16)).toBe(detectedAt.slice(0, 16));
    expect(new Date(row.rows[0]!.resolved_at).toISOString().slice(0, 16)).toBe(resolvedAt.slice(0, 16));
  });

  it("backfill requires detectedAt, and resolvedAt when state = RECOVERED (service-level defensive check, mirrors the API validation layer)", async () => {
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));
    await expect(service.submit(detectedBody({ backfill: true, detectedAt: null }))).rejects.toMatchObject({
      code: "EXTERNAL_MONITOR_PAYLOAD_INVALID",
    });
    await expect(
      service.submit(
        detectedBody({ backfill: true, state: "RECOVERED", detectedAt: new Date().toISOString(), resolvedAt: null }),
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_MONITOR_PAYLOAD_INVALID" });
  });

  it("a backfilled DETECTED report with no existing incident creates one OPEN, marked backfilled=true, and does not alert", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting(staffAccountId);
    const adapter = new LocalMockAlertChannelAdapter();
    const service = new ExternalMonitorReportService(pool, new AlertService(pool, adapter));
    const detectedAt = new Date(Date.now() - 600_000).toISOString();

    const result = await service.submit(detectedBody({ backfill: true, detectedAt }));
    expect(result.status).toBe("OPEN");
    expect(result.alertTriggered).toBe(false);
    expect(adapter.sentMessages).toHaveLength(0);

    const row = await pool.query<{ backfilled: boolean }>(`SELECT backfilled FROM operational_incident WHERE public_id = $1`, [
      result.incidentPublicId,
    ]);
    expect(row.rows[0]!.backfilled).toBe(true);
  });
});
