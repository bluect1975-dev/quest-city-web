import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  IncidentService,
  AlertService,
  AlertDeliveryRepository,
  LocalMockAlertChannelAdapter,
  buildIncidentDedupKey,
} from "@quest-city-web/operations";

/**
 * Master Admin Operations Control Center -- incident lifecycle and
 * Telegram/local-mock alerting matrices (02_42 v1.1 PARTE H/K, mission
 * §62-63). Structural template is `platform-admin-flow.test.ts`: real
 * `pg.Pool`, direct service-class calls (never HTTP), raw `pool.query`
 * fixture seeding.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- master-admin-operations-control-center-flow
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";
const pool = new Pool({ connectionString: DATABASE_URL });

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function truncateAll(): Promise<void> {
  await pool.query(
    `TRUNCATE alert_delivery, alert_configuration, operational_incident_event, operational_incident,
              operational_metric_sample, service_health_state, user_presence,
              platform_admin_session, capability_grant, platform_admin_grant,
              rate_limit_bucket, idempotency_record, audit_event, staff_account, tenant CASCADE`,
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

async function configureAlerting(input: { enabled: boolean; severityThreshold: "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4"; cooldownSeconds: number }, staffAccountId: string): Promise<void> {
  await pool.query(
    `INSERT INTO alert_configuration (channel, enabled, severity_threshold, cooldown_seconds, recipient_ref, credential_ref, escalation_json, updated_by_staff_account_id)
     VALUES ('TELEGRAM', $1, $2, $3, 'mock-chat-id', 'MOCK_CREDENTIAL_REF', '{}', $4)`,
    [input.enabled, input.severityThreshold, input.cooldownSeconds, staffAccountId],
  );
}

describe("Master Admin Operations Control Center -- incident lifecycle matrix (02_42 v1.1 §25-27, mission §62)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("healthy -> degraded (first occurrence creates a new OPEN incident with occurrenceCount 1)", async () => {
    const incidents = new IncidentService(pool);
    const { incident, isNew } = await incidents.recordCondition({
      type: "SUSTAINED_HIGH_5XX",
      severity: "SEV-2",
      source: "APPLICATION",
      service: "api",
      summary: "5xx rate above threshold",
    });
    expect(isNew).toBe(true);
    expect(incident.status).toBe("OPEN");
    expect(incident.occurrenceCount).toBe(1);
  });

  it("down (repeated identical condition) dedups onto the SAME row, incrementing occurrenceCount rather than creating a duplicate", async () => {
    const incidents = new IncidentService(pool);
    const first = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "API unreachable" });
    const second = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "API unreachable" });
    expect(second.isNew).toBe(false);
    expect(second.incident.id).toBe(first.incident.id);
    expect(second.incident.occurrenceCount).toBe(2);

    const dedupKey = buildIncidentDedupKey("API_DOWN", "api", "APPLICATION");
    const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM operational_incident WHERE dedup_key = $1`, [dedupKey]);
    expect(Number(countResult.rows[0]!.count)).toBe(1);
  });

  it("ACK moves OPEN -> ACKNOWLEDGED and records an ACKNOWLEDGED event, but does NOT resolve the incident (monitoring stays authoritative for recovery, 02_42 §27/§34)", async () => {
    const staffAccountId = await createStaffAccountId();
    const incidents = new IncidentService(pool);
    const { incident } = await incidents.recordCondition({ type: "DISK_THRESHOLD", severity: "SEV-3", source: "HOST", service: "postgres-host", summary: "disk at 88%" });
    const acknowledged = await incidents.acknowledge(incident.id, staffAccountId, `key_${rnd()}`);
    expect(acknowledged.status).toBe("ACKNOWLEDGED");
    expect(acknowledged.acknowledgedByStaffAccountId).toBe(staffAccountId);

    const detail = await incidents.detail(incident.id);
    expect(detail!.events.map((e) => e.eventType)).toEqual(["OPENED", "ACKNOWLEDGED"]);
  });

  it("continued failure while ACKNOWLEDGED still records new OCCURRENCE events without reopening or duplicating", async () => {
    const staffAccountId = await createStaffAccountId();
    const incidents = new IncidentService(pool);
    const { incident } = await incidents.recordCondition({ type: "BACKUP_FAILED", severity: "SEV-2", source: "BACKUP", service: "backup-job", summary: "nightly backup failed" });
    await incidents.acknowledge(incident.id, staffAccountId, `key_${rnd()}`);
    const { incident: stillFailing, isNew } = await incidents.recordCondition({ type: "BACKUP_FAILED", severity: "SEV-2", source: "BACKUP", service: "backup-job", summary: "nightly backup failed" });
    expect(isNew).toBe(false);
    expect(stillFailing.status).toBe("ACKNOWLEDGED");
    expect(stillFailing.occurrenceCount).toBe(2);

    const detail = await incidents.detail(incident.id);
    expect(detail!.events.map((e) => e.eventType)).toEqual(["OPENED", "ACKNOWLEDGED", "OCCURRENCE"]);
  });

  it("recovery (resolveByDedupKey) moves the incident to RESOLVED and records a RESOLVED event, whether OPEN or ACKNOWLEDGED", async () => {
    const incidents = new IncidentService(pool);
    const { incident } = await incidents.recordCondition({ type: "TLS_EXPIRY_WARNING", severity: "SEV-4", source: "TLS", service: "reverse-proxy", summary: "cert expires in 25 days" });
    const resolved = await incidents.resolveByDedupKey("TLS_EXPIRY_WARNING", "reverse-proxy", "TLS");
    expect(resolved!.status).toBe("RESOLVED");
    expect(resolved!.resolutionType).toBe("AUTO_RECOVERED");
    const detail = await incidents.detail(incident.id);
    expect(detail!.events.map((e) => e.eventType)).toEqual(["OPENED", "RESOLVED"]);
  });

  it("recurrence after resolution opens a NEW incident row sharing the same dedup key, rather than reopening the resolved row (dedup is scoped to OPEN/ACKNOWLEDGED only)", async () => {
    const incidents = new IncidentService(pool);
    const { incident: firstIncident } = await incidents.recordCondition({ type: "LOGIN_BLOCKED_WIDESPREAD", severity: "SEV-2", source: "APPLICATION", service: "identity", summary: "widespread lockouts" });
    await incidents.resolveByDedupKey("LOGIN_BLOCKED_WIDESPREAD", "identity", "APPLICATION");
    const { incident: recurrence, isNew } = await incidents.recordCondition({ type: "LOGIN_BLOCKED_WIDESPREAD", severity: "SEV-2", source: "APPLICATION", service: "identity", summary: "widespread lockouts" });
    expect(isNew).toBe(true);
    expect(recurrence.id).not.toBe(firstIncident.id);
    expect(recurrence.dedupKey).toBe(firstIncident.dedupKey);
    expect(recurrence.status).toBe("OPEN");
  });

  it("staleness: countOpen only counts OPEN/ACKNOWLEDGED, never RESOLVED or a stale/superseded row", async () => {
    const incidents = new IncidentService(pool);
    await incidents.recordCondition({ type: "MINOR_COSMETIC", severity: "SEV-4", source: "APPLICATION", service: "dashboard", summary: "cosmetic glitch" });
    const { incident: toResolve } = await incidents.recordCondition({ type: "DEGRADED_WITH_WORKAROUND", severity: "SEV-3", source: "APPLICATION", service: "attempts", summary: "slow but working" });
    await incidents.resolveByDedupKey("DEGRADED_WITH_WORKAROUND", "attempts", "APPLICATION");
    void toResolve;
    expect(await incidents.countOpen()).toBe(1);
  });

  it("acknowledge() is idempotent under a reused Idempotency-Key (same key -> same result, no double side effect)", async () => {
    const staffAccountId = await createStaffAccountId();
    const incidents = new IncidentService(pool);
    const { incident } = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "down" });
    const key = `key_${rnd()}`;
    const first = await incidents.acknowledge(incident.id, staffAccountId, key);
    const second = await incidents.acknowledge(incident.id, staffAccountId, key);
    expect(second.id).toBe(first.id);
    const detail = await incidents.detail(incident.id);
    expect(detail!.events.filter((e) => e.eventType === "ACKNOWLEDGED")).toHaveLength(1);
  });
});

describe("Master Admin Operations Control Center -- Telegram/local-mock alerting matrix (02_42 v1.1 PARTE K, mission §63)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("SEV-1..4 threshold behavior: a configured threshold of SEV-2 dispatches for SEV-1/SEV-2 but suppresses SEV-3/SEV-4", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting({ enabled: true, severityThreshold: "SEV-2", cooldownSeconds: 60 }, staffAccountId);
    const incidents = new IncidentService(pool);
    const adapter = new LocalMockAlertChannelAdapter();
    const alerts = new AlertService(pool, adapter);

    const { incident: sev1 } = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "down" });
    const { incident: sev2 } = await incidents.recordCondition({ type: "BACKUP_FAILED", severity: "SEV-2", source: "BACKUP", service: "backup-job", summary: "failed" });
    const { incident: sev3 } = await incidents.recordCondition({ type: "DISK_THRESHOLD", severity: "SEV-3", source: "HOST", service: "host", summary: "disk high" });
    const { incident: sev4 } = await incidents.recordCondition({ type: "MINOR_COSMETIC", severity: "SEV-4", source: "APPLICATION", service: "dashboard", summary: "glitch" });

    expect(await alerts.evaluateAndNotify(sev1)).not.toBeNull();
    expect(await alerts.evaluateAndNotify(sev2)).not.toBeNull();
    expect(await alerts.evaluateAndNotify(sev3)).toBeNull();
    expect(await alerts.evaluateAndNotify(sev4)).toBeNull();
    expect(adapter.sentMessages).toHaveLength(2);
  });

  it("a disabled configuration dispatches nothing regardless of severity", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting({ enabled: false, severityThreshold: "SEV-4", cooldownSeconds: 60 }, staffAccountId);
    const incidents = new IncidentService(pool);
    const adapter = new LocalMockAlertChannelAdapter();
    const alerts = new AlertService(pool, adapter);
    const { incident } = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "down" });
    expect(await alerts.evaluateAndNotify(incident)).toBeNull();
    expect(adapter.sentMessages).toHaveLength(0);
  });

  it("cooldown suppresses a repeat notification for the same incident within the cooldown window (dedup at the alerting layer, independent of incident dedup)", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting({ enabled: true, severityThreshold: "SEV-4", cooldownSeconds: 3600 }, staffAccountId);
    const incidents = new IncidentService(pool);
    const adapter = new LocalMockAlertChannelAdapter();
    const alerts = new AlertService(pool, adapter);
    const { incident } = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "down" });

    const firstDelivery = await alerts.evaluateAndNotify(incident);
    expect(firstDelivery).not.toBeNull();

    const refetched = await incidents.detail(incident.id);
    const secondDelivery = await alerts.evaluateAndNotify(refetched!.incident);
    expect(secondDelivery).toBeNull();
    expect(adapter.sentMessages).toHaveLength(1);
  });

  it("a notification past the cooldown window is dispatched again (cooldown is time-bounded, not permanent)", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting({ enabled: true, severityThreshold: "SEV-4", cooldownSeconds: 60 }, staffAccountId);
    const incidents = new IncidentService(pool);
    const adapter = new LocalMockAlertChannelAdapter();
    const alerts = new AlertService(pool, adapter);
    const { incident } = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "down" });
    await alerts.evaluateAndNotify(incident);

    // Simulate the cooldown having elapsed by directly backdating last_notified_at.
    await pool.query(`UPDATE operational_incident SET last_notified_at = now() - interval '2 hours' WHERE id = $1`, [incident.id]);
    const refetched = await incidents.detail(incident.id);
    const secondDelivery = await alerts.evaluateAndNotify(refetched!.incident);
    expect(secondDelivery).not.toBeNull();
    expect(adapter.sentMessages).toHaveLength(2);
  });

  it("recovery-once: notifyRecovery dispatches a RECOVERY-kind delivery distinct from ALERT-kind deliveries", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting({ enabled: true, severityThreshold: "SEV-4", cooldownSeconds: 60 }, staffAccountId);
    const incidents = new IncidentService(pool);
    const adapter = new LocalMockAlertChannelAdapter();
    const alerts = new AlertService(pool, adapter);
    const { incident } = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "down" });
    await alerts.evaluateAndNotify(incident);
    const recoveryDelivery = await alerts.notifyRecovery(incident, 180);
    expect(recoveryDelivery!.kind).toBe("RECOVERY");
    expect(recoveryDelivery!.status).toBe("SENT");

    const kindsResult = await pool.query<{ kind: string }>(`SELECT kind FROM alert_delivery WHERE incident_id = $1 ORDER BY created_at`, [incident.id]);
    expect(kindsResult.rows.map((r) => r.kind)).toEqual(["ALERT", "RECOVERY"]);
  });

  it("failed-delivery tracking: a simulated provider failure records status FAILED with a failureCategory, and the incident row itself is untouched beyond last_notified_at (02_42 §37)", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting({ enabled: true, severityThreshold: "SEV-4", cooldownSeconds: 60 }, staffAccountId);
    const incidents = new IncidentService(pool);
    const adapter = new LocalMockAlertChannelAdapter();
    adapter.simulateNextFailure();
    const alerts = new AlertService(pool, adapter);
    const { incident } = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "down" });
    const delivery = await alerts.evaluateAndNotify(incident);
    expect(delivery!.status).toBe("FAILED");
    expect(delivery!.failureCategory).toBe("SIMULATED_FAILURE");

    const stillOpen = await incidents.detail(incident.id);
    expect(stillOpen!.incident.status).toBe("OPEN");
  });

  it("bounded retry substrate: alert_delivery.attemptCount increments on each recordAttempt call, giving a caller-driven retry loop something deterministic to bound against (no automatic retry scheduler exists in this local-first phase -- 02_42 §36 tracks attempts for a future bounded policy)", async () => {
    const deliveries = new AlertDeliveryRepository(pool);
    const created = await deliveries.create({ channel: "TELEGRAM", kind: "ALERT" });
    expect(created.attemptCount).toBe(0);
    const afterFirst = await deliveries.recordAttempt({ id: created.id, status: "FAILED", failureCategory: "TIMEOUT" });
    expect(afterFirst.attemptCount).toBe(1);
    const afterSecond = await deliveries.recordAttempt({ id: created.id, status: "FAILED", failureCategory: "TIMEOUT" });
    expect(afterSecond.attemptCount).toBe(2);
    const afterThird = await deliveries.recordAttempt({ id: created.id, status: "SENT", providerResultNormalized: "telegram-ok" });
    expect(afterThird.attemptCount).toBe(3);
    expect(afterThird.status).toBe("SENT");

    const failedList = await deliveries.listRecentFailed(20);
    expect(failedList.find((d) => d.id === created.id)).toBeUndefined(); // final status is SENT, not FAILED
  });

  it("sendTest() dispatches a self-identifying TEST-kind message and is rejected with ALERT_CHANNEL_NOT_CONFIGURED when no channel row exists", async () => {
    const staffAccountId = await createStaffAccountId();
    const adapter = new LocalMockAlertChannelAdapter();
    const alerts = new AlertService(pool, adapter);
    await expect(alerts.sendTest(staffAccountId, `key_${rnd()}`)).rejects.toMatchObject({ code: "ALERT_CHANNEL_NOT_CONFIGURED" });

    await configureAlerting({ enabled: true, severityThreshold: "SEV-4", cooldownSeconds: 60 }, staffAccountId);
    const delivery = await alerts.sendTest(staffAccountId, `key_${rnd()}`);
    expect(delivery.kind).toBe("TEST");
    expect(delivery.status).toBe("SENT");
    expect(adapter.sentMessages[0]).toContain("TEST alert");
    expect(adapter.sentMessages[0]).toContain("No real incident");
  });

  it("sendTest() is idempotent under a reused Idempotency-Key", async () => {
    const staffAccountId = await createStaffAccountId();
    await configureAlerting({ enabled: true, severityThreshold: "SEV-4", cooldownSeconds: 60 }, staffAccountId);
    const adapter = new LocalMockAlertChannelAdapter();
    const alerts = new AlertService(pool, adapter);
    const key = `key_${rnd()}`;
    const first = await alerts.sendTest(staffAccountId, key);
    const second = await alerts.sendTest(staffAccountId, key);
    expect(second.id).toBe(first.id);
    expect(adapter.sentMessages).toHaveLength(1);
  });
});
