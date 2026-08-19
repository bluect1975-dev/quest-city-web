import type { Pool } from "pg";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { AuditRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { IncidentService } from "../../services/incident-service";
import { AlertService } from "../../services/alert-service";
import { OperationalIncidentRepository, buildIncidentDedupKey } from "../../repository/operational-incident-repository";
import {
  severityForExternalMonitorCondition,
  EXTERNAL_MONITOR_SOURCE,
  type ExternalMonitorConditionType,
  type ExternalMonitorService,
  type ExternalMonitorState,
  type ExternalMonitorSummaryCode,
} from "../condition-mapping";

const IDEMPOTENCY_SCOPE = "external_monitor_report_submit";

export interface ExternalMonitorEvidence {
  httpStatus: number | null;
  latencyMs: number | null;
  tlsDaysRemaining: number | null;
  backupAgeHours: number | null;
  consecutiveFailures: number;
}

export interface ExternalMonitorReportRequestBody {
  monitorId: string;
  observationId: string;
  observedAt: string;
  environment: "STAGING" | "PRODUCTION";
  service: ExternalMonitorService;
  conditionType: ExternalMonitorConditionType;
  state: ExternalMonitorState;
  summaryCode: ExternalMonitorSummaryCode;
  evidence: ExternalMonitorEvidence;
  backfill?: boolean;
  detectedAt?: string | null;
  resolvedAt?: string | null;
}

export interface ExternalMonitorReportResponseData {
  incidentPublicId: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "SUPPRESSED";
  deduped: boolean;
  alertTriggered: boolean;
}

/**
 * Deterministic request-hash input (02_42 v1.2 §59.B) -- an explicit,
 * fixed key order, never `JSON.stringify(body)` directly (object key
 * insertion order is not a contract this service should depend on).
 */
function canonicalRequestHash(body: ExternalMonitorReportRequestBody): string {
  return JSON.stringify({
    monitorId: body.monitorId,
    observationId: body.observationId,
    observedAt: body.observedAt,
    environment: body.environment,
    service: body.service,
    conditionType: body.conditionType,
    state: body.state,
    summaryCode: body.summaryCode,
    evidence: {
      httpStatus: body.evidence.httpStatus,
      latencyMs: body.evidence.latencyMs,
      tlsDaysRemaining: body.evidence.tlsDaysRemaining,
      backupAgeHours: body.evidence.backupAgeHours,
      consecutiveFailures: body.evidence.consecutiveFailures,
    },
    backfill: body.backfill ?? false,
    detectedAt: body.detectedAt ?? null,
    resolvedAt: body.resolvedAt ?? null,
  });
}

function summaryFor(body: ExternalMonitorReportRequestBody): string {
  // Machine-generated only, from bounded enum values -- never free text
  // from the caller (02_42 §56, §70).
  return `External monitor: ${body.conditionType} (${body.summaryCode})`;
}

/**
 * Orchestrates `POST /platform/operations/external-monitor-report`
 * (02_42 v1.2 PARTE U §55-60) -- the ONLY entry point that writes through
 * this endpoint's authenticated report into the existing
 * `operational_incident`/`AlertChannelAdapter` pipeline (02_42 §11
 * mission constraint: no second incident pipeline, no second alerting
 * engine). Auth (HMAC/nonce/timestamp) is already resolved by
 * `ExternalMonitorAuthService` before this service is ever called --
 * this class only handles API idempotency (§59.B), condition mapping,
 * incident/alert orchestration, backfill, and audit.
 */
export class ExternalMonitorReportService {
  constructor(
    private readonly pool: Pool,
    private readonly alertService: AlertService,
  ) {}

  async submit(body: ExternalMonitorReportRequestBody): Promise<ExternalMonitorReportResponseData> {
    const idempotency = new IdempotencyRecordRepository(this.pool);
    const requestHash = canonicalRequestHash(body);
    const begin = await idempotency.begin({
      tenantId: null,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey: body.observationId,
      requestHash,
    });

    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      // Legitimate retry, identical payload (02_42 §59.B) -- same response,
      // deduped forced true, no new side effect of any kind.
      return { ...(begin.response as ExternalMonitorReportResponseData), deduped: true };
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") {
      throw new PlatformAdminError(
        "EXTERNAL_MONITOR_OBSERVATION_CONFLICT",
        "observationId already used with a different payload.",
      );
    }
    if (begin.outcome === "RETRY_TOO_SOON") {
      // No dedicated contract code for "same observationId currently
      // in flight/recently-failed-retryable" -- closest fit is the
      // existing rate-limited/Retry-After semantics (both mean "back off
      // and retry shortly"), documented deviation (02_42 does not
      // specify this race window).
      throw new PlatformAdminError("EXTERNAL_MONITOR_RATE_LIMITED", "A submission for this observationId is already in progress.", {
        retryAfterSeconds: begin.retryAfterSeconds,
      });
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new Error(`external monitor report: observationId ${body.observationId} failed terminally on a previous attempt`);
    }

    try {
      const result = body.backfill ? await this.submitBackfill(body) : await this.submitLive(body);

      await idempotency.complete({
        tenantId: null,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey: body.observationId,
        expectedGeneration: begin.generation,
        response: result,
      });

      await new AuditRepository(this.pool).record({
        tenantId: null,
        actorType: "EXTERNAL_MONITOR",
        actorId: body.monitorId,
        action: "external_monitor_report.accepted",
        targetType: "operational_incident",
        targetId: result.incidentPublicId,
        result: "SUCCESS",
        metadataRedacted: {
          conditionType: body.conditionType,
          service: body.service,
          state: body.state,
          backfill: body.backfill ?? false,
        },
      });

      return result;
    } catch (error) {
      await idempotency.fail({
        tenantId: null,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey: body.observationId,
        expectedGeneration: begin.generation,
        retryable: true,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /** Level 2 live path (02_42 §55-59) -- reuses IncidentService/AlertService exactly as the internal collector does, only the actor/source differ. */
  private async submitLive(body: ExternalMonitorReportRequestBody): Promise<ExternalMonitorReportResponseData> {
    const severity = severityForExternalMonitorCondition(body.conditionType);
    const summary = summaryFor(body);
    const incidentService = new IncidentService(this.pool);
    const actor = { type: "EXTERNAL_MONITOR", id: body.monitorId };

    if (body.state === "DETECTED") {
      const { incident } = await incidentService.recordCondition(
        {
          type: body.conditionType,
          severity,
          source: EXTERNAL_MONITOR_SOURCE,
          service: body.service,
          summary,
          tenantId: null,
        },
        actor,
      );
      const delivery = await this.alertService.evaluateAndNotify(incident);
      return {
        incidentPublicId: incident.publicId,
        status: incident.status,
        deduped: false,
        alertTriggered: delivery !== null,
      };
    }

    // RECOVERED
    const resolved = await incidentService.resolveByDedupKey(
      body.conditionType,
      body.service,
      EXTERNAL_MONITOR_SOURCE,
      "EXTERNAL_MONITOR_RECOVERED",
      actor,
    );
    if (!resolved) {
      // Disclosed implementation decision (02_42 does not specify this
      // case): a RECOVERED report with no matching OPEN/ACKNOWLEDGED
      // incident to resolve is rejected rather than silently accepted or
      // fabricating an incident -- the request is well-formed but
      // inconsistent with current server state.
      throw new PlatformAdminError(
        "EXTERNAL_MONITOR_PAYLOAD_INVALID",
        "RECOVERED report has no matching OPEN/ACKNOWLEDGED condition for this (conditionType, service) pair.",
        { safeDetails: { conditionType: body.conditionType, service: body.service } },
      );
    }
    const downtimeSeconds = Math.max(0, Math.round((Date.now() - resolved.firstSeenAt.getTime()) / 1000));
    const delivery = await this.alertService.notifyRecovery(resolved, downtimeSeconds);
    return {
      incidentPublicId: resolved.publicId,
      status: resolved.status,
      deduped: false,
      alertTriggered: delivery !== null,
    };
  }

  /**
   * Level 1 backfill path (02_42 §60) -- NEVER calls AlertService, by
   * construction (this method has no reference to it at all): the
   * condition was already notified out-of-band via direct Telegram
   * before this call ever arrives.
   */
  private async submitBackfill(body: ExternalMonitorReportRequestBody): Promise<ExternalMonitorReportResponseData> {
    if (!body.detectedAt) {
      throw new PlatformAdminError("EXTERNAL_MONITOR_PAYLOAD_INVALID", "detectedAt is required when backfill = true.");
    }
    if (body.state === "RECOVERED" && !body.resolvedAt) {
      throw new PlatformAdminError(
        "EXTERNAL_MONITOR_PAYLOAD_INVALID",
        "resolvedAt is required when backfill = true and state = RECOVERED.",
      );
    }

    const severity = severityForExternalMonitorCondition(body.conditionType);
    const summary = summaryFor(body);
    const incidents = new OperationalIncidentRepository(this.pool);
    const dedupKey = buildIncidentDedupKey(body.conditionType, body.service, EXTERNAL_MONITOR_SOURCE);
    const existingOpen = await incidents.findOpenOrAcknowledgedByDedupKey(dedupKey);

    let result: ExternalMonitorReportResponseData;

    if (body.state === "DETECTED") {
      if (existingOpen) {
        const updated = await incidents.recordOccurrence(existingOpen.id);
        result = { incidentPublicId: updated.publicId, status: updated.status, deduped: false, alertTriggered: false };
      } else {
        const created = await incidents.createBackfilled({
          type: body.conditionType,
          severity,
          source: EXTERNAL_MONITOR_SOURCE,
          service: body.service,
          summary,
          tenantId: null,
          detectedAt: new Date(body.detectedAt),
          resolvedAt: null,
        });
        result = { incidentPublicId: created.publicId, status: created.status, deduped: false, alertTriggered: false };
      }
    } else if (existingOpen) {
      // RECOVERED backfill merging into an incident Level 2 was already
      // independently tracking -- still uses the caller-supplied
      // historical resolvedAt, never now().
      const resolved = await incidents.resolveBackfilled(existingOpen.id, new Date(body.resolvedAt as string));
      result = { incidentPublicId: resolved.publicId, status: resolved.status, deduped: false, alertTriggered: false };
    } else {
      // The primary documented scenario (02_42 §60 narrative): Level 2
      // never saw the DETECTED phase at all (Level 1 bypassed it
      // entirely), so this single call both creates and resolves the
      // incident using the reconstructed historical timestamps.
      const created = await incidents.createBackfilled({
        type: body.conditionType,
        severity,
        source: EXTERNAL_MONITOR_SOURCE,
        service: body.service,
        summary,
        tenantId: null,
        detectedAt: new Date(body.detectedAt),
        resolvedAt: new Date(body.resolvedAt as string),
      });
      result = { incidentPublicId: created.publicId, status: created.status, deduped: false, alertTriggered: false };
    }

    await new AuditRepository(this.pool).record({
      tenantId: null,
      actorType: "EXTERNAL_MONITOR",
      actorId: body.monitorId,
      action: "external_monitor_report.backfilled",
      targetType: "operational_incident",
      targetId: result.incidentPublicId,
      result: "SUCCESS",
      metadataRedacted: { conditionType: body.conditionType, service: body.service, state: body.state },
    });

    return result;
  }
}
