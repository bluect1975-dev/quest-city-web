import type { Pool } from "pg";
import { PlatformAdminError } from "@quest-city-web/platform-admin";
import { AuditRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { AlertConfigurationRepository, type AlertConfiguration, type AlertChannel } from "../repository/alert-configuration-repository";
import { AlertDeliveryRepository, type AlertDelivery } from "../repository/alert-delivery-repository";
import { OperationalIncidentRepository, type OperationalIncident } from "../repository/operational-incident-repository";
import { meetsSeverityThreshold } from "../severity";
import type { AlertChannelAdapter } from "../alerting/alert-channel-adapter";

const DEFAULT_ENVIRONMENT = process.env.NODE_ENV === "production" ? "production" : "local";
const ALERT_CONFIGURATION_UPDATE_SCOPE = "platform_operations_alert_configuration_update";
const ALERT_TEST_SCOPE = "platform_operations_alert_test";

export interface MaskedAlertConfiguration {
  status: "CONFIGURED" | "NOT_CONFIGURED";
  enabled: boolean;
  severityThreshold: AlertConfiguration["severityThreshold"];
  cooldownSeconds: number;
  recipientMasked: string | null;
}

function maskRecipient(recipientRef: string | null): string | null {
  if (!recipientRef) return null;
  if (recipientRef.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, recipientRef.length - 4))}${recipientRef.slice(-4)}`;
}

/**
 * Configuration + delivery orchestration for the Telegram/local-mock alert
 * channel (02_42 PARTE K). Never exposes the Bot Token -- reads/writes
 * only `recipientRef`/`credentialRef` (pointers, never the secret value).
 */
export class AlertService {
  constructor(
    private readonly pool: Pool,
    private readonly adapter: AlertChannelAdapter,
  ) {}

  async getMaskedConfiguration(channel: AlertChannel = "TELEGRAM"): Promise<MaskedAlertConfiguration> {
    const config = await new AlertConfigurationRepository(this.pool).findByChannel(channel);
    if (!config) {
      return { status: "NOT_CONFIGURED", enabled: false, severityThreshold: "SEV-2", cooldownSeconds: 900, recipientMasked: null };
    }
    return {
      status: config.credentialRef ? "CONFIGURED" : "NOT_CONFIGURED",
      enabled: config.enabled,
      severityThreshold: config.severityThreshold,
      cooldownSeconds: config.cooldownSeconds,
      recipientMasked: maskRecipient(config.recipientRef),
    };
  }

  async updateConfiguration(input: {
    channel: AlertChannel;
    enabled: boolean;
    severityThreshold: AlertConfiguration["severityThreshold"];
    cooldownSeconds: number;
    updatedByStaffAccountId: string;
    idempotencyKey: string;
  }): Promise<MaskedAlertConfiguration> {
    if (input.cooldownSeconds < 60) {
      throw new PlatformAdminError("ALERT_CONFIGURATION_INVALID", "cooldownSeconds must be at least 60 (platform floor).");
    }

    const idempotency = new IdempotencyRecordRepository(this.pool);
    const audit = new AuditRepository(this.pool);
    const scopeKey = `${input.updatedByStaffAccountId}:${input.idempotencyKey}`;
    const requestHash = JSON.stringify({
      channel: input.channel,
      enabled: input.enabled,
      severityThreshold: input.severityThreshold,
      cooldownSeconds: input.cooldownSeconds,
    });
    const begin = await idempotency.begin({ tenantId: null, scope: ALERT_CONFIGURATION_UPDATE_SCOPE, scopeKey, requestHash });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") return begin.response as MaskedAlertConfiguration;
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
      const repo = new AlertConfigurationRepository(this.pool);
      const existing = await repo.findByChannel(input.channel);
      await repo.upsert({
        channel: input.channel,
        enabled: input.enabled,
        severityThreshold: input.severityThreshold,
        cooldownSeconds: input.cooldownSeconds,
        recipientRef: existing?.recipientRef ?? null,
        credentialRef: existing?.credentialRef ?? null,
        updatedByStaffAccountId: input.updatedByStaffAccountId,
      });
      const result = await this.getMaskedConfiguration(input.channel);

      await idempotency.complete({ tenantId: null, scope: ALERT_CONFIGURATION_UPDATE_SCOPE, scopeKey, expectedGeneration: begin.generation, response: result });
      await audit.record({
        tenantId: null,
        actorType: "PLATFORM_ADMIN",
        actorId: input.updatedByStaffAccountId,
        action: "operations.alert_configuration.updated",
        targetType: "alert_configuration",
        targetId: input.channel,
        result: "SUCCESS",
        metadataRedacted: { channel: input.channel, enabled: input.enabled, severityThreshold: input.severityThreshold },
      });
      return result;
    } catch (error) {
      await idempotency.fail({
        tenantId: null,
        scope: ALERT_CONFIGURATION_UPDATE_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: true,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /**
   * Escalation decision (02_42 §35): dispatched only if enabled AND
   * severity meets the configured threshold AND cooldown has elapsed
   * since the incident's last notification (02_42 §28, §34). A delivery
   * failure never alters incident truth (02_42 §37) -- it's recorded on
   * `alert_delivery`, the incident row itself is untouched beyond
   * `last_notified_at`.
   */
  async evaluateAndNotify(incident: OperationalIncident, channel: AlertChannel = "TELEGRAM"): Promise<AlertDelivery | null> {
    const configRepo = new AlertConfigurationRepository(this.pool);
    const config = await configRepo.findByChannel(channel);
    if (!config || !config.enabled) return null;
    if (!meetsSeverityThreshold(incident.severity, config.severityThreshold)) return null;

    if (incident.lastNotifiedAt) {
      const elapsedMs = Date.now() - incident.lastNotifiedAt.getTime();
      if (elapsedMs < config.cooldownSeconds * 1000) return null;
    }

    const deliveryRepo = new AlertDeliveryRepository(this.pool);
    const delivery = await deliveryRepo.create({ incidentId: incident.id, channel, kind: "ALERT", dedupKey: incident.dedupKey });
    const result = await this.adapter.sendAlert({
      severity: incident.severity,
      service: incident.service,
      problem: incident.summary,
      detectedAt: incident.lastSeenAt,
      environment: DEFAULT_ENVIRONMENT,
      incidentPublicId: incident.publicId,
    });
    await deliveryRepo.recordAttempt({
      id: delivery.id,
      status: result.status,
      providerResultNormalized: result.providerResultNormalized,
      failureCategory: result.failureCategory,
    });
    await new OperationalIncidentRepository(this.pool).recordNotified(incident.id);
    return deliveryRepo.findById(delivery.id);
  }

  async notifyRecovery(incident: OperationalIncident, downtimeSeconds: number, channel: AlertChannel = "TELEGRAM"): Promise<AlertDelivery | null> {
    const config = await new AlertConfigurationRepository(this.pool).findByChannel(channel);
    if (!config || !config.enabled) return null;
    const deliveryRepo = new AlertDeliveryRepository(this.pool);
    const delivery = await deliveryRepo.create({ incidentId: incident.id, channel, kind: "RECOVERY", dedupKey: incident.dedupKey });
    const result = await this.adapter.sendRecovery({ service: incident.service, downtimeSeconds, incidentPublicId: incident.publicId });
    await deliveryRepo.recordAttempt({
      id: delivery.id,
      status: result.status,
      providerResultNormalized: result.providerResultNormalized,
      failureCategory: result.failureCategory,
    });
    return deliveryRepo.findById(delivery.id);
  }

  async sendTest(requestedByStaffAccountId: string, idempotencyKey: string, channel: AlertChannel = "TELEGRAM"): Promise<AlertDelivery> {
    const config = await new AlertConfigurationRepository(this.pool).findByChannel(channel);
    if (!config) {
      throw new PlatformAdminError("ALERT_CHANNEL_NOT_CONFIGURED", "No alert channel is CONFIGURED -- nothing to test.");
    }

    const idempotency = new IdempotencyRecordRepository(this.pool);
    const audit = new AuditRepository(this.pool);
    const scopeKey = `${requestedByStaffAccountId}:${idempotencyKey}`;
    const begin = await idempotency.begin({ tenantId: null, scope: ALERT_TEST_SCOPE, scopeKey, requestHash: channel });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") return begin.response as AlertDelivery;
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
      const deliveryRepo = new AlertDeliveryRepository(this.pool);
      const delivery = await deliveryRepo.create({ channel, kind: "TEST", requestedByStaffAccountId });
      const result = await this.adapter.sendTest();
      await deliveryRepo.recordAttempt({
        id: delivery.id,
        status: result.status,
        providerResultNormalized: result.providerResultNormalized,
        failureCategory: result.failureCategory,
      });
      const final = await deliveryRepo.findById(delivery.id);
      if (!final) throw new Error("sendTest: delivery vanished after recordAttempt");

      await idempotency.complete({ tenantId: null, scope: ALERT_TEST_SCOPE, scopeKey, expectedGeneration: begin.generation, response: final });
      await audit.record({
        tenantId: null,
        actorType: "PLATFORM_ADMIN",
        actorId: requestedByStaffAccountId,
        action: "operations.alert.test_sent",
        targetType: "alert_delivery",
        targetId: final.id,
        result: "SUCCESS",
        metadataRedacted: { channel, deliveryStatus: final.status },
      });
      return final;
    } catch (error) {
      await idempotency.fail({
        tenantId: null,
        scope: ALERT_TEST_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: true,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
