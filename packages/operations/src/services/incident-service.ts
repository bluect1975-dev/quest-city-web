import type { Pool } from "pg";
import { AuditRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import {
  OperationalIncidentRepository,
  buildIncidentDedupKey,
  type OperationalIncident,
  type OperationalIncidentSeverity,
} from "../repository/operational-incident-repository";
import { OperationalIncidentEventRepository } from "../repository/operational-incident-event-repository";
import type { MetricSource } from "../repository/operational-metric-sample-repository";
import { PlatformAdminError } from "@quest-city-web/platform-admin";

const INCIDENT_ACKNOWLEDGE_SCOPE = "platform_operations_incident_acknowledge";

export interface RecordConditionInput {
  type: string;
  severity: OperationalIncidentSeverity;
  source: MetricSource;
  service: string;
  summary: string;
  tenantId?: string | null;
}

export interface RecordConditionResult {
  incident: OperationalIncident;
  isNew: boolean;
}

/**
 * First `operational_incident` engine in the corpus (02_42 §25-27).
 * Deduplication key = (type, service, source) -- a repeated identical
 * failure updates the existing OPEN/ACKNOWLEDGED row rather than creating
 * a duplicate.
 */
export class IncidentService {
  constructor(private readonly pool: Pool) {}

  async recordCondition(
    input: RecordConditionInput,
    actor: { type: string; id?: string | null } = { type: "SYSTEM" },
  ): Promise<RecordConditionResult> {
    const incidents = new OperationalIncidentRepository(this.pool);
    const events = new OperationalIncidentEventRepository(this.pool);
    const dedupKey = buildIncidentDedupKey(input.type, input.service, input.source);
    const existing = await incidents.findOpenOrAcknowledgedByDedupKey(dedupKey);
    if (existing) {
      const updated = await incidents.recordOccurrence(existing.id);
      await events.record({ incidentId: existing.id, eventType: "OCCURRENCE", actorType: actor.type, actorId: actor.id ?? null });
      return { incident: updated, isNew: false };
    }
    const created = await incidents.create(input);
    await events.record({
      incidentId: created.id,
      eventType: "OPENED",
      actorType: actor.type,
      actorId: actor.id ?? null,
      detail: { summary: input.summary },
    });
    return { incident: created, isNew: true };
  }

  /**
   * Called by monitoring when a previously-failing condition is observed
   * healthy again (02_42 §27, never a manual-only action). `actor`
   * defaults to `SYSTEM` (original local-collector behavior, unchanged);
   * the Tranche E2 external-monitor report service (02_42 v1.2 §69)
   * passes `{ type: "EXTERNAL_MONITOR", id: monitorId }` so the event
   * timeline distinguishes an authenticated external caller from the
   * internal collector, without introducing a second resolve pathway.
   */
  async resolveByDedupKey(
    type: string,
    service: string,
    source: MetricSource,
    resolutionType = "AUTO_RECOVERED",
    actor: { type: string; id?: string | null } = { type: "SYSTEM" },
  ): Promise<OperationalIncident | null> {
    const incidents = new OperationalIncidentRepository(this.pool);
    const events = new OperationalIncidentEventRepository(this.pool);
    const dedupKey = buildIncidentDedupKey(type, service, source);
    const existing = await incidents.findOpenOrAcknowledgedByDedupKey(dedupKey);
    if (!existing) return null;
    const resolved = await incidents.resolve(existing.id, resolutionType);
    await events.record({
      incidentId: existing.id,
      eventType: "RESOLVED",
      actorType: actor.type,
      actorId: actor.id ?? null,
      detail: { resolutionType },
    });
    return resolved;
  }

  /**
   * ACK never equals RESOLVED -- monitoring remains authoritative for
   * recovery (02_42 §27, §34). Idempotency reuses the nullable-tenant_id
   * `idempotency_record` mechanism (migration 0007/0014 precedent,
   * scope_key partitioned by acting admin) -- same pattern as
   * `TenantProvisioningService.createSchoolTenant`, no second mechanism.
   */
  async acknowledge(incidentId: string, staffAccountId: string, idempotencyKey: string): Promise<OperationalIncident> {
    const incidents = new OperationalIncidentRepository(this.pool);
    const events = new OperationalIncidentEventRepository(this.pool);
    const idempotency = new IdempotencyRecordRepository(this.pool);
    const audit = new AuditRepository(this.pool);

    const scopeKey = `${staffAccountId}:${idempotencyKey}`;
    const begin = await idempotency.begin({
      tenantId: null,
      scope: INCIDENT_ACKNOWLEDGE_SCOPE,
      scopeKey,
      requestHash: incidentId,
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") return begin.response as OperationalIncident;
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") {
      throw new PlatformAdminError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riusata con un payload diverso.");
    }
    if (begin.outcome === "RETRY_TOO_SOON") {
      throw new PlatformAdminError("IDEMPOTENCY_IN_PROGRESS", "Richiesta con la stessa Idempotency-Key già in corso.", {
        retryAfterSeconds: begin.retryAfterSeconds,
      });
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new PlatformAdminError("IDEMPOTENCY_IN_PROGRESS", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      const existing = await incidents.findById(incidentId);
      if (!existing) throw new PlatformAdminError("INCIDENT_NOT_FOUND", `Incident ${incidentId} not found.`);
      if (existing.status !== "OPEN") {
        throw new PlatformAdminError("INCIDENT_ALREADY_ACKNOWLEDGED", `Incident ${incidentId} is not OPEN (status=${existing.status}).`);
      }
      const updated = await incidents.acknowledge(incidentId, staffAccountId);
      if (!updated) {
        throw new PlatformAdminError("INCIDENT_ALREADY_ACKNOWLEDGED", `Incident ${incidentId} was acknowledged concurrently.`);
      }
      await events.record({ incidentId, eventType: "ACKNOWLEDGED", actorType: "PLATFORM_ADMIN", actorId: staffAccountId });

      await idempotency.complete({ tenantId: null, scope: INCIDENT_ACKNOWLEDGE_SCOPE, scopeKey, expectedGeneration: begin.generation, response: updated });
      await audit.record({
        tenantId: updated.tenantId,
        actorType: "PLATFORM_ADMIN",
        actorId: staffAccountId,
        action: "operations.incident.acknowledged",
        targetType: "operational_incident",
        targetId: updated.id,
        result: "SUCCESS",
        metadataRedacted: { publicId: updated.publicId, severity: updated.severity },
      });
      return updated;
    } catch (error) {
      await idempotency.fail({
        tenantId: null,
        scope: INCIDENT_ACKNOWLEDGE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: true,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  async list(filter: Parameters<OperationalIncidentRepository["list"]>[0]): Promise<OperationalIncident[]> {
    return new OperationalIncidentRepository(this.pool).list(filter);
  }

  async detail(incidentId: string): Promise<{ incident: OperationalIncident; events: Awaited<ReturnType<OperationalIncidentEventRepository["listByIncident"]>> } | null> {
    const incidents = new OperationalIncidentRepository(this.pool);
    const incident = await incidents.findById(incidentId);
    if (!incident) return null;
    const events = await new OperationalIncidentEventRepository(this.pool).listByIncident(incidentId);
    return { incident, events };
  }

  async countOpen(): Promise<number> {
    return new OperationalIncidentRepository(this.pool).countOpen();
  }
}
