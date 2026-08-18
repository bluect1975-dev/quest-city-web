import type { Queryable } from "./types";
import type { EffectiveResolution } from "../resolver/resolve-effective-availability";

export interface LearningPathSnapshot {
  id: string;
  tenantId: string;
  learningAttemptId: string;
  resolvedAvailability: EffectiveResolution;
  capturedAt: Date;
}

interface Row {
  id: string;
  tenant_id: string;
  learning_attempt_id: string;
  resolved_availability: EffectiveResolution;
  captured_at: Date;
}

const SELECT_COLUMNS = `id, tenant_id, learning_attempt_id, resolved_availability, captured_at`;

function mapRow(row: Row): LearningPathSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    learningAttemptId: row.learning_attempt_id,
    resolvedAvailability: row.resolved_availability,
    capturedAt: row.captured_at,
  };
}

/**
 * `learning_path_snapshot` (02_41 §33-34, §42, migration 0013) -- captured
 * once at `learning_attempt` creation, never mutated afterward
 * (finish-current-attempt, 02_41 §23). One row per attempt (DB `UNIQUE
 * (learning_attempt_id)`) -- `capture()` is therefore write-once by
 * construction; a second call for the same attempt hits the unique
 * constraint rather than silently overwriting an already-active attempt's
 * frozen configuration.
 */
export class LearningPathSnapshotRepository {
  constructor(private readonly db: Queryable) {}

  async findByAttemptId(learningAttemptId: string, tenantId: string): Promise<LearningPathSnapshot | null> {
    const result = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM learning_path_snapshot WHERE learning_attempt_id = $1 AND tenant_id = $2`, [
      learningAttemptId,
      tenantId,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async capture(input: { tenantId: string; learningAttemptId: string; resolvedAvailability: EffectiveResolution }): Promise<LearningPathSnapshot> {
    const result = await this.db.query<Row>(
      `INSERT INTO learning_path_snapshot (tenant_id, learning_attempt_id, resolved_availability)
       VALUES ($1, $2, $3)
       RETURNING ${SELECT_COLUMNS}`,
      [input.tenantId, input.learningAttemptId, JSON.stringify(input.resolvedAvailability)],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }
}
