-- Rollback for 0016_student_pin_lockout.
-- Manual-run only (tools/migrate.mjs never auto-applies .rollback.sql).
-- Safe unconditionally: DROP COLUMN always succeeds regardless of
-- accumulated data, and no other table/constraint references either
-- column (no FK, no CHECK elsewhere depends on them).

BEGIN;

ALTER TABLE school_enrollment
  DROP COLUMN IF EXISTS pin_locked_until,
  DROP COLUMN IF EXISTS failed_pin_count;

COMMIT;
