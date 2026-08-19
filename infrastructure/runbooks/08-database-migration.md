# Runbook: Database Migration (staging)

**Trigger**: any release that includes new files under `infrastructure/database/migrations/`.
**Owner**: ENGINEERING + DEVOPS.
**References**: 07_06 §17 (classification, expand→migrate→contract); Tranche E design report §20.

## Classify BEFORE deploying (07_06 §17)

| Type | Rule | Rollback-safe with just the previous app image? |
|---|---|---|
| Additive | Preferred; compatible with old AND new release simultaneously | Yes |
| Backfill | Runs via a controlled, observable, resumable worker — not a blocking migration step | Usually, if the backfill hasn't finished removing the old path yet |
| Distruttiva (destructive) | Only after the old code path that depends on the removed thing is fully retired | **No** — requires the compensating strategy defined below |
| Urgente (urgent) | Explicit runbook + approval, out of normal cadence | Case by case |

**Every migration in this repository ships with a `.rollback.sql` file — this is a good signal, not a guarantee.** A rollback SQL file written when the migration was authored does not know what data the application has written in the *new* shape since deploy. Verify safety at deploy time, not by the file's mere existence.

## Expand → migrate → contract (07_06 §17)

For anything that changes a column/table shape:
1. **Expand**: add the new shape alongside the old one. Deploy. Both old and new application code work.
2. **Migrate**: backfill/dual-write as needed. Deploy the application version that reads/writes the new shape.
3. **Contract**: remove the old shape, only once nothing depends on it anymore. Deploy.

Never collapse these into one deploy for anything beyond a trivial additive change — "a release applicativa non deve assumere che una colonna appena rimossa esista ancora nel processo precedente" (07_06 §17).

## Deploying a migration

Follow [01-deployment.md](01-deployment.md)'s sequence — step 1 (pre-deploy backup) is non-negotiable for ANY migration, additive included. For a destructive/urgent migration specifically:

- [ ] The compensating strategy (what happens if this needs to be undone) is written down BEFORE the deploy, not improvised during an incident.
- [ ] A restore rehearsal against a copy of the pre-migration backup has been run if the migration is irreversible (07_06 §18).
- [ ] Explicit approval recorded (who, when) — this is the "urgente" row's own requirement even outside a true emergency.
