-- 0016_student_pin_lockout: Pilot Product Experience Remediation Tranche G9
-- (SEC-STUDENT-PIN-01, mission §33-37). Closes the gap disclosed in the
-- prior mission's own errata: student PIN login had fixed-window rate
-- limiting (IP-wide and per-enrollment, packages/identity/src/rate-limit)
-- but no persistent per-account lockout -- a classmate who knows the class
-- code and guesses an alias could retry a PIN indefinitely across
-- successive 15-minute windows.
--
-- Additive-only: two new nullable/defaulted columns on school_enrollment,
-- mirroring staff_account.failed_login_count/locked_until (migration 0004)
-- exactly in shape -- the proven, already-audited pattern this mission was
-- explicitly told to use as a model (§35), not re-derive from scratch. No
-- existing column is altered, no row is affected beyond receiving the
-- default (failed_pin_count = 0, pin_locked_until = NULL).
--
-- Named pin_locked_until (not locked_until) and failed_pin_count (not
-- failed_login_count) to avoid implying this is the same lockout dimension
-- as an eventual staff-style "login" concept on the student side, which
-- does not exist -- a student's only credential is the PIN.

BEGIN;

ALTER TABLE school_enrollment
  ADD COLUMN failed_pin_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN pin_locked_until TIMESTAMPTZ;

COMMIT;
