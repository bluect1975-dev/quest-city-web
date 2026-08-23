BEGIN;

ALTER TABLE content_bundle
  DROP CONSTRAINT IF EXISTS content_bundle_title_trimmed,
  DROP CONSTRAINT IF EXISTS content_bundle_title_length,
  DROP COLUMN IF EXISTS title;

COMMIT;
