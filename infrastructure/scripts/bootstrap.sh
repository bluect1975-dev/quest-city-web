#!/usr/bin/env bash
# Quest City Web — single documented local bootstrap procedure
# (deliverable 25; acceptance criterion: "una singola procedura documentata
# avvia l'ambiente locale").
#
# Usage: bash infrastructure/scripts/bootstrap.sh

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "==> Checking prerequisites"
command -v node >/dev/null || { echo "Node.js is required (see .nvmrc for the expected major version)."; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is required (corepack enable && corepack prepare pnpm@11.2.2 --activate)."; exit 1; }
command -v docker >/dev/null || { echo "Docker (with Compose v2) is required."; exit 1; }

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
else
  echo "==> .env already exists, leaving it untouched"
fi

echo "==> Installing dependencies (pnpm workspace)"
pnpm install --frozen-lockfile

echo "==> Building and starting the local environment (postgres, api, student-web, dashboard, nginx)"
docker compose -f infrastructure/deployment/docker-compose.yml up -d --build

echo "==> Waiting for the API to become healthy"
attempt=0
until curl -fsS http://localhost:8080/api/health/live >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "API did not become healthy in time. Check: docker compose -f infrastructure/deployment/docker-compose.yml logs"
    exit 1
  fi
  sleep 2
done

echo "==> Running database migrations"
set -a
# shellcheck disable=SC1091
source .env
set +a
pnpm --filter @quest-city-web/tools run migrate

echo "==> Provisioning Telegram alert channel (no-op if TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are unset)"
pnpm --filter @quest-city-web/tools run provision:telegram-alert-channel

cat <<'EOF'

==> Bootstrap complete.

  Student Web : http://localhost:8080/w
  Dashboard   : http://localhost:8080/dashboard
  API health  : http://localhost:8080/api/health/live
                http://localhost:8080/api/health/ready

Run `bash infrastructure/scripts/verify.sh` for the full verification suite
(lint, type check, unit tests, build, integration tests).

Stop the environment with:
  docker compose -f infrastructure/deployment/docker-compose.yml down
EOF
