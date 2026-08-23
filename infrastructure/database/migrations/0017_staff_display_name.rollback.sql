BEGIN;

ALTER TABLE staff_account
  DROP CONSTRAINT IF EXISTS staff_account_display_name_trimmed,
  DROP CONSTRAINT IF EXISTS staff_account_display_name_length,
  DROP COLUMN IF EXISTS display_name;

COMMIT;
