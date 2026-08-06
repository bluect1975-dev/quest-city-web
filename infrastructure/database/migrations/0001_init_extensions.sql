-- WEB-M0 bootstrap migration: verifies the migration pipeline end-to-end
-- without introducing any domain schema (classes/curriculum/identity/
-- attempts belong to the shared backend model, 02_25 §4 — IMPLEMENT_LATER).
--
-- pgcrypto is required later for gen_random_uuid()-based primary keys;
-- enabling it now is safe, reversible and has no data-model implications.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
