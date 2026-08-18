import type { OperationalIncidentSeverity } from "../repository/operational-incident-repository";

export interface OperationalAlertPayload {
  severity: OperationalIncidentSeverity;
  service: string;
  problem: string;
  detectedAt: Date;
  environment: string;
  incidentPublicId: string;
}

export interface OperationalRecoveryPayload {
  service: string;
  downtimeSeconds: number;
  incidentPublicId: string;
}

export interface AlertDeliveryResult {
  status: "SENT" | "FAILED";
  providerResultNormalized: string | null;
  failureCategory: string | null;
}

/**
 * Provider-neutral alert channel abstraction (02_42 §28) -- introduced for
 * the first time by this feature; no prior "alert channel" pattern existed
 * in this codebase to inherit. `sendTest` messages are always
 * self-identifying (02_42 §33) at the caller/template layer, not here.
 */
export interface AlertChannelAdapter {
  sendAlert(payload: OperationalAlertPayload): Promise<AlertDeliveryResult>;
  sendRecovery(payload: OperationalRecoveryPayload): Promise<AlertDeliveryResult>;
  sendTest(): Promise<AlertDeliveryResult>;
}

function formatAlertMessage(payload: OperationalAlertPayload): string {
  // 02_42 §31 template -- never includes student PII, Restricted+ data,
  // free-text, tokens, or stack traces; the payload type itself makes
  // including any of those impossible (it only carries these six fields).
  return [
    "QUEST CITY ALERT",
    `Severity: ${payload.severity}`,
    `Service: ${payload.service}`,
    `Problem: ${payload.problem}`,
    `Detected: ${payload.detectedAt.toISOString()}`,
    `Environment: ${payload.environment}`,
    `Incident: ${payload.incidentPublicId}`,
  ].join("\n");
}

function formatRecoveryMessage(payload: OperationalRecoveryPayload): string {
  const minutes = Math.floor(payload.downtimeSeconds / 60);
  const seconds = payload.downtimeSeconds % 60;
  return [
    "QUEST CITY RECOVERY",
    `Service: ${payload.service}`,
    "Status: RESTORED",
    `Downtime: ${minutes}m ${seconds}s`,
    `Incident: ${payload.incidentPublicId}`,
  ].join("\n");
}

function formatTestMessage(): string {
  return ["QUEST CITY ALERT", "This is a TEST alert from the Master Admin Operations Control Center.", "No real incident."].join(
    "\n",
  );
}

/**
 * Log-only adapter. Mandatory for local dev/test (mission §45) -- no
 * Telegram account is ever required to exercise the alert pipeline.
 */
export class LocalMockAlertChannelAdapter implements AlertChannelAdapter {
  readonly sentMessages: string[] = [];
  private failNext = false;

  /** Test hook: makes the next call fail, to exercise delivery-failure handling deterministically. */
  simulateNextFailure(): void {
    this.failNext = true;
  }

  private deliver(message: string): AlertDeliveryResult {
    this.sentMessages.push(message);
    if (this.failNext) {
      this.failNext = false;
      return { status: "FAILED", providerResultNormalized: null, failureCategory: "SIMULATED_FAILURE" };
    }
    return { status: "SENT", providerResultNormalized: "mock-ok", failureCategory: null };
  }

  async sendAlert(payload: OperationalAlertPayload): Promise<AlertDeliveryResult> {
    return this.deliver(formatAlertMessage(payload));
  }

  async sendRecovery(payload: OperationalRecoveryPayload): Promise<AlertDeliveryResult> {
    return this.deliver(formatRecoveryMessage(payload));
  }

  async sendTest(): Promise<AlertDeliveryResult> {
    return this.deliver(formatTestMessage());
  }
}

export interface TelegramAdapterConfig {
  botToken: string;
  chatId: string;
}

/**
 * Real Telegram Bot API adapter (02_42 §21-22). Bot token is injected at
 * construction time from a server-side secret (07_06 §9 regime) -- never
 * read from a request, never logged, never returned by any method.
 */
export class TelegramAlertChannelAdapter implements AlertChannelAdapter {
  constructor(private readonly config: TelegramAdapterConfig) {}

  private async sendMessage(text: string): Promise<AlertDeliveryResult> {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: this.config.chatId, text }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return { status: "FAILED", providerResultNormalized: `http_${response.status}`, failureCategory: "PROVIDER_ERROR" };
      }
      return { status: "SENT", providerResultNormalized: "telegram-ok", failureCategory: null };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "TimeoutError";
      return {
        status: "FAILED",
        providerResultNormalized: null,
        failureCategory: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
      };
    }
  }

  async sendAlert(payload: OperationalAlertPayload): Promise<AlertDeliveryResult> {
    return this.sendMessage(formatAlertMessage(payload));
  }

  async sendRecovery(payload: OperationalRecoveryPayload): Promise<AlertDeliveryResult> {
    return this.sendMessage(formatRecoveryMessage(payload));
  }

  async sendTest(): Promise<AlertDeliveryResult> {
    return this.sendMessage(formatTestMessage());
  }
}
