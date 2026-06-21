#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

banner() {
  echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

fail() {
  echo -e "\n${RED}✗ Failed: $1${NC}\n"
  exit 1
}

banner "Ruff lint"
uv run ruff check . || fail "Ruff lint"

banner "Ruff format"
uv run ruff format --check . || fail "Ruff format"

banner "Mypy"
uv run mypy . || fail "Mypy"

if [ -d frontend/node_modules ]; then
  banner "ESLint"
  (cd frontend && npm run lint) || fail "ESLint"

  banner "TypeScript typecheck"
  (cd frontend && npm run typecheck) || fail "TypeScript typecheck"

banner "Backend tests"
MEVO_JWT_SECRET="${MEVO_JWT_SECRET:-test-secret}" uv run pytest -v --ignore=tests/test_smoke.py || fail "Backend tests"

  banner "Frontend tests"
  (cd frontend && npm test) || fail "Frontend tests"
else
  echo -e "\n${BLUE}Skipping frontend checks (frontend/node_modules not found — run 'npm install' in frontend/)${NC}\n"
fi

echo -e "\n${GREEN}✓ All checks passed${NC}\n"
