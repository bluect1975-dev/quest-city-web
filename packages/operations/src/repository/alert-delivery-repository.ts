import type { Queryable } from "./types";
import type { AlertChannel } from "./alert-configuration-repository";

export type AlertDeliveryKind = "ALERT" | "RECOVERY" | "TEST";
export type AlertDeliveryStatus = "PENDING" | "SENT" | "FAILED";

export interface AlertDelivery {
  id: string;
  incidentId: string | null;
  channel: AlertChannel;
  kind: AlertDeliveryKind;
  status: AlertDeliveryStatus;
  attemptCount: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  providerResultNormalized: string | null;
  failureCategory: string | null;
  dedupKey: string | null;
  requestedByStaffAccountId: string | null;
  createdAt: Date;
}

interface AlertDeliveryRow {
  id: string;
  incident_id: string | null;
  channel: AlertChannel;
  kind: AlertDeliveryKind;
  status: AlertDeliveryStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  next_retry_at: Date | null;
  provider_result_normalized: string | null;
  failure_category: string | null;
  dedup_key: string | null;
  requested_by_staff_account_id: string | null;
  created_at: Date;
}

const SELECT_COLUMNS = `id, incident_id, channel, kind, status, attempt_count, last_attempt_at, next_retry_at,
  provider_result_normalized, failure_category, dedup_key, requested_by_staff_account_id, created_at`;

function mapRow(row: AlertDeliveryRow): AlertDelivery {
  return {
    id: row.id,
    incidentId: row.incident_id,
    channel: row.channel,
    kind: row.kind,
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    nextRetryAt: row.next_retry_at,
    providerResultNormalized: row.provider_result_normalized,
    failureCategory: row.failure_category,
    dedupKey: row.dedup_key,
    requestedByStaffAccountId: row.requested_by_staff_account_id,
    createdAt: row.created_at,
  };
}

/** Delivery attempt/status tracking, distinct from the incident itself (02_42 §36-37). Never persists a provider secret. */
export class AlertDeliveryRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: {
    incidentId?: string | null;
    channel: AlertChannel;
    kind: AlertDeliveryKind;
    dedupKey?: string | null;
    requestedByStaffAccountId?: string | null;
  }): Promise<AlertDelivery> {
    const result = await this.db.query<AlertDeliveryRow>(
      `INSERT INTO alert_delivery (incident_id, channel, kind, dedup_key, requested_by_staff_account_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SELECT_COLUMNS}`,
      [input.incidentId ?? null, input.channel, input.kind, input.dedupKey ?? null, input.requestedByStaffAccountId ?? null],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  async recordAttempt(input: {
    id: string;
    status: AlertDeliveryStatus;
    providerResultNormalized?: string | null;
    failureCategory?: string | null;
    nextRetryAt?: Date | null;
  }): Promise<AlertDelivery> {
    const result = await this.db.query<AlertDeliveryRow>(
      `UPDATE alert_delivery
       SET status = $2, attempt_count = attempt_count + 1, last_attempt_at = now(),
           provider_result_normalized = $3, failure_category = $4, next_retry_at = $5
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [input.id, input.status, input.providerResultNormalized ?? null, input.failureCategory ?? null, input.nextRetryAt ?? null],
    );
    const [row] = result.rows;
    if (!row) throw new Error("recordAttempt: delivery not found");
    return mapRow(row);
  }

  async listRecentFailed(limit = 20): Promise<AlertDelivery[]> {
    const result = await this.db.query<AlertDeliveryRow>(
      `SELECT ${SELECT_COLUMNS} FROM alert_delivery WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapRow);
  }

  async findById(id: string): Promise<AlertDelivery | null> {
    const result = await this.db.query<AlertDeliveryRow>(`SELECT ${SELECT_COLUMNS} FROM alert_delivery WHERE id = $1`, [id]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
