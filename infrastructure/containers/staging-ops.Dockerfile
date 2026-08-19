# Quest City Web — staging backup/restore tooling image (Tranche E1 scope:
# backup + restore only). Needs both Node (to run
# tools/backup-staging-db.mjs / restore-staging-db.mjs, which do the
# checksum/encryption/retention/adapter work) and the PostgreSQL client
# binaries (pg_dump/pg_restore/psql) to talk to the staging database — no
# single official image ships both, so this is a minimal two-ingredient
# layer on top of the same Node base every other Quest City Web image uses.
#
# This image is never exposed to any network port and never serves traffic
# — it only runs as a scheduled/one-shot compose service (see
# docker-compose.staging.yml's `backup` and `restore-drill` services,
# "ops" profile).
#
# Deliberately does NOT copy tools/staging-healthcheck.mjs: that file is
# out of Tranche E1 scope (it belongs to the out-of-band monitoring
# redesign, Tranche E2 — see the Tranche E reconciliation report).
#
# syntax=docker/dockerfile:1
FROM node:24-slim

# Debian 12 (this base image's OS)'s own repos only carry
# postgresql-client-15 by default — the staging Postgres server is 17.2
# (docker-compose.staging.yml). PostgreSQL's own documented guidance is
# that client tools should match or exceed the server major version;
# pg_dump/pg_restore from an older client against a newer server risks
# silently missing newer catalog features. The PGDG apt repository is the
# standard, PostgreSQL-project-maintained source for a specific client
# major version on Debian — added here explicitly rather than trusting
# whatever version the base OS repo happens to carry.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Only `pg` is needed here (restore-staging-db.mjs's integrity-check
# queries) — installed directly, pinned to the same version the rest of
# the monorepo uses (apps/api/package.json et al.), rather than pulling in
# the whole pnpm workspace that this single-purpose image has no other use
# for.
RUN npm install --no-save pg@8.13.1
COPY tools/backup-staging-db.mjs tools/restore-staging-db.mjs tools/staging-backup-target-adapter.mjs ./

USER node
