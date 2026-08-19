# Runbook: Deployment (staging)

**Trigger**: a validated release is ready to promote to staging.
**Owner**: DEVOPS.
**References**: Tranche E design report §20/§40; 07_06 §15-16.

## Preconditions

- [ ] CI is green on the commit being deployed: `build-and-test`, `container-scan`, `integration` all passed.
- [ ] `.env.staging` on the target host is up to date (no placeholder/`REPLACE_WITH_*` values — `staging-guard` will refuse to start if not, but verify before you begin, not after a failed deploy).
- [ ] `infrastructure/database/staging-tls/generated/` exists on the target host (run `generate-staging-db-tls.sh` once if this is a fresh host).
- [ ] `COMPOSE_PROJECT_NAME` / `-p` is the dedicated staging project name — never the default.

## Sequence

```bash
cd /path/to/quest-city-web
git fetch origin
git checkout <release-commit-sha>

# 1. Pre-deploy backup — ALWAYS, even for an additive migration.
docker compose -p quest-city-web-staging -f infrastructure/deployment/docker-compose.yml -f infrastructure/deployment/docker-compose.staging.yml \
  --env-file .env.staging --profile ops run --rm backup

# 2. Build + start (staging-guard runs first automatically; api/dashboard/
#    student-web wait on it via `condition: service_completed_successfully`)
docker compose -p quest-city-web-staging -f infrastructure/deployment/docker-compose.yml -f infrastructure/deployment/docker-compose.staging.yml \
  --env-file .env.staging up -d --build

# 3. Migrations (see 08-database-migration.md for the safety classification
#    of the migration being applied BEFORE running this)
docker compose -p quest-city-web-staging -f infrastructure/deployment/docker-compose.yml -f infrastructure/deployment/docker-compose.staging.yml \
  --env-file .env.staging exec -T api sh -c \
  "cd /workspace && DATABASE_URL=\$DATABASE_URL node tools/migrate.mjs" \
  # (adjust invocation to however migrations are actually run against the
  # staging DB at implementation time — the api container's runtime image
  # does not itself bundle tools/migrate.mjs; running the migrator against
  # a staging DATABASE_URL from wherever tools/ is available is a
  # deployment-workflow detail to finalize during implementation, not a
  # gap in this runbook's intent)

# 4. Readiness gate — do not proceed until this is healthy.
curl -fsS https://<staging-domain>/api/health/ready

# 5. Smoke test: at minimum, confirm /api/health/ready is healthy, log in as a synthetic student/staff/platform-admin account, and load /w, /dashboard, /app. A full checklist ships with 09-staging-operations-guide.md (Tranche E2, not yet in this repository).

# 6. Record release metadata (design report §39): commit SHA, image
#    digests (from CI's container-scan job build step output), migration
#    version, timestamp, approver — wherever your release log lives.
```

## If the smoke test fails

Go directly to [02-rollback.md](02-rollback.md). Do not attempt a "fix forward" during an active incident.
