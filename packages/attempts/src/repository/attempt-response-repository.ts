import type { Queryable } from "./types";

export type AttemptResponseCorrectness = "CORRECT" | "INCORRECT" | "PARTIAL" | "UNSCORED";

export interface AttemptResponse {
  id: string;
  tenantId: string;
  attemptId: string;
  itemId: string;
  responseJson: Record<string, unknown>;
  correctness: AttemptResponseCorrectness | null;
  validatorVersion: string;
  createdAt: Date;
}

interface AttemptResponseRow {
  id: string;
  tenant_id: string;
  attempt_id: string;
  item_id: string;
  response_json: Record<string, unknown>;
  correctness: AttemptResponseCorrectness | null;
  validator_version: string;
  created_at: Date;
}

const SELECT_COLUMNS = `id, tenant_id, attempt_id, item_id, response_json, correctness, validator_version, created_at`;

function mapRow(row: AttemptResponseRow): AttemptResponse {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    attemptId: row.attempt_id,
    itemId: row.item_id,
    responseJson: row.response_json,
    correctness: row.correctness,
    validatorVersion: row.validator_version,
    createdAt: row.created_at,
  };
}

/**
 * `attempt_response` (migration 0003): one validated, scored item per
 * `(attempt_id, item_id)`. `validator_version` records exactly which
 * deterministic validator produced `correctness` — never accepted from the
 * client, always server-computed (see `AttemptConsolidationService`).
 */
export class AttemptResponseRepository {
  constructor(private readonly db: Queryable) {}

  async findByAttempt(attemptId: string, tenantId: string): Promise<AttemptResponse[]> {
    const result = await this.db.query<AttemptResponseRow>(
      `SELECT ${SELECT_COLUMNS} FROM attempt_response WHERE attempt_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
      [attemptId, tenantId],
    );
    return result.rows.map(mapRow);
  }

  /**
   * Idempotent by design: a retried consolidation for an item already
   * recorded is a no-op (`ON CONFLICT DO NOTHING`), never a second row and
   * never an error — the existing row (from the original, authoritative
   * computation) is returned instead.
   */
  async insert(input: {
    tenantId: string;
    attemptId: string;
    itemId: string;
    responseJson: Record<string, unknown>;
    correctness: AttemptResponseCorrectness;
    validatorVersion: string;
  }): Promise<AttemptResponse> {
    const inserted = await this.db.query<AttemptResponseRow>(
      `INSERT INTO attempt_response (tenant_id, attempt_id, item_id, response_json, correctness, validator_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (attempt_id, item_id) DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenantId,
        input.attemptId,
        input.itemId,
        JSON.stringify(input.responseJson),
        input.correctness,
        input.validatorVersion,
      ],
    );
    const [row] = inserted.rows;
    if (row) return mapRow(row);

    const result = await this.db.query<AttemptResponseRow>(
      `SELECT ${SELECT_COLUMNS} FROM attempt_response WHERE attempt_id = $1 AND tenant_id = $2 AND item_id = $3`,
      [input.attemptId, input.tenantId, input.itemId],
    );
    const [existing] = result.rows;
    if (!existing) throw new Error("attempt_response insert conflicted but no existing row was found");
    return mapRow(existing);
  }
}
