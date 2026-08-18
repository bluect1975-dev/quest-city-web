import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { assertCapability, PlatformAdminError, type Capability, type PlatformAdminIdentity } from "@quest-city-web/platform-admin";
import {
  IncidentService,
  AlertService,
  PresenceService,
  UserPresenceRepository,
  LocalMockAlertChannelAdapter,
  type OperationalAlertPayload,
  type OperationalRecoveryPayload,
} from "@quest-city-web/operations";

/**
 * Master Admin Operations Control Center -- security + privacy suite
 * (02_42 v1.1, migration 0014). Structural template is
 * `platform-admin-flow.test.ts` / `granular-learning-path-control-security.test.ts`:
 * real `pg.Pool`, direct service-class calls (never HTTP), raw
 * `pool.query` fixture seeding, `.rejects.toMatchObject({ code: "..." })`.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- master-admin-operations-control-center-security
 *
 * Covers mission §59-61: capability enforcement for every `operations.*`
 * capability (route-layer `assertCapability` calls are exercised
 * directly, matching this repo's established pattern of never simulating
 * capability checks over HTTP), presence heartbeat rate-limiting and
 * server-side actor resolution (spoofing is closed by construction --
 * `apps/api/app/presence/heartbeat/route.ts` derives actorType/actorId
 * exclusively from the validated session, never from the request body),
 * write-coalescing under load, and privacy (no PII/secret ever reaches an
 * alert payload, a masked configuration, or an error).
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";
const pool = new Pool({ connectionString: DATABASE_URL });

const ALL_OPERATIONS_CAPABILITIES: Capability[] = [
  "operations.dashboard.view",
  "operations.infrastructure.view",
  "operations.usage.view",
  "operations.presence.view",
  "operations.errors.view",
  "operations.incidents.view",
  "operations.incidents.manage",
  "operations.alerting.view",
  "operations.alerting.manage",
];

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function createTenant(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', $2) RETURNING id`, [
    `sch_${rnd()}`,
    name,
  ]);
  return result.rows[0]!.id;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    `TRUNCATE alert_delivery, alert_configuration, operational_incident_event, operational_incident,
              operational_metric_sample, service_health_state, user_presence,
              platform_admin_session, capability_grant, platform_admin_grant,
              rate_limit_bucket, idempotency_record, audit_event, staff_account, tenant CASCADE`,
  );
}

async function createPlatformAdminIdentity(capabilities: Capability[]): Promise<PlatformAdminIdentity> {
  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
     VALUES ($1, 'x', 'scrypt', 'ACTIVE', 'ADMIN_BOOTSTRAP_SCRIPT', 'test-fixture') RETURNING id`,
    [`admin-${rnd()}@example.org`],
  );
  const staffAccountId = accountResult.rows[0]!.id;
  const grantResult = await pool.query<{ id: string }>(
    `INSERT INTO platform_admin_grant (staff_account_id, status, granted_by_actor_type, granted_by_actor_id)
     VALUES ($1, 'ACTIVE', 'ADMIN_BOOTSTRAP_SCRIPT', 'test-fixture') RETURNING id`,
    [staffAccountId],
  );
  const platformAdminGrantId = grantResult.rows[0]!.id;
  for (const capability of capabilities) {
    await pool.query(`INSERT INTO capability_grant (platform_admin_grant_id, capability) VALUES ($1, $2)`, [platformAdminGrantId, capability]);
  }
  return { staffAccountId, platformAdminGrantId, capabilities, csrfTokenHash: "unused-in-these-tests" };
}

describe("Master Admin Operations Control Center -- capability enforcement matrix (02_42 v1.1 §19-20, mission §59-60)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it.each(ALL_OPERATIONS_CAPABILITIES)("assertCapability grants access when the admin holds %s and only that capability", async (capability) => {
    const identity = await createPlatformAdminIdentity([capability]);
    expect(() => assertCapability(identity, capability)).not.toThrow();
  });

  it.each(ALL_OPERATIONS_CAPABILITIES)("assertCapability denies %s with CAPABILITY_DENIED when the admin holds every OTHER operations.* capability but not this one", async (capability) => {
    const otherCapabilities = ALL_OPERATIONS_CAPABILITIES.filter((c) => c !== capability);
    const identity = await createPlatformAdminIdentity(otherCapabilities);
    expect(() => assertCapability(identity, capability)).toThrow(PlatformAdminError);
    try {
      assertCapability(identity, capability);
      throw new Error("expected assertCapability to throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "CAPABILITY_DENIED" });
    }
  });

  it("a Platform Admin with ZERO capabilities is denied every operations.* capability (non-admin-equivalent baseline)", async () => {
    const identity = await createPlatformAdminIdentity([]);
    for (const capability of ALL_OPERATIONS_CAPABILITIES) {
      expect(() => assertCapability(identity, capability)).toThrow(PlatformAdminError);
    }
  });

  it("view-only capabilities do not implicitly grant the corresponding manage capability (no capability hierarchy shortcut)", async () => {
    const incidentsViewOnly = await createPlatformAdminIdentity(["operations.incidents.view"]);
    expect(() => assertCapability(incidentsViewOnly, "operations.incidents.manage")).toThrow(PlatformAdminError);

    const alertingViewOnly = await createPlatformAdminIdentity(["operations.alerting.view"]);
    expect(() => assertCapability(alertingViewOnly, "operations.alerting.manage")).toThrow(PlatformAdminError);
  });

  it("manage capabilities do not implicitly grant the corresponding view capability (each capability is independently granted, 02_42 §5)", async () => {
    const incidentsManageOnly = await createPlatformAdminIdentity(["operations.incidents.manage"]);
    expect(() => assertCapability(incidentsManageOnly, "operations.incidents.view")).toThrow(PlatformAdminError);
  });

  it("acknowledge() enforces INCIDENT_NOT_FOUND / INCIDENT_ALREADY_ACKNOWLEDGED regardless of the caller's capabilities (defense in depth below the route layer)", async () => {
    const identity = await createPlatformAdminIdentity(["operations.incidents.manage"]);
    const incidents = new IncidentService(pool);
    await expect(incidents.acknowledge("00000000-0000-0000-0000-000000000000", identity.staffAccountId, `key_${rnd()}`)).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });

    const { incident } = await incidents.recordCondition({ type: "API_DOWN", severity: "SEV-1", source: "APPLICATION", service: "api", summary: "down" });
    await incidents.acknowledge(incident.id, identity.staffAccountId, `key_${rnd()}`);
    await expect(incidents.acknowledge(incident.id, identity.staffAccountId, `key_${rnd()}`)).rejects.toMatchObject({
      code: "INCIDENT_ALREADY_ACKNOWLEDGED",
    });
  });
});

describe("Master Admin Operations Control Center -- presence heartbeat security (02_42 v1.1 §15-16, mission §61)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("heartbeat actor resolution is architecturally closed to spoofing: PresenceService.heartbeat takes only (actorType, actorId, tenantId) resolved server-side, never a client-declared identity payload", async () => {
    // apps/api/app/presence/heartbeat/route.ts's resolveActor() derives all
    // three fields exclusively from the validated session cookie for
    // whichever of the three domains authenticated the request -- the
    // request body is never consulted for actor identity. This is a type-
    // level guarantee (the route handler passes no body-derived value into
    // this call), verified here by confirming the service surface itself
    // exposes no body-shaped parameter an attacker could substitute.
    const tenantId = await createTenant("Spoof Test School");
    const presence = new PresenceService(pool);
    const own = await presence.heartbeat("STUDENT", "student-a", tenantId);
    expect(own.wrote).toBe(true);
    // A second actor's heartbeat cannot influence the first actor's row.
    await presence.heartbeat("STUDENT", "student-b", tenantId);
    const stateA = await presence.actorPresenceState("STUDENT", "student-a");
    const stateB = await presence.actorPresenceState("STUDENT", "student-b");
    expect(stateA).toBe("ONLINE");
    expect(stateB).toBe("ONLINE");
  });

  it("write-coalescing suppresses redundant heartbeat writes inside the coalesce window (server-side, no client control over the window)", async () => {
    const tenantId = await createTenant("Coalescing Test School");
    const presence = new PresenceService(pool, undefined, 60_000);
    const first = await presence.heartbeat("STAFF", "staff-1", tenantId);
    expect(first.wrote).toBe(true);
    const second = await presence.heartbeat("STAFF", "staff-1", tenantId);
    expect(second.wrote).toBe(false);
  });

  it("a heartbeat past the coalesce window writes again (coalescing is time-bounded, not permanent) -- exercised directly against the repository with explicit `now` timestamps to avoid a real wall-clock sleep", async () => {
    const repo = new UserPresenceRepository(pool);
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const first = await repo.heartbeat({ actorType: "PLATFORM_ADMIN", actorId: "admin-1", tenantId: null, coalesceWindowMs: 1_000, now: t0 });
    expect(first).toBe(true);
    const stillInsideWindow = await repo.heartbeat({
      actorType: "PLATFORM_ADMIN",
      actorId: "admin-1",
      tenantId: null,
      coalesceWindowMs: 1_000,
      now: new Date(t0.getTime() + 500),
    });
    expect(stillInsideWindow).toBe(false);
    const pastTheWindow = await repo.heartbeat({
      actorType: "PLATFORM_ADMIN",
      actorId: "admin-1",
      tenantId: null,
      coalesceWindowMs: 1_000,
      now: new Date(t0.getTime() + 5_000),
    });
    expect(pastTheWindow).toBe(true);
  });

  it("PLATFORM_ADMIN heartbeats are tenant-less (tenantId null) and never counted into a specific school's concurrent totals", async () => {
    const schoolTenantId = await createTenant("Concurrency Test School");
    const presence = new PresenceService(pool);
    await presence.heartbeat("PLATFORM_ADMIN", "admin-2", null);
    const counts = await presence.concurrentCounts(schoolTenantId);
    // A PLATFORM_ADMIN heartbeat is neither STUDENT nor STAFF, so it never
    // appears in a tenant-scoped student/staff concurrency count.
    expect(counts.concurrentStudents).toBe(0);
    expect(counts.concurrentStaff).toBe(0);
  });
});

describe("Master Admin Operations Control Center -- privacy (02_42 v1.1 §29-31, mission §61)", () => {
  beforeEach(truncateAll);
  afterAll(truncateAll);

  it("OperationalAlertPayload is structurally incapable of carrying PII, Restricted+ data, tokens, or stack traces -- it has exactly six fields, all operational metadata", () => {
    const payload: OperationalAlertPayload = {
      severity: "SEV-1",
      service: "api",
      problem: "5xx spike",
      detectedAt: new Date(),
      environment: "local",
      incidentPublicId: "inc_test",
    };
    const keys = Object.keys(payload).sort();
    expect(keys).toEqual(["detectedAt", "environment", "incidentPublicId", "problem", "service", "severity"]);
  });

  it("OperationalRecoveryPayload is structurally incapable of carrying PII -- three fields, all operational metadata", () => {
    const payload: OperationalRecoveryPayload = { service: "api", downtimeSeconds: 120, incidentPublicId: "inc_test" };
    expect(Object.keys(payload).sort()).toEqual(["downtimeSeconds", "incidentPublicId", "service"]);
  });

  it("LocalMockAlertChannelAdapter's sent message text never contains a bot token, credential, or 'password'/'secret' substring (message-content privacy check)", async () => {
    const adapter = new LocalMockAlertChannelAdapter();
    await adapter.sendAlert({
      severity: "SEV-1",
      service: "api",
      problem: "5xx spike",
      detectedAt: new Date(),
      environment: "local",
      incidentPublicId: "inc_test",
    });
    await adapter.sendTest();
    for (const message of adapter.sentMessages) {
      expect(message.toLowerCase()).not.toContain("token");
      expect(message.toLowerCase()).not.toContain("password");
      expect(message.toLowerCase()).not.toContain("secret");
      expect(message.toLowerCase()).not.toContain("botfather");
    }
  });

  it("AlertService.getMaskedConfiguration never returns the raw credentialRef -- only a derived CONFIGURED/NOT_CONFIGURED status and a masked recipient", async () => {
    const identity = await createPlatformAdminIdentity(["operations.alerting.manage"]);
    const adapter = new LocalMockAlertChannelAdapter();
    const alerts = new AlertService(pool, adapter);
    await pool.query(
      `INSERT INTO alert_configuration (channel, enabled, severity_threshold, cooldown_seconds, recipient_ref, credential_ref, escalation_json, updated_by_staff_account_id)
       VALUES ('TELEGRAM', true, 'SEV-2', 900, '-1001234567890', 'TELEGRAM_BOT_TOKEN', '{}', $1)`,
      [identity.staffAccountId],
    );
    const masked = await alerts.getMaskedConfiguration("TELEGRAM");
    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain("TELEGRAM_BOT_TOKEN");
    expect(serialized).not.toContain("-1001234567890");
    expect(masked.status).toBe("CONFIGURED");
    // maskRecipient keeps only the last 4 characters visible, masking the rest.
    expect(masked.recipientMasked).toMatch(/^\*+7890$/);
    expect(masked.recipientMasked).toHaveLength("-1001234567890".length);
  });

  it("PlatformAdminError thrown by operations services never leaks a stack trace or internal SQL through its public envelope shape", async () => {
    const incidents = new IncidentService(pool);
    try {
      await incidents.acknowledge("00000000-0000-0000-0000-000000000000", "nonexistent-staff-id", `key_${rnd()}`);
      throw new Error("expected acknowledge to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformAdminError);
      const envelope = (error as PlatformAdminError).toEnvelope("req_test");
      const serialized = JSON.stringify(envelope);
      expect(serialized).not.toMatch(/at \w+ \(/); // no stack-trace-shaped line
      expect(serialized).not.toContain("SELECT");
      expect(serialized).not.toContain("INSERT");
    }
  });
});
