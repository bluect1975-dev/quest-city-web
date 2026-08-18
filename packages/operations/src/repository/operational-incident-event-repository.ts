import type { Queryable } from "./types";

export type OperationalIncidentEventType =
  | "OPENED"
  | "REOPENED"
  | "OCCURRENCE"
  | "ACKNOWLEDGED"
  | "RESOLVED"
  | "SUPPRESSED"
  | "NOTE";

export interface OperationalIncidentEvent {
  id: string;
  incidentId: string;
  eventType: OperationalIncidentEventType;
  detail: Record<string, unknown>;
  actorType: string | null;
  actorId: string | null;
  createdAt: Date;
}

interface OperationalIncidentEventRow {
  id: string;
  incident_id: string;
  event_type: OperationalIncidentEventType;
  detail: Record<string, unknown>;
  actor_type: string | null;
  actor_id: string | null;
  created_at: Date;
}

const SELECT_COLUMNS = `id, incident_id, event_type, detail, actor_type, actor_id, created_at`;

function mapRow(row: OperationalIncidentEventRow): OperationalIncidentEvent {
  return {
    id: row.id,
    incidentId: row.incident_id,
    eventType: row.event_type,
    detail: row.detail,
    actorType: row.actor_type,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

/** Append-only timeline per incident (02_42 §25, mirrors 07_06 §19's narrative timeline requirement). */
export class OperationalIncidentEventRepository {
  constructor(private readonly db: Queryable) {}

  async record(input: {
    incidentId: string;
    eventType: OperationalIncidentEventType;
    detail?: Record<string, unknown>;
    actorType?: string | null;
    actorId?: string | null;
  }): Promise<OperationalIncidentEvent> {
    const result = await this.db.query<OperationalIncidentEventRow>(
      `INSERT INTO operational_incident_event (incident_id, event_type, detail, actor_type, actor_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SELECT_COLUMNS}`,
      [input.incidentId, input.eventType, JSON.stringify(input.detail ?? {}), input.actorType ?? null, input.actorId ?? null],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  async listByIncident(incidentId: string): Promise<OperationalIncidentEvent[]> {
    const result = await this.db.query<OperationalIncidentEventRow>(
      `SELECT ${SELECT_COLUMNS} FROM operational_incident_event WHERE incident_id = $1 ORDER BY created_at ASC`,
      [incidentId],
    );
    return result.rows.map(mapRow);
  }
}
