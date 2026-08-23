-- Pilot Product Experience Residual Closure — Tranche H2
-- Closes NEW-GAP-CONTENT-BUNDLE-NO-TITLE-01: content_bundle (migration
-- 0003) has never had a human-readable title, so the teacher content
-- picker composes a label from subject_id/bundle_type/bundle_version
-- ("MAT — Attività — v1.0.0") instead of a real title.
--
-- Nullable, not backfilled by this migration: no title is fabricated here.
-- The M06 pilot dataset's 7 rows get a real, source-cited title via a
-- dedicated backfill script (tools/backfill-content-bundle-titles.ts,
-- Tranche H2) that traces every value to a canonical document or an
-- already-shipped i18n string — never invented free text — so the
-- provenance stays reviewable outside a raw SQL migration. Any future
-- content_bundle row not covered by that script starts and stays NULL
-- until a real title is known (mission's own rule: disclose, never
-- fabricate).

BEGIN;

ALTER TABLE content_bundle
  ADD COLUMN title TEXT,
  ADD CONSTRAINT content_bundle_title_length
    CHECK (title IS NULL OR (length(trim(title)) BETWEEN 1 AND 200)),
  ADD CONSTRAINT content_bundle_title_trimmed
    CHECK (title IS NULL OR title = trim(title));

COMMIT;
