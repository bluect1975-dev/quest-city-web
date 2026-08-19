# Runbook: Restore (staging)

**Trigger**: scheduled drill (at least quarterly — 07_06 §13.2) or a real disaster (data corruption, VPS loss).
**Owner**: DEVOPS.
**References**: Tranche E design report §23; ACN/MePA Gap Analysis GAP-02; `tools/restore-staging-db.mjs`. Scope: Tranche E1 (local staging foundations) — the drill below is executed for real against a disposable local environment as part of E1 closure; a real off-site drill is E3 (see "Closing GAP-02 for real" below).

## Critical safety rule

**`RESTORE_TARGET_DATABASE_URL` must point at an ISOLATED database — never the live staging `DATABASE_URL`.** The compose service (`restore-drill`) has no default for this variable specifically so an operator cannot forget and accidentally overwrite live staging data with `pg_restore --clean`. If you are restoring because staging's own database is genuinely gone/corrupted, provision a **fresh** database first, restore into that, verify it, then repoint staging's `DATABASE_URL` at it — never restore in place onto a database you haven't already given up on.

## Running a drill

```bash
docker compose -p quest-city-web-staging \
  -f infrastructure/deployment/docker-compose.yml -f infrastructure/deployment/docker-compose.staging.yml \
  --env-file .env.staging --profile ops run --rm \
  -e RESTORE_TARGET_DATABASE_URL="postgresql://.../isolated_restore_drill_db" \
  restore-drill
```

Optionally restore a specific backup instead of the most recent: `restore-staging-db.mjs --backup <destIdentifier>`.

Pipeline: download encrypted dump + `.sha256` sidecar → decrypt (AES-256-GCM auth tag fails loudly on tampering/corruption) → verify decrypted plaintext against the recorded pre-encryption checksum → `pg_restore --clean --if-exists` into the isolated target → integrity queries (row counts on `tenant`, `student_profile`, `staff_account`, `learning_attempt`, `audit_event`, `operational_incident`, `alert_configuration`, `user_presence` — reviewed against the current schema as of migration 0014, covering Master Admin Operations Control Center/Telegram tables, not just the pre-MAOCC set) → optional `/health/ready`-style probe against an application instance pointed at the restored DB (`RESTORE_HEALTH_CHECK_URL`) → JSON result with duration.

## Recording the drill

Every drill run should be logged: date, backup identifier restored, duration, integrity check results, pass/fail. This log **is** the evidence that "a backup has actually been restored" — 07_06 §13.2's whole point.

## Closing GAP-02 for real

1. Configure `BACKUP_TARGET_ADAPTER` to a real off-site EU target (not `local`) at implementation time.
2. Run a full backup (03-backups.md) to that real target.
3. Run this restore drill **against a backup pulled from the real off-site target**, on a host/network path that does not assume the original VPS is reachable (the point is proving you can recover even if the VPS itself is gone).
4. Only then is GAP-02 closed — record the date and evidence.
