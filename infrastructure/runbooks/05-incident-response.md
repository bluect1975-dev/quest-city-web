# Runbook: Incident Response (staging)

**Trigger**: any SEV-1..4 event (table below, from 07_06 §19, unchanged).
**Owner**: DEVOPS + SECURITY (security-classified incidents).
**References**: Tranche E design report §30; 07_06 §19.

## Severity levels (07_06 §19, reused verbatim)

| Level | Example |
|---|---|
| SEV-1 | Data exposure, complete unavailability, loss or corruption |
| SEV-2 | Login or attempts blocked for many classes |
| SEV-3 | Degraded function with a workaround |
| SEV-4 | Minor defect or cosmetic issue |

## Type (classify BOTH severity and type — mission §51)

- **Security**: compromised credential, suspected unauthorized access → also see [06-credential-rotation.md](06-credential-rotation.md).
- **Availability**: VPS down, DB unreachable → also see [02-rollback.md](02-rollback.md) or [04-restore.md](04-restore.md) depending on cause.
- **Data**: corruption, loss, accidental exposure → almost always SEV-1 (07_06 §19).

## Process

1. **Detection** — from an alert (`tools/staging-healthcheck.mjs` via the configured webhook, or a human report).
2. **Classification** — assign severity + type within minutes of detection.
3. **Containment** — the immediate action that limits further damage: rollback (02-rollback.md), credential rotation (06-credential-rotation.md), blocking a source IP at the firewall — not necessarily the permanent fix.
4. **Recovery** — restore normal service (may involve 04-restore.md).
5. **Communication** — internal always; to affected pilot schools if the incident visibly affected them, proportional to severity.
6. **Post-incident review** — timeline, impact, root cause, corrective actions, and **verification that those actions actually landed** (07_06 §19 requires this explicitly, not just that it was written down).

## Do not

- Attempt a "fix forward" during an active SEV-1/2 — contain first (usually: rollback).
- Skip the post-incident review because the immediate fire is out.
- Treat a security incident's containment as complete without checking `audit_event` for what happened during the exposure window.
