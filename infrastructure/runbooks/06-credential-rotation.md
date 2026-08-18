# Runbook: Credential Rotation (staging)

**Trigger**: planned rotation schedule, or suspected/confirmed compromise (05-incident-response.md).
**Owner**: DEVOPS.
**References**: Tranche E design report §14/§22 (§31 of the implementation mission); 07_06 §9.

## Standard secrets (rotate independently, any time)

- Staging Postgres password (`STAGING_POSTGRES_PASSWORD` / `DATABASE_URL`): generate a new value, update `.env.staging`, restart `postgres` then `api` (in that order — `api` must reconnect with the new credential).
- `BACKUP_ENCRYPTION_KEY`: generate a new value for **future** backups. **Old backups encrypted under the previous key remain decryptable only with that previous key** — retain the old key alongside the new one (e.g. `BACKUP_ENCRYPTION_KEY_PREVIOUS`) until the retention window for backups encrypted under it has fully expired, or you will be unable to restore them.
- `STAGING_ALERT_WEBHOOK_URL`: rotate freely, no downstream dependency.
- `WEB_AUTH_TRUSTED_ORIGINS` / `STAFF_AUTH_TRUSTED_ORIGINS` / `PLATFORM_AUTH_TRUSTED_ORIGINS`: not secrets, but a domain change requires updating all three consistently with the actual deployed origin.

## `CLASS_CODE_HASH_PEPPER` — NOT a standard rotation (Tranche E design report §14/§31)

**Do not rotate this on a schedule.** Rotating it invalidates every already-issued class-code hash currently stored in the database — every existing class code would stop resolving. This is a data-migration problem, not a config change, and **no migration algorithm for it exists yet** (mission §31: "Do not invent a migration algorithm in E unless canonical authority already defines one" — none does).

Treat rotation of this specific secret as an emergency-only, planned-with-engineering event:

1. If compromise is suspected: this is a SEV-1/2 security incident (05-incident-response.md) — the immediate containment is NOT to rotate the pepper (that breaks all existing class codes instantly), it's to assess actual exposure and decide with engineering whether rotation-with-migration is warranted versus other containment (e.g., increased monitoring, targeted class-code regeneration for specifically affected classes).
2. If rotation is genuinely decided: this requires an engineering-designed migration (recompute/reissue class codes), not a runbook step — escalate to engineering, do not attempt it as a routine ops action.

## Post-rotation verification

For any rotated secret: confirm the application actually picked it up (check a real authenticated request succeeds, not just that the container restarted without crashing) before considering the rotation complete.
