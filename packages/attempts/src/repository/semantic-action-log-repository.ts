import type { Queryable } from "./types";

export type SemanticActionType =
  | "SELECT_OPTION"
  | "ENTER_VALUE"
  | "PLACE_ITEM"
  | "MOVE_ITEM"
  | "CONNECT_NODES"
  | "ORDER_ITEMS"
  | "REQUEST_HINT"
  | "CONFIRM_SOLUTION"
  | "RESET_STAGE"
  | "PAUSE_ACTIVITY"
  | "RESUME_ACTIVITY";

export interface SemanticActionLogEntry {
  id: string;
  tenantId: string;
  attemptId: string;
  actionId: string;
  actionType: SemanticActionType;
  targetRole: string | null;
  payload: Record<string, unknown>;
  clientSequence: number;
  runtimeChannel: "WEB" | "ROBLOX";
  adapterVersion: string | null;
  occurredAt: Date;
  createdAt: Date;
}

interface SemanticActionLogRow {
  id: string;
  tenant_id: string;
  attempt_id: string;
  action_id: string;
  action_type: SemanticActionType;
  target_role: string | null;
  payload_json: Record<string, unknown>;
  client_sequence: number;
  runtime_channel: "WEB" | "ROBLOX";
  adapter_version: string | null;
  occurred_at: Date;
  created_at: Date;
}

const SELECT_COLUMNS = `id, tenant_id, attempt_id, action_id, action_type, target_role, payload_json,
       client_sequence, runtime_channel, adapter_version, occurred_at, created_at`;

function mapRow(row: SemanticActionLogRow): SemanticActionLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    attemptId: row.attempt_id,
    actionId: row.action_id,
    actionType: row.action_type,
    targetRole: row.target_role,
    payload: row.payload_json,
    clientSequence: row.client_sequence,
    runtimeChannel: row.runtime_channel,
    adapterVersion: row.adapter_version,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

/**
 * Append-only by design (07_15_01 v1.1, AGENTS.md v4.30): this repository
 * deliberately exposes no update/delete method — the database trigger
 * `semantic_action_log_no_update`/`_no_delete` (migration 0003) is the
 * real enforcement, this is the matching application-level surface.
 */
export class SemanticActionLogRepository {
  constructor(private readonly db: Queryable) {}

  async findByAttempt(attemptId: string, tenantId: string): Promise<SemanticActionLogEntry[]> {
    const result = await this.db.query<SemanticActionLogRow>(
      `SELECT ${SELECT_COLUMNS} FROM semantic_action_log WHERE attempt_id = $1 AND tenant_id = $2 ORDER BY client_sequence ASC`,
      [attemptId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  async findByAttemptAndActionId(
    attemptId: string,
    tenantId: string,
    actionId: string,
  ): Promise<SemanticActionLogEntry | null> {
    const result = await this.db.query<SemanticActionLogRow>(
      `SELECT ${SELECT_COLUMNS} FROM semantic_action_log WHERE attempt_id = $1 AND tenant_id = $2 AND action_id = $3`,
      [attemptId, tenantId, actionId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /**
   * Insert-only. Deduplicated by (attempt_id, action_id) and
   * (attempt_id, client_sequence) — a conflicting insert throws, the
   * caller (service layer) is expected to check
   * `findByAttemptAndActionId` first to distinguish a legitimate retry
   * (same actionId already logged) from a genuine unique-constraint error.
   */
  async insert(input: {
    tenantId: string;
    attemptId: string;
    actionId: string;
    actionType: SemanticActionType;
    targetRole?: string | null;
    payload: Record<string, unknown>;
    clientSequence: number;
    runtimeChannel: "WEB" | "ROBLOX";
    adapterVersion?: string | null;
    occurredAt: Date;
  }): Promise<SemanticActionLogEntry> {
    const result = await this.db.query<SemanticActionLogRow>(
      `INSERT INTO semantic_action_log
         (tenant_id, attempt_id, action_id, action_type, target_role, payload_json,
          client_sequence, runtime_channel, adapter_version, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenantId,
        input.attemptId,
        input.actionId,
        input.actionType,
        input.targetRole ?? null,
        JSON.stringify(input.payload),
        input.clientSequence,
        input.runtimeChannel,
        input.adapterVersion ?? null,
        input.occurredAt,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }
}
