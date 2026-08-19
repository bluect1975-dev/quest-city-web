# Runbook: Backup (staging)

**Trigger**: scheduled (cron/systemd timer, at least daily — design report §22) or manual, before any deployment (01-deployment.md).
**Owner**: DEVOPS.
**References**: Tranche E design report §21-22; ACN/MePA Gap Analysis GAP-02; `tools/backup-staging-db.mjs`. Scope: Tranche E1 (local staging foundations) — proves the pipeline, does not close off-site protection (see below).

## Running it

```bash
docker compose -p quest-city-web-staging \
  -f infrastructure/deployment/docker-compose.yml -f infrastructure/deployment/docker-compose.staging.yml \
  --env-file .env.staging --profile ops run --rm backup
```

Pipeline (all automated by the script): `pg_dump -Fc` → sha256 checksum → AES-256-GCM encryption (`BACKUP_ENCRYPTION_KEY`) → upload to the configured `BACKUP_TARGET_ADAPTER` → **post-upload checksum re-verification (download-and-compare, not just "upload succeeded")** → tiered retention enforcement (daily/weekly/monthly, `BACKUP_RETENTION_*` env vars) → JSON status line on stdout.

## Scheduling it

Add a cron entry (or systemd timer) on the staging host, e.g.:

```
0 2 * * * cd /path/to/quest-city-web && docker compose -p quest-city-web-staging -f infrastructure/deployment/docker-compose.yml -f infrastructure/deployment/docker-compose.staging.yml --env-file .env.staging --profile ops run --rm backup >> /var/log/qcweb-backup.log 2>&1
```

## Reading the result

The script prints `{"status":"success", "destIdentifier":..., "checksum":..., "sizeBytes":..., "timestamp":...}` on success, or `{"status":"failure","error":...}` on failure (non-zero exit code either way you'd want to alert on). Continuous freshness monitoring of the most recent backup (age-based alerting) is out of Tranche E1 scope — it belongs to the out-of-band monitoring redesign (Tranche E2); for now, alert on this script's own exit code / cron log.

## GAP-02 closure — do not confuse "backup runs" with "backup is real off-site protection"

`BACKUP_TARGET_ADAPTER=local` (the default) proves the backup **pipeline** is correct — dump, checksum, encryption, retention all genuinely work. It does **not** prove data survives a VPS loss, because the local adapter's destination is a Docker volume on the same host. **GAP-02 is only closed once a real off-site (EU) target is configured and a restore has been verified from it** — see [04-restore.md](04-restore.md). Track this explicitly; do not report backup as "done" from local-adapter success alone.
