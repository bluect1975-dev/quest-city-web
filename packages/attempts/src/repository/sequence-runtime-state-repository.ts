import type { Queryable } from "./types";
import { parseSequenceRuntimeState, type SequenceRuntimeState } from "@quest-city-web/content-runtime";

export interface PersistedSequenceRuntimeState {
  id: string;
  tenantId: string;
  studentProfileId: string;
  enrollmentId: string;
  learningAttemptId: string;
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
  learning_attempt_id: string;
  sequence_id: string;
  sequence_version: string;
  state_json: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `id, tenant_id, student_profile_id, enrollment_id, learning_attempt_id, sequence_id,
       sequence_version, state_json, version, created_at, updated_at`;

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
    learningAttemptId: row.learning_attempt_id,
    sequenceId: row.sequence_id,
    sequenceVersion: row.sequence_version,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: parsed.data,
  };
}

/** Thrown by `create()` when a row for this (tenant, attempt) already exists — see UNIQUE (tenant_id, learning_attempt_id) — the caller should re-fetch rather than retry the insert. */
export class SequenceRuntimeStateAlreadyExistsError extends Error {
  constructor() {
    super("sequence_runtime_state: a row already exists for this (tenant, attempt)");
    this.name = "SequenceRuntimeStateAlreadyExistsError";
  }
}

/**
 * `sequence_runtime_state` (R3C.3 migration 0005; re-scoped to per-attempt
 * ownership by migration 0019 — UAT Failure Remediation,
 * `UAT-RC4-NEW-ASSIGNMENT-LAUNCH-STATE-01`). Owned/looked-up exclusively
 * by `(tenantId, learningAttemptId)` — never by `sequenceId` alone (two
 * independent attempts, e.g. from two separate assignments, against the
 * SAME sequence must never share progress/completion state) and never by
 * the opaque `runtimeStateId` alone, so a caller cannot read or write
 * another student's progress by guessing or forging an id (02_36 §20-bis
 * ownership rule). Mirrors `LearningAttemptRepository`'s constructor-
 * injected `Queryable` pattern and `ReviewQueueItemRepository`'s
 * optimistic-concurrency `version` column — no shared base-repository
 * class, same as every other repository in this package.
 */
export class SequenceRuntimeStateRepository {
  constructor(private readonly db: Queryable) {}

  async findByAttempt(tenantId: string, learningAttemptId: string): Promise<PersistedSequenceRuntimeState | null> {
    const result = await this.db.query<SequenceRuntimeStateRow>(
      `SELECT ${SELECT_COLUMNS} FROM sequence_runtime_state
       WHERE tenant_id = $1 AND learning_attempt_id = $2`,
      [tenantId, learningAttemptId],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /**
   * Throws `SequenceRuntimeStateAlreadyExistsError` (Postgres unique
   * violation, code 23505) if a concurrent request already created a row
   * for this (tenant, attempt) — the caller re-fetches via `findByAttempt`
   * rather than blindly retrying the insert.
   */
  async create(input: {
    tenantId: string;
    studentProfileId: string;
    enrollmentId: string;
    learningAttemptId: string;
    state: SequenceRuntimeState;
  }): Promise<PersistedSequenceRuntimeState> {
    const parsed = parseSequenceRuntimeState(input.state);
    if (!parsed.valid) {
      throw new Error(`sequence_runtime_state.create: state fails contract validation: ${parsed.errors.join("; ")}`);
    }
    try {
      const result = await this.db.query<SequenceRuntimeStateRow>(
        `INSERT INTO sequence_runtime_state
           (tenant_id, student_profile_id, enrollment_id, learning_attempt_id, sequence_id, sequence_version,
            runtime_state_id, current_stage_id, sequence_completion_state, state_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${SELECT_COLUMNS}`,
        [
          input.tenantId,
          input.studentProfileId,
          input.enrollmentId,
          input.learningAttemptId,
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
    learningAttemptId: string,
    expectedVersion: number,
    state: SequenceRuntimeState,
  ): Promise<PersistedSequenceRuntimeState | null> {
    const parsed = parseSequenceRuntimeState(state);
    if (!parsed.valid) {
      throw new Error(`sequence_runtime_state.save: state fails contract validation: ${parsed.errors.join("; ")}`);
    }
    const result = await this.db.query<SequenceRuntimeStateRow>(
      `UPDATE sequence_runtime_state
       SET current_stage_id = $4,
           sequence_completion_state = $5,
           state_json = $6,
           version = version + 1,
           updated_at = now()
       WHERE tenant_id = $1 AND learning_attempt_id = $2 AND version = $3
       RETURNING ${SELECT_COLUMNS}`,
      [tenantId, learningAttemptId, expectedVersion, state.currentStageId, state.sequenceCompletionState, JSON.stringify(state)],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505";
}
