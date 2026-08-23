-- UAT Failure Remediation: fixes UAT-RC4-NEW-ASSIGNMENT-LAUNCH-STATE-01
-- (PRODUCT-P0).
--
-- Root cause (traced end-to-end through repository -> service -> API route
-- -> SequenceHost bootstrap): `sequence_runtime_state` was owned by
-- (tenant_id, student_profile_id, sequence_id) -- migration 0005's own
-- comment states the assumption explicitly: "a student resumes the same
-- sequence they were already progressing through, never a second
-- concurrent one." That assumption breaks the moment a teacher creates a
-- SECOND, independent assignment against the same content/sequence (the
-- exact remediation use case "Riattiva la Balance Machine" exists for):
-- both assignments resolve to the same `sequenceId`
-- (`packages/content-runtime/src/content/web-m4-real-content.ts`), so a
-- brand-new attempt's `SequenceHost` bootstrap
-- (`loadSequenceRuntimeState(definition.sequenceId)`) silently loaded the
-- OLD, already-COMPLETED attempt's runtime state -- rendering "Sequenza
-- completata" for an attempt that had never even started, while the real
-- `learning_attempt` row for it stayed CREATED, which then rejected
-- completion with "Il tentativo non è completabile nel suo stato attuale."
--
-- The fix re-scopes ownership to what it actually is: a property of
-- (student, ATTEMPT), never (student, sequence). Each `learning_attempt`
-- now gets its own independent `sequence_runtime_state` row, so two
-- assignments against the same content bundle can never again share
-- progress/completion state.
ALTER TABLE sequence_runtime_state
  ADD COLUMN learning_attempt_id UUID;

-- Backfill (best-effort, real data only -- never fabricated): attach each
-- existing row to the most recently referenced real attempt in its own
-- `state_json.attemptReferences[]` (the attempt that was actually driving
-- it). A row that never recorded an attempt reference (state never left
-- NOT_STARTED) is left NULL rather than guessed -- the next real bootstrap
-- for that student/sequence simply creates a fresh, correctly-scoped row.
UPDATE sequence_runtime_state
SET learning_attempt_id = NULLIF(state_json #>> '{attemptReferences,-1,attemptId}', '')::uuid;

-- Drop the old (tenant, student, sequence) ownership constraint, found
-- dynamically rather than by a guessed/possibly-truncated generated name.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'sequence_runtime_state'::regclass
    AND con.contype = 'u'
    AND (
      SELECT array_agg(a.attname ORDER BY a.attname)
      FROM unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    ) = ARRAY['sequence_id', 'student_profile_id', 'tenant_id']::name[]
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sequence_runtime_state DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- New ownership: one runtime state per attempt. Multiple NULLs (unclaimed
-- legacy rows, if any) coexist fine under a UNIQUE constraint in Postgres.
ALTER TABLE sequence_runtime_state
  ADD CONSTRAINT sequence_runtime_state_attempt_key UNIQUE (tenant_id, learning_attempt_id);

-- Same composite-FK ownership pattern already used for student_profile_id/
-- enrollment_id in migration 0005 (`learning_attempt` already carries
-- UNIQUE (id, tenant_id) from migration 0003).
ALTER TABLE sequence_runtime_state
  ADD CONSTRAINT sequence_runtime_state_attempt_fk
  FOREIGN KEY (learning_attempt_id, tenant_id) REFERENCES learning_attempt (id, tenant_id);
