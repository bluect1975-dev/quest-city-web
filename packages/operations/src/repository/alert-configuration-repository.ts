import type { Queryable } from "./types";
import type { OperationalIncidentSeverity } from "./operational-incident-repository";

export type AlertChannel = "TELEGRAM";

export interface AlertConfiguration {
  id: string;
  channel: AlertChannel;
  enabled: boolean;
  severityThreshold: OperationalIncidentSeverity;
  cooldownSeconds: number;
  recipientRef: string | null;
  credentialRef: string | null;
  escalation: Record<string, unknown>;
  updatedAt: Date;
  updatedByStaffAccountId: string | null;
}

interface AlertConfigurationRow {
  id: string;
  channel: AlertChannel;
  enabled: boolean;
  severity_threshold: OperationalIncidentSeverity;
  cooldown_seconds: number;
  recipient_ref: string | null;
  credential_ref: string | null;
  escalation_json: Record<string, unknown>;
  updated_at: Date;
  updated_by_staff_account_id: string | null;
}

const SELECT_COLUMNS = `id, channel, enabled, severity_threshold, cooldown_seconds, recipient_ref, credential_ref,
  escalation_json, updated_at, updated_by_staff_account_id`;

function mapRow(row: AlertConfigurationRow): AlertConfiguration {
  return {
    id: row.id,
    channel: row.channel,
    enabled: row.enabled,
    severityThreshold: row.severity_threshold,
    cooldownSeconds: row.cooldown_seconds,
    recipientRef: row.recipient_ref,
    credentialRef: row.credential_ref,
    escalation: row.escalation_json,
    updatedAt: row.updated_at,
    updatedByStaffAccountId: row.updated_by_staff_account_id,
  };
}

/** One row per channel (today: TELEGRAM only). Never stores the Bot Token itself -- credentialRef is an env-var-name pointer (02_42 §30, 07_06 §9). */
export class AlertConfigurationRepository {
  constructor(private readonly db: Queryable) {}

  async findByChannel(channel: AlertChannel): Promise<AlertConfiguration | null> {
    const result = await this.db.query<AlertConfigurationRow>(`SELECT ${SELECT_COLUMNS} FROM alert_configuration WHERE channel = $1`, [
      channel,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Upsert -- a channel has at most one configuration row, ever (UNIQUE channel). */
  async upsert(input: {
    channel: AlertChannel;
    enabled: boolean;
    severityThreshold: OperationalIncidentSeverity;
    cooldownSeconds: number;
    recipientRef?: string | null;
    credentialRef?: string | null;
    escalation?: Record<string, unknown>;
    updatedByStaffAccountId: string;
  }): Promise<AlertConfiguration> {
    const result = await this.db.query<AlertConfigurationRow>(
      `INSERT INTO alert_configuration (channel, enabled, severity_threshold, cooldown_seconds, recipient_ref, credential_ref, escalation_json, updated_by_staff_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (channel) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         severity_threshold = EXCLUDED.severity_threshold,
         cooldown_seconds = EXCLUDED.cooldown_seconds,
         recipient_ref = EXCLUDED.recipient_ref,
         credential_ref = EXCLUDED.credential_ref,
         escalation_json = EXCLUDED.escalation_json,
         updated_at = now(),
         updated_by_staff_account_id = EXCLUDED.updated_by_staff_account_id
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.channel,
        input.enabled,
        input.severityThreshold,
        input.cooldownSeconds,
        input.recipientRef ?? null,
        input.credentialRef ?? null,
        JSON.stringify(input.escalation ?? {}),
        input.updatedByStaffAccountId,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("UPSERT ... RETURNING produced no row");
    return mapRow(row);
  }
}
