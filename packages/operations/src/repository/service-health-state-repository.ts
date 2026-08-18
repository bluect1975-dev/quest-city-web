import type { Queryable } from "./types";

export type ServiceHealthState = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";

export interface ServiceHealthEntry {
  id: string;
  service: string;
  state: ServiceHealthState;
  latencyMs: number | null;
  detail: Record<string, unknown>;
  checkedAt: Date;
}

interface ServiceHealthRow {
  id: string;
  service: string;
  state: ServiceHealthState;
  latency_ms: string | null;
  detail: Record<string, unknown>;
  checked_at: Date;
}

const SELECT_COLUMNS = `id, service, state, latency_ms, detail, checked_at`;

function mapRow(row: ServiceHealthRow): ServiceHealthEntry {
  return {
    id: row.id,
    service: row.service,
    state: row.state,
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    detail: row.detail,
    checkedAt: row.checked_at,
  };
}

/** Current + historical per-service health state (02_42 §21-23), distinct from raw metric samples. */
export class ServiceHealthStateRepository {
  constructor(private readonly db: Queryable) {}

  async record(input: {
    service: string;
    state: ServiceHealthState;
    latencyMs?: number | null;
    detail?: Record<string, unknown>;
  }): Promise<ServiceHealthEntry> {
    const result = await this.db.query<ServiceHealthRow>(
      `INSERT INTO service_health_state (service, state, latency_ms, detail)
       VALUES ($1, $2, $3, $4)
       RETURNING ${SELECT_COLUMNS}`,
      [input.service, input.state, input.latencyMs ?? null, JSON.stringify(input.detail ?? {})],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** Latest recorded state per distinct service -- the primary read for global aggregation (02_42 §21-23). */
  async listLatestPerService(): Promise<ServiceHealthEntry[]> {
    const result = await this.db.query<ServiceHealthRow>(
      `SELECT DISTINCT ON (service) ${SELECT_COLUMNS}
       FROM service_health_state
       ORDER BY service, checked_at DESC`,
    );
    return result.rows.map(mapRow);
  }
}
