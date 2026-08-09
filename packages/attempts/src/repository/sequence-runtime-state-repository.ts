import type { Queryable } from "./types";
import { parseSequenceRuntimeState, type SequenceRuntimeState } from "@quest-city-web/content-runtime";

export interface PersistedSequenceRuntimeState {
  id: string;
  tenantId: string;
  studentProfileId: string;
  enrollmentId: string;
  sequenceId: string;
  sequenceVersion: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  state: SequenceRuntimeState;
}

interface SequenceRuntimeStateRow {
  id: string;
  tenant_id: string;
  student_profile_id: string;
  enrollment_id: string;
  sequence_id: string;
  sequence_version: string;
  state_json: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `id, tenant_id, student_profile_id, enrollment_id, sequence_id, sequence_version,
       state_json, version, created_at, updated_at`;

function mapRow(row: SequenceRuntimeStateRow): PersistedSequenceRuntimeState {
  const parsed = parseSequenceRuntimeState(row.state_json);
  if (!parsed.valid) {
    throw new Error(
      `sequence_runtime_state row ${row.id}: stored state_json fails contract validation: ${parsed.errors.join("; ")}`,
    );
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentProfileId: row.student_profile_id,
    enrollmentId: row.enrollment_id,
    sequenceId: row.sequence_id,
    sequenceVersion: row.sequence_version,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: parsed.data,
  };
}

/** Thrown by `create()` when a row for this (tenant, student, sequence) already exists — see UNIQUE (tenant_id, student_profile_id, sequence_id) — the caller should re-fetch rather than retry the insert. */
export class SequenceRuntimeStateAlreadyExistsError extends Error {
  constructor() {
    super("sequence_runtime_state: a row already exists for this (tenant, student, sequence)");
    this.name = "SequenceRuntimeStateAlreadyExistsError";
  }
}

/**
 * `sequence_runtime_state` (R3C.3 migration 0005). Owned/looked-up
 * exclusively by `(tenantId, studentProfileId, sequenceId)` — never by the
 * opaque `runtimeStateId` alone, so a caller cannot read or write another
 * student's progress by guessing or forging an id (02_36 §20-bis
 * ownership rule). Mirrors `LearningAttemptRepository`'s constructor-
 * injected `Queryable` pattern and `ReviewQueueItemRepository`'s
 * optimistic-concurrency `version` column — no shared base-repository
 * class, same as every other repository in this package.
 */
export class SequenceRuntimeStateRepository {
  constructor(private readonly db: Queryable) {}

  async findByStudentAndSequence(
    tenantId: string,
    studentProfileId: string,
    sequenceId: string,
  ): Promise<PersistedSequenceRuntimeState | null> {
    const result = await this.db.query<SequenceRuntimeStateRow>(
      `SELECT ${SELECT_COLUMNS} FROM sequence_runtime_state
       WHERE tenant_id = $1 AND student_profile_id = $2 AND sequence_id = $3`,
      [tenantId, studentProfileId, sequenceId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /**
   * Throws `SequenceRuntimeStateAlreadyExistsError` (Postgres unique
   * violation, code 23505) if a concurrent request already created a row
   * for this (tenant, student, sequence) — the caller re-fetches via
   * `findByStudentAndSequence` rather than blindly retrying the insert.
   */
  async create(input: {
    tenantId: string;
    studentProfileId: string;
    enrollmentId: string;
    state: SequenceRuntimeState;
  }): Promise<PersistedSequenceRuntimeState> {
    const parsed = parseSequenceRuntimeState(input.state);
    if (!parsed.valid) {
      throw new Error(`sequence_runtime_state.create: state fails contract validation: ${parsed.errors.join("; ")}`);
    }
    try {
      const result = await this.db.query<SequenceRuntimeStateRow>(
        `INSERT INTO sequence_runtime_state
           (tenant_id, student_profile_id, enrollment_id, sequence_id, sequence_version,
            runtime_state_id, current_stage_id, sequence_completion_state, state_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${SELECT_COLUMNS}`,
        [
          input.tenantId,
          input.studentProfileId,
          input.enrollmentId,
          input.state.sequenceId,
          input.state.sequenceVersion,
          input.state.runtimeStateId,
          input.state.currentStageId,
          input.state.sequenceCompletionState,
          JSON.stringify(input.state),
        ],
      );
      const [row] = result.rows;
      if (!row) throw new Error("INSERT ... RETURNING produced no row");
      return mapRow(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SequenceRuntimeStateAlreadyExistsError();
      }
      throw error;
    }
  }

  /**
   * Optimistic-concurrency save, same shape as
   * `ReviewQueueItemRepository.transitionStatus`: `expectedVersion` must
   * match the current row or zero rows are updated (returns `null`) — the
   * caller maps that to a version-conflict response, never a blind
   * overwrite or automatic retry.
   */
  async save(
    tenantId: string,
    studentProfileId: string,
    sequenceId: string,
    expectedVersion: number,
    state: SequenceRuntimeState,
  ): Promise<PersistedSequenceRuntimeState | null> {
    const parsed = parseSequenceRuntimeState(state);
    if (!parsed.valid) {
      throw new Error(`sequence_runtime_state.save: state fails contract validation: ${parsed.errors.join("; ")}`);
    }
    const result = await this.db.query<SequenceRuntimeStateRow>(
      `UPDATE sequence_runtime_state
       SET current_stage_id = $5,
           sequence_completion_state = $6,
           state_json = $7,
           version = version + 1,
           updated_at = now()
       WHERE tenant_id = $1 AND student_profile_id = $2 AND sequence_id = $3 AND version = $4
       RETURNING ${SELECT_COLUMNS}`,
      [tenantId, studentProfileId, sequenceId, expectedVersion, state.currentStageId, state.sequenceCompletionState, JSON.stringify(state)],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505";
}
