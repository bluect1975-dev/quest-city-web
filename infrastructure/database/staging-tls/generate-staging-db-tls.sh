#!/usr/bin/env bash
# Quest City Web — staging PostgreSQL TLS material generator (Tranche E
# design report §10/§17). Generates a self-signed server certificate/key
# pair for the staging Postgres container, so `DATABASE_SSL=true` (ACN/MePA
# Gap Analysis GAP-09) terminates on a real, verifiable TLS connection
# rather than trusting the network.
#
# Why self-signed here specifically: staging Postgres in the E-PILOT
# topology (design report §17, Option A) is reached only from the api
# service over the internal Docker network — it is never a public-facing
# TLS endpoint, so there is no public CA to obtain a certificate from, and
# no reason to introduce one. The client (apps/api's pg.Pool, via
# `ssl: { rejectUnauthorized: true }`) is configured to trust this specific
# CA/certificate, not the public trust store — see
# infrastructure/database/staging-tls/README.md for how that trust is wired.
#
# This script is idempotent-by-refusal: it will not overwrite existing
# material, so re-running it after a manual rotation does not silently
# destroy the current cert. Delete `generated/` yourself first if you
# intend to rotate.
#
# Usage: bash infrastructure/database/staging-tls/generate-staging-db-tls.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${SCRIPT_DIR}/generated"

if [ -f "${OUT_DIR}/server.crt" ] || [ -f "${OUT_DIR}/server.key" ]; then
  echo "Refusing to overwrite existing material in ${OUT_DIR}." >&2
  echo "Delete it yourself first if you intend to rotate the staging DB TLS cert." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

# 4096-bit RSA, 825-day validity (staging convenience — this is an internal,
# operator-controlled certificate, not a public-trust one; rotate on your
# own schedule via the Credential Rotation Runbook, not via a countdown
# baked into this script).
#
# CN=postgres (Tranche E1 correction, discovered via a real local TLS
# connection test): the CN MUST match the hostname the client actually
# dials, not an arbitrary descriptive name. `DATABASE_URL` connects to the
# Docker Compose service DNS name `postgres` (docker-compose.staging.yml),
# and Node's TLS stack verifies the server certificate's CN/SAN against
# that hostname by default when `rejectUnauthorized: true` — a mismatched
# CN fails the handshake even though the CA itself is trusted via
# NODE_EXTRA_CA_CERTS. If the service name ever changes, this CN must
# change with it.
openssl req -new -x509 -days 825 -nodes \
  -newkey rsa:4096 \
  -keyout "${OUT_DIR}/server.key" \
  -out "${OUT_DIR}/server.crt" \
  -subj "/CN=postgres"

# PostgreSQL refuses to start with a server key that is group/world
# readable (a hardcoded, documented requirement of the postgres image
# itself, not specific to this script).
chmod 600 "${OUT_DIR}/server.key"
chmod 644 "${OUT_DIR}/server.crt"

echo "Generated ${OUT_DIR}/server.crt and ${OUT_DIR}/server.key."
echo "Point POSTGRES_TLS_CERT_PATH / POSTGRES_TLS_KEY_PATH at these paths in .env.staging."
