# Runbook: Certificate Renewal / Failure (staging)

**Trigger**: scheduled renewal, or the `certExpiry` check in `tools/staging-healthcheck.mjs` alerting (<14 days to expiry — design report §28).
**Owner**: DEVOPS.
**References**: Tranche E design report §9; `infrastructure/reverse-proxy/nginx.staging.conf`.

## Mechanism (whichever was chosen at implementation time — see nginx.staging.conf's header comment)

- **ACME client (certbot/acme.sh) companion service**: check its own renewal logs/timer status; the HTTP-01 challenge path (`/.well-known/acme-challenge/`) must remain reachable through the edge for renewal to succeed — verify it hasn't been broken by an unrelated nginx config change.
- **Provider-managed TLS gateway**: renewal is the provider's responsibility; this runbook step is "verify the provider's renewal actually happened," not "perform it."

## Manual emergency renewal (mechanism-agnostic fallback)

1. Obtain a new cert/key pair through whichever mechanism is in place.
2. Place them at the paths `nginx.staging.conf` expects (`/etc/nginx/tls/fullchain.pem`, `/etc/nginx/tls/privkey.pem` inside the container — mounted from `${NGINX_TLS_CERT_DIR}` on the host).
3. Reload nginx without downtime: `docker compose -p quest-city-web-staging -f infrastructure/deployment/docker-compose.staging.yml exec nginx nginx -s reload`.
4. Verify from OUTSIDE the host: `curl -vI https://<staging-domain>/api/health/live` and confirm the certificate chain and expiry are as expected — do not trust config alone.

## If renewal has already failed (cert expired)

This is a SEV-1/2 availability incident (05-incident-response.md: users cannot reach the site at all, or get a hard browser TLS error). Prioritize the manual emergency renewal above over root-causing why automated renewal failed — root-cause after service is restored.

## HSTS caution

Per the design report's phased plan (§9): staging starts with `max-age=300` (5 minutes) specifically so that a certificate problem is quickly forgiven by browsers that cached HSTS. **Do not extend `max-age` or add `preload` until TLS has run stably for a real observation period** — doing so before then turns a routine cert hiccup into an extended outage for any client that already cached the longer HSTS value.
