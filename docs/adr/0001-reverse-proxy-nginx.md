---
adr_id: "ADR-0001"
title: "Reverse proxy choice: Nginx"
status: "Approved"
date: "2026-08-05"
related_change_set: "WEB-M0"
---

# ADR-0001 – Reverse proxy choice: Nginx

## Context

`07_06 §6` (Quest City Web VPS Deployment, Security and Operations Specification) leaves the exact reverse-proxy tool open: *"Il reverse proxy può essere Caddy, Nginx o equivalente... la scelta esatta viene registrata in ADR."* WEB-M0 needs a single reverse proxy in front of `student-web` (`/w`), `dashboard` (`/dashboard`) and `api` (`/api`), terminating the single public entrypoint per `07_06 §3`'s topology and never exposing PostgreSQL or any internal service.

Two realistic options were considered:

- **Caddy** — automatic TLS via Let's Encrypt, minimal Caddyfile syntax.
- **Nginx** — explicit, widely-documented configuration; certificate management (e.g. certbot) handled separately; broad operational familiarity across hosting providers.

## Decision

Use **Nginx** as the reverse proxy for `quest-city-web`, both locally (`infrastructure/deployment/docker-compose.yml`) and on the VPS. Configuration lives at `infrastructure/reverse-proxy/nginx.conf`.

Routing:

```text
/w          -> student-web
/dashboard  -> dashboard
/api/       -> api
```

TLS termination and certificate provisioning on the VPS (e.g. certbot or an equivalent ACME client) are deferred to the deployment runbook and are not part of WEB-M0's local-environment scope.

## Consequences

- Correlation ID propagation (`X-Correlation-Id`) is handled at the Nginx layer, forwarded to every upstream, and preserved if already set by an inbound request.
- Health-check requests (`/api/health/live`, `/api/health/ready`) are excluded from the default access log to keep signal-to-noise reasonable.
- Certificate renewal automation and rate-limiting/WAF-style hardening are explicitly out of scope for this ADR and WEB-M0; they belong to a future VPS deployment runbook (`docs/runbooks/`), not to this local-environment decision.
- Choosing Nginx over Caddy trades a small amount of local Caddyfile simplicity for wider operational familiarity and does not block a future re-evaluation — no other WEB-M0 artifact depends on the specific proxy implementation, only on the routing contract above.

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-05 | Initial decision: Nginx selected as the WEB-M0 reverse proxy per `07_06 §6`. |
