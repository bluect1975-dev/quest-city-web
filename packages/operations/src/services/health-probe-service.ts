import type { Pool } from "pg";
import { ServiceHealthStateRepository, type ServiceHealthState } from "../repository/service-health-state-repository";
import { aggregatePlatformHealth, CRITICAL_SERVICES } from "../health";
import { IncidentService } from "./incident-service";
import { AlertService } from "./alert-service";
import type { AlertChannelAdapter } from "../alerting/alert-channel-adapter";
import { severityForCondition } from "../severity";

const STALE_AFTER_MS = 5 * 60 * 1000;

async function probePostgres(pool: Pool): Promise<{ state: ServiceHealthState; latencyMs: number }> {
  const startedAt = Date.now();
  try {
    await pool.query("SELECT 1");
    return { state: "HEALTHY", latencyMs: Date.now() - startedAt };
  } catch {
    return { state: "CRITICAL", latencyMs: Date.now() - startedAt };
  }
}

/**
 * Runs the local health checks (02_42 §21-23), records
 * service_health_state, and reconciles operational_incident state:
 * CRITICAL -> open/update a SEV-1 incident + evaluate Telegram escalation;
 * a service returning to HEALTHY auto-resolves its own open incident
 * (02_42 §27, never left OPEN just because nobody clicked resolve).
 */
export class HealthProbeService {
  constructor(
    private readonly pool: Pool,
    private readonly adapter: AlertChannelAdapter,
  ) {}

  async runProbes(): Promise<{ platformStatus: ServiceHealthState; services: Array<{ service: string; state: ServiceHealthState }> }> {
    const healthRepo = new ServiceHealthStateRepository(this.pool);
    const incidents = new IncidentService(this.pool);
    const alerts = new AlertService(this.pool, this.adapter);

    // API self-check: if this code is running, the API process is up --
    // the only way this probe fails is an unhandled exception below.
    const apiState: ServiceHealthState = "HEALTHY";
    const postgres = await probePostgres(this.pool);

    const results: Array<{ service: string; state: ServiceHealthState; latencyMs: number | null }> = [
      { service: "API", state: apiState, latencyMs: 0 },
      { service: "POSTGRES", state: postgres.state, latencyMs: postgres.latencyMs },
    ];

    for (const entry of results) {
      await healthRepo.record({ service: entry.service, state: entry.state, latencyMs: entry.latencyMs });

      const conditionType = entry.service === "API" ? "API_DOWN" : "POSTGRES_DOWN";
      if (entry.state === "CRITICAL") {
        const { incident } = await incidents.recordCondition({
          type: conditionType,
          severity: severityForCondition(conditionType),
          source: entry.service === "API" ? "APPLICATION" : "DATABASE",
          service: entry.service,
          summary: `${entry.service} health check reported CRITICAL.`,
        });
        await alerts.evaluateAndNotify(incident);
      } else {
        const resolved = await incidents.resolveByDedupKey(
          conditionType,
          entry.service,
          entry.service === "API" ? "APPLICATION" : "DATABASE",
        );
        if (resolved) {
          const downtimeSeconds = Math.max(0, Math.round((resolved.resolvedAt!.getTime() - resolved.firstSeenAt.getTime()) / 1000));
          await alerts.notifyRecovery(resolved, downtimeSeconds);
        }
      }
    }

    const latest = await healthRepo.listLatestPerService();
    const now = Date.now();
    const platformStatus = aggregatePlatformHealth(
      latest
        .filter((entry) => (CRITICAL_SERVICES as readonly string[]).includes(entry.service))
        .map((entry) => ({
          service: entry.service,
          state: entry.state,
          staleSinceCheckedAt: now - entry.checkedAt.getTime() > STALE_AFTER_MS,
        })),
    );

    return { platformStatus, services: results.map((entry) => ({ service: entry.service, state: entry.state })) };
  }
}
