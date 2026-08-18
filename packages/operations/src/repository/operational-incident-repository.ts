import { randomUUID } from "node:crypto";
import type { Queryable } from "./types";
import type { MetricSource } from "./operational-metric-sample-repository";

export type OperationalIncidentSeverity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";
export type OperationalIncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "SUPPRESSED";

export interface OperationalIncident {
  id: string;
  publicId: string;
  type: string;
  severity: OperationalIncidentSeverity;
  source: MetricSource;
  service: string;
  summary: string;
  status: OperationalIncidentStatus;
  dedupKey: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number;
  acknowledgedAt: Date | null;
  acknowledgedByStaffAccountId: string | null;
  resolvedAt: Date | null;
  resolutionType: string | null;
  tenantId: string | null;
  lastNotifiedAt: Date | null;
}

interface OperationalIncidentRow {
  id: string;
  public_id: string;
  type: string;
  severity: OperationalIncidentSeverity;
  source: MetricSource;
  service: string;
  summary: string;
  status: OperationalIncidentStatus;
  dedup_key: string;
  first_seen_at: Date;
  last_seen_at: Date;
  occurrence_count: number;
  acknowledged_at: Date | null;
  acknowledged_by_staff_account_id: string | null;
  resolved_at: Date | null;
  resolution_type: string | null;
  tenant_id: string | null;
  last_notified_at: Date | null;
}

const SELECT_COLUMNS = `id, public_id, type, severity, source, service, summary, status, dedup_key,
  first_seen_at, last_seen_at, occurrence_count, acknowledged_at, acknowledged_by_staff_account_id,
  resolved_at, resolution_type, tenant_id, last_notified_at`;

function mapRow(row: OperationalIncidentRow): OperationalIncident {
  return {
    id: row.id,
    publicId: row.public_id,
    type: row.type,
    severity: row.severity,
    source: row.source,
    service: row.service,
    summary: row.summary,
    status: row.status,
    dedupKey: row.dedup_key,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    occurrenceCount: row.occurrence_count,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedByStaffAccountId: row.acknowledged_by_staff_account_id,
    resolvedAt: row.resolved_at,
    resolutionType: row.resolution_type,
    tenantId: row.tenant_id,
    lastNotifiedAt: row.last_notified_at,
  };
}

/** Dedup key = (type, service, source), 02_42 §27 -- deterministic, order-stable string, never derived differently in two places. */
export function buildIncidentDedupKey(type: string, service: string, source: MetricSource): string {
  return `${type}::${service}::${source}`;
}

export class OperationalIncidentRepository {
  constructor(private readonly db: Queryable) {}

  async findOpenOrAcknowledgedByDedupKey(dedupKey: string): Promise<OperationalIncident | null> {
    const result = await this.db.query<OperationalIncidentRow>(
      `SELECT ${SELECT_COLUMNS} FROM operational_incident
       WHERE dedup_key = $1 AND status IN ('OPEN', 'ACKNOWLEDGED')`,
      [dedupKey],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findById(id: string): Promise<OperationalIncident | null> {
    const result = await this.db.query<OperationalIncidentRow>(`SELECT ${SELECT_COLUMNS} FROM operational_incident WHERE id = $1`, [
      id,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async create(input: {
    type: string;
    severity: OperationalIncidentSeverity;
    source: MetricSource;
    service: string;
    summary: string;
    tenantId?: string | null;
  }): Promise<OperationalIncident> {
    const publicId = `inc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const dedupKey = buildIncidentDedupKey(input.type, input.service, input.source);
    const result = await this.db.query<OperationalIncidentRow>(
      `INSERT INTO operational_incident (public_id, type, severity, source, service, summary, dedup_key, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SELECT_COLUMNS}`,
      [publicId, input.type, input.severity, input.source, input.service, input.summary, dedupKey, input.tenantId ?? null],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** Repeated identical condition -- update last_seen_at/occurrence_count on the existing row, never a duplicate row (02_42 §27). */
  async recordOccurrence(id: string): Promise<OperationalIncident> {
    const result = await this.db.query<OperationalIncidentRow>(
      `UPDATE operational_incident
       SET last_seen_at = now(), occurrence_count = occurrence_count + 1, updated_at = now()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [id],
    );
    const [row] = result.rows;
    if (!row) throw new Error("recordOccurrence: incident not found");
    return mapRow(row);
  }

  async acknowledge(id: string, staffAccountId: string): Promise<OperationalIncident | null> {
    const result = await this.db.query<OperationalIncidentRow>(
      `UPDATE operational_incident
       SET status = 'ACKNOWLEDGED', acknowledged_at = now(), acknowledged_by_staff_account_id = $2, updated_at = now()
       WHERE id = $1 AND status = 'OPEN'
       RETURNING ${SELECT_COLUMNS}`,
      [id, staffAccountId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async resolve(id: string, resolutionType: string): Promise<OperationalIncident> {
    const result = await this.db.query<OperationalIncidentRow>(
      `UPDATE operational_incident
       SET status = 'RESOLVED', resolved_at = now(), resolution_type = $2, updated_at = now()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [id, resolutionType],
    );
    const [row] = result.rows;
    if (!row) throw new Error("resolve: incident not found");
    return mapRow(row);
  }

  async recordNotified(id: string): Promise<void> {
    await this.db.query(`UPDATE operational_incident SET last_notified_at = now() WHERE id = $1`, [id]);
  }

  async list(filter: {
    status?: OperationalIncidentStatus;
    severity?: OperationalIncidentSeverity;
    service?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<OperationalIncident[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.severity) {
      params.push(filter.severity);
      conditions.push(`severity = $${params.length}`);
    }
    if (filter.service) {
      params.push(filter.service);
      conditions.push(`service = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      conditions.push(`last_seen_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      conditions.push(`last_seen_at <= $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(filter.limit ?? 50);
    params.push(filter.offset ?? 0);
    const result = await this.db.query<OperationalIncidentRow>(
      `SELECT ${SELECT_COLUMNS} FROM operational_incident
       ${where}
       ORDER BY last_seen_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return result.rows.map(mapRow);
  }

  async countOpen(): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM operational_incident WHERE status IN ('OPEN', 'ACKNOWLEDGED')`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
