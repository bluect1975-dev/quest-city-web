# Runbook: Rollback (staging)

**Trigger**: smoke test failure, or an incident traced to the current release.
**Owner**: DEVOPS.
**References**: Tranche E design report §20/§40; 07_06 §18.

## Step 1 — Classify the migration in the failed release

Check the migration(s) applied in this release against `08-database-migration.md`'s classification:

- **Additive/backward-compatible** → the previous application image is compatible with the current schema. Go to Step 2.
- **Backfill, destructive, or urgent** → application-image rollback ALONE is **not safe**. Stop and follow the compensating strategy that should have been defined before this migration was deployed (07_06 §18: "Le migrazioni irreversibili richiedono backup, restore rehearsal o strategia compensativa prima della release"). If none was defined, this is now a restore-from-backup situation — go to [04-restore.md](04-restore.md) instead of this runbook.

## Step 2 — Roll back the application image

```bash
docker compose -p quest-city-web-staging -f infrastructure/deployment/docker-compose.yml -f infrastructure/deployment/docker-compose.staging.yml \
  --env-file .env.staging up -d --no-build \
  # pin to the previous release's recorded image digest here, not a
  # floating tag — see the release metadata recorded in 01-deployment.md
```

## Step 3 — Verify

- [ ] `/api/health/ready` returns healthy.
- [ ] Smoke test passes against the rolled-back version (same minimal check as 01-deployment.md §5 — a full checklist ships with 09-staging-operations-guide.md, Tranche E2, not yet in this repository).
- [ ] Sessions/attempts in flight at the moment of rollback behave sanely — check for orphaned in-progress attempts if the failed release touched attempt/session code paths.

## Step 4 — Communicate and record

Log: what failed, what was rolled back to, duration of impact, whether any data was affected. Feed into the incident's post-review if this rollback was triggered by an actual incident (05-incident-response.md — Tranche E2, not yet in this repository).
