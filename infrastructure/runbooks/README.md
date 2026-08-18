# Quest City Web — Staging Operational Runbooks (Tranche E)

Operator procedure, not architecture authority. **07_06 (`docs/07-web-learing-platform/07_06_..._v1_0.md`) remains the single canonical source of truth** for *why* the staging architecture looks the way it does — these runbooks say *how* to operate it day to day. Where they overlap, 07_06 wins; if you find a real contradiction, that's a `BLOCKED_CANONICAL_CONTRACT` situation, not something to resolve by editing a runbook.

Cross-referenced against the Tranche E design report (`tranche_e_design_report.pdf`, delivered separately — not part of this repository) and the ACN/MePA Architecture Readiness Gap Analysis's gap register.

| Runbook | Covers |
|---|---|
| [01-deployment.md](01-deployment.md) | Standard staging release |
| [02-rollback.md](02-rollback.md) | Reverting a bad release |
| [03-backups.md](03-backups.md) | Scheduled/manual database backup |
| [04-restore.md](04-restore.md) | Restore drill and real disaster restore |
| [05-incident-response.md](05-incident-response.md) | SEV-1..4 process |
| [06-credential-rotation.md](06-credential-rotation.md) | Rotating secrets, including the `CLASS_CODE_HASH_PEPPER` special case |
| [07-certificate-renewal.md](07-certificate-renewal.md) | TLS certificate lifecycle and failure |
| [08-database-migration.md](08-database-migration.md) | Safe schema migration deployment |
| [09-staging-operations-guide.md](09-staging-operations-guide.md) | General reference: topology, commands, contacts |

Host baseline template: [`../scripts/staging-host-baseline.sh`](../scripts/staging-host-baseline.sh) (manual, one-time, per VPS — not run by any automation here).
