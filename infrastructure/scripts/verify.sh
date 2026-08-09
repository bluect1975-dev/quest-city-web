#!/usr/bin/env bash
# Quest City Web — full verification script (deliverable 26).
# Runs every applicable check and reports PASS/FAIL per step; does not stop
# at the first failure so the full picture is visible in one run, but exits
# non-zero if anything failed.
#
# Usage: bash infrastructure/scripts/verify.sh [--with-integration]

set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

WITH_INTEGRATION=false
if [ "${1:-}" = "--with-integration" ]; then
  WITH_INTEGRATION=true
fi

FAILED=0
declare -a RESULTS=()

run_step() {
  local name="$1"
  shift
  echo "==> ${name}"
  if "$@"; then
    RESULTS+=("PASS  ${name}")
  else
    RESULTS+=("FAIL  ${name}")
    FAILED=1
  fi
}

run_step "Filename convention check" pnpm run check:filenames
run_step "Duplicate file check" pnpm run check:duplicates
run_step "Fixture isolation check" pnpm run check:fixture-isolation
run_step "i18n anti-hardcoding check" pnpm run check:i18n-strings
run_step "Lint (all packages)" pnpm run lint
run_step "Type check (all packages)" pnpm run typecheck
run_step "Unit tests (all packages)" pnpm run test
run_step "Build (all packages)" pnpm run build

wait_for_postgres_health() {
  local attempt=0
  until docker compose -f infrastructure/deployment/docker-compose.yml exec -T postgres pg_isready -U quest_city_web -d quest_city_web >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "Postgres did not become ready in time."
      return 1
    fi
    sleep 2
  done
}

wait_for_api_health() {
  local attempt=0
  until curl -fsS "${HEALTH_BASE_URL}/api/health/ready" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "API did not become ready in time."
      return 1
    fi
    sleep 2
  done
}

# WEB-INFRA-HEALTH-02: student-web/dashboard now carry their own Docker
# healthcheck (docker-compose.yml) and nginx itself only starts once both
# report healthy, but this script talks to them exclusively through nginx
# (HEALTH_BASE_URL) -- explicitly waiting here as well means a genuinely
# deterministic gate for the integration test step itself, independent of
# how nginx's own startup ordering behaves on a given Docker/Compose
# version, with the same bounded-retry shape as wait_for_api_health (no
# infinite retry, real exit code propagated to run_step).
wait_for_student_web_health() {
  local attempt=0
  until curl -fsS "${HEALTH_BASE_URL}/w" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "student-web did not become ready in time."
      return 1
    fi
    sleep 2
  done
}

wait_for_dashboard_health() {
  local attempt=0
  until curl -fsS "${HEALTH_BASE_URL}/dashboard" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "dashboard did not become ready in time."
      return 1
    fi
    sleep 2
  done
}

if [ "$WITH_INTEGRATION" = true ]; then
  # Mirrors .github/workflows/ci.yml's `integration` job exactly, so this
  # is a genuine local reproduction of CI, not an approximation: an
  # ephemeral pepper (never a committed/local .env value — a copied
  # .env.example is not read by these `-f` invocations at all, since
  # Compose resolves its project directory from the compose file's own
  # location here, not from cwd) and an explicit DATABASE_URL pointing at
  # the docker-compose-provisioned Postgres on the host-mapped port 5434 —
  # never localhost:5555, which no step in this script (or in CI) ever
  # provisions.
  export CLASS_CODE_HASH_PEPPER
  CLASS_CODE_HASH_PEPPER="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  export DATABASE_URL="postgresql://quest_city_web:changeme_local_only@localhost:5434/quest_city_web"
  export DATABASE_SSL="false"
  export HEALTH_BASE_URL="http://localhost:8080"

  run_step "Docker compose build + up" docker compose -f infrastructure/deployment/docker-compose.yml up -d --build
  run_step "Wait for Postgres health" wait_for_postgres_health
  run_step "Apply database migrations" pnpm --filter @quest-city-web/tools run migrate
  run_step "Wait for API health" wait_for_api_health
  run_step "Wait for student-web health" wait_for_student_web_health
  run_step "Wait for dashboard health" wait_for_dashboard_health
  run_step "Integration tests (health-endpoints, identity-flow, identity-security, attempt-lifecycle, staff-auth-flow, staff-review-feedback-flow)" pnpm run test:integration
  if [ "$FAILED" -ne 0 ]; then
    echo "==> Dumping container logs (a step above failed)"
    docker compose -f infrastructure/deployment/docker-compose.yml logs
  fi
  docker compose -f infrastructure/deployment/docker-compose.yml down -v >/dev/null 2>&1
fi

echo ""
echo "==================== Verification report ===================="
for line in "${RESULTS[@]}"; do
  echo "$line"
done
echo "================================================================"

if [ "$FAILED" -ne 0 ]; then
  echo "Overall: FAIL"
  exit 1
fi
echo "Overall: PASS"
