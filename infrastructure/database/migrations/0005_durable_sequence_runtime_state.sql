-- R3C.3: durable Stage/Session Orchestrator runtime state
-- (SequenceRuntimeState, `stage-orchestration-contract.schema.json`).
--
-- Persistence had been deliberately deferred by R3C.2
-- (`InMemorySequenceRuntimeStateStore` only, see
-- `packages/content-runtime/src/sequence-runtime-state-store.ts`'s own
-- doc comment, which explicitly named this table
-- "learning_sequence_runtime_state" as the future real implementation).
-- Named `sequence_runtime_state` here instead: shorter, and every sibling
-- runtime table in this schema (`learning_attempt`, `attempt_response`,
-- `semantic_action_log`) already carries no `learning_` prefix once past
-- `learning_attempt` itself.
--
-- Ownership (ADR-0006-style ownership rule, 02_25 §6.11): a runtime state
-- belongs to exactly one (tenant, student, sequence) triple — never looked
-- up by the opaque `runtime_state_id` alone from outside this table, so a
-- caller can never read/write another student's progress by guessing or
-- forging an id. `student_profile_id`/`enrollment_id` reuse the exact
-- composite-FK ownership pattern already established for `learning_attempt`
-- (migration 0003) and `review_queue_item`/`teacher_feedback`
-- (migration 0004) — `FOREIGN KEY (x_id, tenant_id) REFERENCES
-- other(id, tenant_id)`.
--
-- One active runtime state per student per sequence (`UNIQUE (tenant_id,
-- student_profile_id, sequence_id)`) — a student resumes the same sequence
-- they were already progressing through, never a second concurrent one.
--
-- Concurrency: `version` column, identical optimistic-concurrency shape to
-- `review_queue_item`/`teacher_feedback` (migration 0004) — a write's
-- `WHERE version = $expected` must match or zero rows are updated and the
-- caller treats that as a conflict, never a blind overwrite. No new
-- `idempotency_record` scope is introduced: unlike creation-type
-- operations (`attempt_completion`, `staff_feedback_create`, ...),
-- runtime-state mutations are repeated transitions over the same row, the
-- same shape `review_queue_item.transitionStatus` already uses without
-- `idempotency_record` — and `addAttemptReference`
-- (`packages/content-runtime`) is already dedup-safe by construction
-- (skips a duplicate `{stageId, attemptId}` pair before it ever reaches a
-- write), so the version column is the single, sufficient mechanism here.
--
-- `state_json` holds the exact `SequenceRuntimeState` contract shape
-- (`contractType`, `runtimeStateId`, `sequenceId`, `sequenceVersion`,
-- `currentStageId`, `stageStates[]`, `attemptReferences[]`,
-- `sequenceCompletionState`) — the schema's own `additionalProperties:
-- false` means no DB-only metadata (tenant/version/timestamps) is ever
-- added inside it; those live in real columns instead, the same
-- coexistence `learning_attempt.outcome JSONB` already has with its own
-- plain columns. `current_stage_id`/`sequence_completion_state` are
-- duplicated as plain columns (not read from `state_json`) purely so a
-- caller can filter/index without parsing JSON — `state_json` remains the
-- single source of truth for the full contract shape (`stageStates`,
-- `attemptReferences` are never independently queried by SQL).
CREATE TABLE sequence_runtime_state (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenant (id),
  student_profile_id        UUID NOT NULL,
  enrollment_id             UUID NOT NULL,
  sequence_id               TEXT NOT NULL,
  sequence_version          TEXT NOT NULL,
  runtime_state_id          TEXT NOT NULL,
  current_stage_id          TEXT NOT NULL,
  sequence_completion_state TEXT NOT NULL
                             CHECK (sequence_completion_state IN
                               ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
  state_json                JSONB NOT NULL,
  version                   INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (student_profile_id, tenant_id) REFERENCES student_profile (id, tenant_id),
  FOREIGN KEY (enrollment_id, tenant_id) REFERENCES school_enrollment (id, tenant_id),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, student_profile_id, sequence_id),
  UNIQUE (runtime_state_id, tenant_id)
);

CREATE INDEX sequence_runtime_state_tenant_student_idx
  ON sequence_runtime_state (tenant_id, student_profile_id);
