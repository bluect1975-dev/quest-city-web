-- Pilot Product Experience Residual Closure — Tranche H1
-- Closes NEW-GAP-STAFF-DISPLAY-NAME-01: staff_account has never had any
-- human-presentable identity field (only `email`, a credential — never
-- meant to be shown to students, see apps/api/app/me/class/route.ts).
--
-- `display_name` is nullable and NOT backfilled: no canonical source of a
-- real name exists for any already-provisioned staff_account row (email
-- alone is not a name), so fabricating a value would violate the mission's
-- no-invention rule. Existing accounts keep display_name = NULL until the
-- staff member sets one themselves via the new self-service
-- `PATCH /me/staff-profile` endpoint (Tranche H1) — login and every other
-- staff capability are unaffected by a NULL display_name.
--
-- Deliberately global (on staff_account, not staff_tenant_membership): a
-- person's name does not vary by which school tenant they are currently
-- acting in, consistent with staff_account already being the
-- non-tenant-scoped identity root (migration 0004's own header comment).

BEGIN;

ALTER TABLE staff_account
  ADD COLUMN display_name TEXT,
  ADD CONSTRAINT staff_account_display_name_length
    CHECK (display_name IS NULL OR (length(trim(display_name)) BETWEEN 1 AND 120)),
  ADD CONSTRAINT staff_account_display_name_trimmed
    CHECK (display_name IS NULL OR display_name = trim(display_name));

COMMIT;
