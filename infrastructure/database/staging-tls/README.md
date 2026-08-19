# Staging PostgreSQL TLS material

Tranche E design report §10 ("Gestione CA/certificato... Se Postgres resta su
container nello stesso VPS: generare un certificato self-signed/CA locale per
Postgres stesso"). This directory holds the **generator script and config
templates only** — the actual certificate/key are never committed.

## Generating

```bash
bash infrastructure/database/staging-tls/generate-staging-db-tls.sh
```

Produces `generated/server.crt` and `generated/server.key` (gitignored — see
repo root `.gitignore`). The script refuses to overwrite existing material;
delete `generated/` yourself first if you intend to rotate.

## How trust is established

- `postgresql.staging.conf` turns on `ssl` and points Postgres at the
  generated cert/key.
- `pg_hba.staging.conf` requires `hostssl` for every TCP connection — a
  client that does not negotiate TLS is refused, not merely allowed to skip
  it (ACN/MePA Gap Analysis GAP-09: "Do not weaken TLS validation").
- `apps/api`'s five `pg.Pool` instances already support
  `ssl: { rejectUnauthorized: true }` when `DATABASE_SSL=true` — this is
  full certificate validation, not "accept and ignore". For that validation
  to succeed against a self-signed certificate, the connecting process must
  trust this specific certificate rather than the public CA store. The
  standard `pg`/Node TLS mechanism for this is `NODE_EXTRA_CA_CERTS`
  pointing at `generated/server.crt` (wired in
  `docker-compose.staging.yml`'s `api` service) — this is a targeted,
  single-certificate trust addition, not a weakening of `rejectUnauthorized`.

## Rotation

Not periodic — treat as a rare, planned operation (see the Credential
Rotation Runbook). Rotating requires: generate new material, update the
`NODE_EXTRA_CA_CERTS`-referenced file, restart `postgres` and `api` in the
correct order (Postgres must come up with the new cert before `api`
reconnects), verify a real encrypted connection post-rotation (never assume
success from configuration alone).

## Migration path (design report §17)

If staging ever migrates PostgreSQL to a managed/external provider (Option
B), this entire directory becomes unnecessary — the provider supplies its
own certificate (often publicly trusted), and `NODE_EXTRA_CA_CERTS` is
simply unset. No application code changes either way.
