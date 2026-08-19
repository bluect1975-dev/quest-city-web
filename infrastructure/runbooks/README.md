# Quest City Web — Staging Operational Runbooks (Tranche E1)

Operator procedure, not architecture authority. **07_06 (`docs/07-web-learing-platform/07_06_..._v1_0.md`) remains the single canonical source of truth** for *why* the staging architecture looks the way it does — these runbooks say *how* to operate it day to day. Where they overlap, 07_06 wins; if you find a real contradiction, that's a `BLOCKED_CANONICAL_CONTRACT` situation, not something to resolve by editing a runbook.

Cross-referenced against the Tranche E reconciliation report and the ACN/MePA Architecture Readiness Gap Analysis's gap register.

**Scope note**: this set covers Tranche E1 (local staging foundations) only. Two runbooks that the reconciliation report identified as needing the Tranche E2 out-of-band monitoring redesign first — `05-incident-response.md` and `09-staging-operations-guide.md` — are deliberately **not** included here, so as not to publish a process document describing a monitoring model (single-webhook alerting) that would conflict with the Master Admin Operations Control Center's actual Telegram pipeline. They ship with Tranche E2.

| Runbook | Covers |
|---|---|
| [01-deployment.md](01-deployment.md) | Standard staging release |
| [02-rollback.md](02-rollback.md) | Reverting a bad release |
| [03-backups.md](03-backups.md) | Scheduled/manual database backup |
| [04-restore.md](04-restore.md) | Restore drill and real disaster restore |
| [06-credential-rotation.md](06-credential-rotation.md) | Rotating secrets, including the `CLASS_CODE_HASH_PEPPER` special case |
| [07-certificate-renewal.md](07-certificate-renewal.md) | TLS certificate lifecycle and failure |
| [08-database-migration.md](08-database-migration.md) | Safe schema migration deployment |

Not yet available (Tranche E2): incident response (SEV-1..4 process), general staging operations guide (topology/commands/contacts/smoke-test checklist).

Not yet available (Tranche E3, requires a real VPS): host OS hardening template — out of this mission's explicit scope (no VPS exists yet to run it against).
