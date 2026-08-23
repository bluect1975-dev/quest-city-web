BEGIN;

-- Best-effort only: if this migration has been live long enough that two
-- independent attempts now legitimately hold separate runtime-state rows
-- for the same (tenant, student, sequence) -- exactly the case this
-- migration exists to allow -- re-adding the old UNIQUE (tenant_id,
-- student_profile_id, sequence_id) constraint below will fail with a
-- uniqueness violation. That failure is expected and correct: it means
-- real post-fix data exists that the old, structurally-broken constraint
-- can no longer represent, and rolling back would silently reintroduce
-- UAT-RC4-NEW-ASSIGNMENT-LAUNCH-STATE-01.
ALTER TABLE sequence_runtime_state
  DROP CONSTRAINT IF EXISTS sequence_runtime_state_attempt_fk,
  DROP CONSTRAINT IF EXISTS sequence_runtime_state_attempt_key,
  DROP COLUMN IF EXISTS learning_attempt_id;

ALTER TABLE sequence_runtime_state
  ADD CONSTRAINT sequence_runtime_state_tenant_id_student_profile_id_sequence_i
  UNIQUE (tenant_id, student_profile_id, sequence_id);

COMMIT;
