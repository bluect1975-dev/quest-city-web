# Runbook: Rollback (staging)

**Trigger**: smoke test failure, or an incident traced to the current release.
**Owner**: DEVOPS.
**References**: Tranche E design report §20/§40; 07_06 §18.

## Step 1 — Classify the migration in the failed release

Check the migration(s) applied in this release against `08-database-migration.md`'s classification:

- **Additive/backward-compatible** → the previous application image is compatible with the current schema. Go to Step 2.
- **Backfill, destructive, or urgent** → application-image rollback ALONE is **not safe**. Stop and follow the compensating strategy that should have been defined before this migration was deployed (07_06 §18: "Le migrazioni irreversibili richiedono backup, restore rehearsal o strategia compensativa prima della release"). If none was defined, this is now a restore-from-backup situation — go to [04-restore.md](04-restore.md) instead of this runbook.

## Step 2 — Roll back the application image

Look up the previous release's digests in `deploy-releases.log` (written by 01-deployment.md Step 6 — the second-to-last line, not the last, since the last line is the failed release). No rebuild, no re-pull of a moving tag: the previous digest was already pushed to GHCR and is content-addressed, so it is byte-for-byte the same image that ran before, guaranteed by the registry, not by trust.

```bash
# Re-point the three image refs at the PREVIOUS release's recorded digests
# (edit .env.staging's API_IMAGE_REF / STUDENT_WEB_IMAGE_REF /
# DASHBOARD_IMAGE_REF, or export them inline — either way they must be the
# exact ghcr.io/...@sha256:... values from deploy-releases.log, never a
# tag), then:
docker compose -p quest-city-web-staging -f infrastructure/deployment/docker-compose.yml -f infrastructure/deployment/docker-compose.staging.yml \
  --env-file .env.staging up -d --no-build
```

## Step 3 — Verify

- [ ] `/api/health/ready` returns healthy.
- [ ] Smoke test passes against the rolled-back version (same minimal check as 01-deployment.md §5 — a full checklist ships with 09-staging-operations-guide.md, Tranche E2, not yet in this repository).
- [ ] Sessions/attempts in flight at the moment of rollback behave sanely — check for orphaned in-progress attempts if the failed release touched attempt/session code paths.

## Step 4 — Communicate and record

Log: what failed, what was rolled back to, duration of impact, whether any data was affected. Append a `deploy-releases.log` line for the rollback itself (same format as 01-deployment.md Step 6, `migration=rollback`) so the file stays a complete, chronological release history — never edit or delete the failed release's own line. Feed into the incident's post-review if this rollback was triggered by an actual incident (05-incident-response.md — Tranche E2, not yet in this repository).

## Rolling forward again

Once the failed release is fixed, deploy it the normal way (01-deployment.md) with a new commit and new CI-built digests — never re-point at the old failed release's digest to "roll forward," since that digest is exactly the broken image. Returning to a since-fixed version of the *current* release, however (e.g. rollback was precautionary and the release turns out fine), is just Step 2 again with the newer digests — no rebuild needed either way, since both directions only ever re-point at already-published, content-addressed images.
