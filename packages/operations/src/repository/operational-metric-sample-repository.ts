import type { Queryable } from "./types";

export type MetricSource =
  | "APPLICATION"
  | "DATABASE"
  | "HOST"
  | "CONTAINER"
  | "REVERSE_PROXY"
  | "BACKUP"
  | "TLS"
  | "EXTERNAL_MONITOR";

export type MetricSampleStatus = "OK" | "WARNING" | "CRITICAL" | "UNKNOWN";

export interface MetricSample {
  id: string;
  source: MetricSource;
  metricKey: string;
  value: number;
  unit: string;
  status: MetricSampleStatus;
  threshold: number | null;
  sampledAt: Date;
}

interface MetricSampleRow {
  id: string;
  source: MetricSource;
  metric_key: string;
  value: string;
  unit: string;
  status: MetricSampleStatus;
  threshold: string | null;
  sampled_at: Date;
}

const SELECT_COLUMNS = `id, source, metric_key, value, unit, status, threshold, sampled_at`;

function mapRow(row: MetricSampleRow): MetricSample {
  return {
    id: row.id,
    source: row.source,
    metricKey: row.metric_key,
    value: Number(row.value),
    unit: row.unit,
    status: row.status,
    threshold: row.threshold === null ? null : Number(row.threshold),
    sampledAt: row.sampled_at,
  };
}

/**
 * Single generic time-series table for infrastructure/usage/activity/
 * error-aggregate metrics alike (02_42 §17-19, §36, §40) -- one table,
 * not one per metric domain. Bounded retention (02_42 §45) is enforced by
 * `pruneOlderThan`, called by the local metric collector's own periodic
 * loop, never automatically inside a read path.
 */
export class OperationalMetricSampleRepository {
  constructor(private readonly db: Queryable) {}

  async record(input: {
    source: MetricSource;
    metricKey: string;
    value: number;
    unit: string;
    status: MetricSampleStatus;
    threshold?: number | null;
    sampledAt?: Date;
  }): Promise<MetricSample> {
    const result = await this.db.query<MetricSampleRow>(
      `INSERT INTO operational_metric_sample (source, metric_key, value, unit, status, threshold, sampled_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.source,
        input.metricKey,
        input.value,
        input.unit,
        input.status,
        input.threshold ?? null,
        input.sampledAt ?? null,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  async list(filter: {
    source: MetricSource;
    metricKey?: string;
    from: Date;
    to: Date;
    limit?: number;
  }): Promise<MetricSample[]> {
    const conditions: string[] = ["source = $1", "sampled_at >= $2", "sampled_at <= $3"];
    const params: unknown[] = [filter.source, filter.from, filter.to];
    if (filter.metricKey) {
      params.push(filter.metricKey);
      conditions.push(`metric_key = $${params.length}`);
    }
    params.push(filter.limit ?? 500);
    const result = await this.db.query<MetricSampleRow>(
      `SELECT ${SELECT_COLUMNS} FROM operational_metric_sample
       WHERE ${conditions.join(" AND ")}
       ORDER BY sampled_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(mapRow);
  }

  /** MAX(value) over the window -- used for peak-concurrency KPIs (02_42 §17), never recomputed from raw presence history. */
  async maxValue(metricKey: string, from: Date, to: Date): Promise<number | null> {
    const result = await this.db.query<{ max: string | null }>(
      `SELECT MAX(value) AS max FROM operational_metric_sample
       WHERE metric_key = $1 AND sampled_at >= $2 AND sampled_at <= $3`,
      [metricKey, from, to],
    );
    const value = result.rows[0]?.max;
    return value === null || value === undefined ? null : Number(value);
  }

  /** Bounded retention (02_42 §45) -- caller-driven, never automatic on a read path. */
  async pruneOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db.query(`DELETE FROM operational_metric_sample WHERE sampled_at < $1`, [cutoff]);
    return result.rowCount ?? 0;
  }
}
