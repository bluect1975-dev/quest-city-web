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
run_step "Lint (all packages)" pnpm run lint
run_step "Type check (all packages)" pnpm run typecheck
run_step "Unit tests (all packages)" pnpm run test
run_step "Build (all packages)" pnpm run build

wait_for_api_health() {
  local attempt=0
  until curl -fsS http://localhost:8080/api/health/live >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "API did not become healthy in time."
      return 1
    fi
    sleep 2
  done
}

if [ "$WITH_INTEGRATION" = true ]; then
  run_step "Docker compose build + up" docker compose -f infrastructure/deployment/docker-compose.yml up -d --build
  run_step "Wait for API health" wait_for_api_health
  run_step "Integration tests (health endpoints)" env HEALTH_BASE_URL=http://localhost:8080 pnpm run test:integration
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
