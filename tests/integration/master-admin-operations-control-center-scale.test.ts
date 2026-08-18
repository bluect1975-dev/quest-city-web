import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { IncidentService, PresenceService, OverviewService, ServiceHealthStateRepository } from "@quest-city-web/operations";

/**
 * Master Admin Operations Control Center -- scale/performance check with
 * synthetic data (02_42 v1.1, mission §64). Verifies: (1) write-coalescing
 * holds under a burst of rapid repeated heartbeats for the same actor, (2)
 * concurrency counting stays correct at a few thousand presence rows, (3)
 * `OverviewService.getOverview()` issues a small, FIXED number of queries
 * regardless of dataset size -- the structural "no N+1" guarantee already
 * documented in overview-service.ts's own comment ("a read-only
 * aggregation, never a mutation, always batched queries"), verified here
 * rather than only asserted in a comment.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- master-admin-operations-control-center-scale
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";
const pool = new Pool({ connectionString: DATABASE_URL });

async function truncateAll(): Promise<void> {
  await pool.query(
    `TRUNCATE alert_delivery, alert_configuration, operational_incident_event, operational_incident,
              operational_metric_sample, service_health_state, user_presence,
              platform_admin_session, capability_grant, platform_admin_grant,
              rate_limit_bucket, idempotency_record, audit_event, staff_account, tenant CASCADE`,
  );
}

describe("Master Admin Operations Control Center -- scale/performance with synthetic data (mission §64)", () => {
  beforeEach(truncateAll);
  afterEach(() => vi.restoreAllMocks());
  afterAll(truncateAll);

  it("write-coalescing holds under a burst of 50 rapid repeated heartbeats for the SAME actor: only the first write is real, the row count stays at exactly 1", async () => {
    const presence = new PresenceService(pool, undefined, 20_000); // default coalesce window
    const results: boolean[] = [];
    for (let i = 0; i < 50; i += 1) {
      const { wrote } = await presence.heartbeat("STUDENT", "burst-actor", null);
      results.push(wrote);
    }
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[0]).toBe(true);

    const rowCount = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM user_presence WHERE actor_id = 'burst-actor'`);
    expect(Number(rowCount.rows[0]!.count)).toBe(1);
  }, 30_000);

  it("concurrentCounts stays correct at 3,000 synthetic presence rows (bulk-seeded, no per-row round trip)", async () => {
    // Bulk seed via a single INSERT ... SELECT generate_series, not 3000
    // individual INSERTs, to keep the fixture itself fast and to exercise
    // the aggregate COUNT query against a realistically large table.
    await pool.query(`
      INSERT INTO user_presence (actor_type, actor_id, tenant_id, last_seen_at, updated_at)
      SELECT
        CASE WHEN i % 3 = 0 THEN 'STAFF' ELSE 'STUDENT' END,
        'synthetic-actor-' || i,
        NULL,
        now() - (i % 900) * interval '1 second', -- spread across ONLINE/IDLE/OFFLINE thresholds
        now()
      FROM generate_series(1, 3000) AS i
    `);

    const presence = new PresenceService(pool);
    const start = Date.now();
    const counts = await presence.concurrentCounts();
    const elapsedMs = Date.now() - start;

    // Independently recompute the expected ONLINE count (<=120s old) to
    // cross-check the service's aggregate query against ground truth.
    const expected = await pool.query<{ actor_type: string; count: string }>(
      `SELECT actor_type, COUNT(*) AS count FROM user_presence WHERE last_seen_at >= now() - interval '120 seconds' GROUP BY actor_type`,
    );
    const expectedStudents = Number(expected.rows.find((r) => r.actor_type === "STUDENT")?.count ?? 0);
    const expectedStaff = Number(expected.rows.find((r) => r.actor_type === "STAFF")?.count ?? 0);

    expect(counts.concurrentStudents).toBe(expectedStudents);
    expect(counts.concurrentStaff).toBe(expectedStaff);
    expect(counts.concurrentTotal).toBe(expectedStudents + expectedStaff);
    expect(elapsedMs).toBeLessThan(2_000); // a single indexed aggregate query, not a full scan per row
  }, 30_000);

  it("OverviewService.getOverview() issues a FIXED, small number of queries regardless of dataset size (structural no-N+1 proof)", async () => {
    // Seed enough rows across every table getOverview() touches that an
    // accidental per-row query pattern would be immediately visible in the
    // query count.
    await pool.query(
      `INSERT INTO tenant (public_id, type, status, name) SELECT 'sch_' || i, 'SCHOOL', 'ACTIVE', 'School ' || i FROM generate_series(1, 200) AS i`,
    );
    await pool.query(`
      INSERT INTO user_presence (actor_type, actor_id, tenant_id, last_seen_at, updated_at)
      SELECT CASE WHEN i % 2 = 0 THEN 'STAFF' ELSE 'STUDENT' END, 'overview-actor-' || i, NULL, now(), now()
      FROM generate_series(1, 500) AS i
    `);
    for (let i = 0; i < 30; i += 1) {
      await new IncidentService(pool).recordCondition({
        type: `SYNTHETIC_TYPE_${i}`,
        severity: "SEV-3",
        source: "APPLICATION",
        service: `service-${i}`,
        summary: `synthetic incident ${i}`,
      });
    }
    const healthRepo = new ServiceHealthStateRepository(pool);
    for (const service of ["API", "POSTGRES", "REVERSE_PROXY", "STUDENT_WEB", "DASHBOARD"] as const) {
      await healthRepo.record({ service, state: "HEALTHY", detail: {} });
    }

    const querySpy = vi.spyOn(pool, "query");
    const overview = new OverviewService(pool);
    const result = await overview.getOverview();
    const queryCallCount = querySpy.mock.calls.length;

    expect(result.kpi.schoolsTotal).toBeGreaterThanOrEqual(200);
    expect(result.openIncidents).toBeGreaterThanOrEqual(30);
    // 8 aggregation calls are issued in Promise.all inside getOverview()
    // (tenantCounts/staffCountsByRole/totalUniqueStaffHumans/studentCounts/
    // activeLearningAttempts/countOpen/listLatestPerService/
    // concurrentCounts, the last of which itself issues 2 sub-queries) --
    // a fixed count independent of the 200/500/30 rows just seeded. A
    // generous ceiling of 15 catches any accidental per-row loop while not
    // being brittle to a future one-query refactor.
    expect(queryCallCount).toBeLessThanOrEqual(15);
    expect(queryCallCount).toBeGreaterThan(0);
  }, 30_000);

  it("incident list() with 300 synthetic rows and a status filter completes via a single batched query (no per-row fetch)", async () => {
    const incidents = new IncidentService(pool);
    for (let i = 0; i < 300; i += 1) {
      await pool.query(
        `INSERT INTO operational_incident (public_id, type, severity, source, service, summary, dedup_key, status)
         VALUES ($1, 'SYNTHETIC', 'SEV-4', 'APPLICATION', 'bulk-service', 'bulk synthetic incident', $2, 'OPEN')`,
        [`inc_bulk_${i}`, `SYNTHETIC::bulk-service-${i}::APPLICATION`],
      );
    }
    const querySpy = vi.spyOn(pool, "query");
    const list = await incidents.list({ status: "OPEN", limit: 50, offset: 0 });
    expect(list).toHaveLength(50);
    expect(querySpy.mock.calls.length).toBe(1);
  }, 30_000);
});
