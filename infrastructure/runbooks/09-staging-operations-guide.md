# Runbook: Staging Operations Guide

General reference — topology, common commands, and the checklists used by the other runbooks. **07_06 remains canonical authority for the architecture itself**; this page is the operator's index into it plus the concrete commands for this specific Compose-based implementation.

## Topology (Tranche E design report §7)

```
Internet --443/80--> nginx (edge, TLS, security headers, rate limiting)
                        |
          +-------------+-------------+
          |             |             |
       student-web   dashboard      api ---TLS---> postgres (never public)
       (private)      (private)    (private)

Ops (profile "ops", never auto-started): backup, restore-drill, healthcheck
staging-guard: gates api/dashboard/student-web startup on env safety
```

## Common commands

```bash
# Standard project name for every invocation below — never omit -p.
COMPOSE="docker compose -p quest-city-web-staging -f infrastructure/deployment/docker-compose.staging.yml --env-file .env.staging"

$COMPOSE up -d --build           # start/update the stack
$COMPOSE ps                       # status
$COMPOSE logs -f api               # tail one service's logs
$COMPOSE --profile ops run --rm backup            # 03-backups.md
$COMPOSE --profile ops run --rm restore-drill      # 04-restore.md
$COMPOSE --profile ops run --rm healthcheck        # ad hoc monitoring check
$COMPOSE down                     # stop (NEVER `down -v` against real staging data — mission §55/§34)
```

## Deployment security checklist (Tranche E design report §53 — verify before EVERY deploy)

- [ ] TLS active and valid (certificate not expired, full chain)
- [ ] All secrets injected at runtime — no plaintext value in any versioned file
- [ ] Cookies confirmed `Secure`/`HttpOnly`/`SameSite` (no insecure override active)
- [ ] `DATABASE_SSL=true`, `rejectUnauthorized=true`
- [ ] Firewall: only 443/80/restricted-SSH exposed; DB never public
- [ ] Backup: scheduled job active, last run's result verified successful
- [ ] Monitoring: uptime/readiness probes active and reporting healthy
- [ ] Security headers present (CSP/HSTS/X-Content-Type-Options/Referrer-Policy/Permissions-Policy)
- [ ] Edge rate limiting active on auth/session/API zones
- [ ] Log sink reachable, `correlationId` verified end-to-end
- [ ] CI dependency/container scans passed with no unresolved CRITICAL/HIGH

## Staging acceptance checklist (Tranche E design report §54 — after deploy)

- [ ] HTTPS works; HTTP redirects to HTTPS; certificate chain valid
- [ ] Security headers present in the real response (`curl -I` or DevTools — not just "configured")
- [ ] Login: Student, Platform Admin, School Admin, Teacher, Support Teacher, ASACOM — each end to end
- [ ] GLPC launch gate: an allowed launch succeeds, a denied one returns the expected 409 with no partial state
- [ ] M06: activity launch → completion
- [ ] DB TLS confirmed via a real encrypted connection, not just the env var value
- [ ] A real backup has succeeded in staging at least once (03-backups.md)
- [ ] A real restore drill has succeeded at least once (04-restore.md) — **mandatory, not optional, before declaring E closed**
- [ ] Monitoring shows real measurements, not just "the check ran without crashing"
- [ ] One alert path tested end to end (a harmless synthetic failure, never a deliberate real outage)
- [ ] `correlationId` traced through a real request from nginx access log to application log
- [ ] A container restart recovers cleanly (data persists, service returns healthy, sessions behave per contract)

## Escalation / contacts

Fill in for your actual operator roster before relying on this document during an incident — this repository has no standing on-call schedule to encode.
