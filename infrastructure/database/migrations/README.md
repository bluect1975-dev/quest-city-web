# Migrations

Naming convention: `NNNN_description.sql` (four-digit sequence, lowercase snake_case description) — e.g. `0001_init_extensions.sql`. Each migration must have a matching `NNNN_description.rollback.sql` documenting how to reverse it, per `02_25 §16` ("forward-only migrations with documented rollback") and `05_01 §14` (Definition of Done requires rollback to be defined).

Rules:

- Migrations are forward-only. Never edit an already-applied migration file — write a new one.
- Every migration requires review before merge (`02_25 §16`).
- Run with `pnpm --filter @quest-city-web/tools run migrate` (wraps `tools/migrate.mjs`), which applies pending files in order inside a transaction and records them in `schema_migrations`.
- WEB-M0 scope: only a verifiable structure and a minimal, side-effect-free bootstrap migration exist here. No production domain schema (classes, curriculum, identity, attempts, etc. — owned by `02_25 §4`'s shared backend model) is created at this milestone.
