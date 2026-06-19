#!/usr/bin/env bash
set -euo pipefail

backend_tests=""
run_frontend=false
run_all_backend=false

for file in "$@"; do
  case "$file" in
    tests/conftest.py)
      run_all_backend=true
      ;;
    tests/test_smoke.py)
      # Smoke tests need a running server — skip in pre-commit
      ;;
    tests/test_*.py)
      backend_tests="$backend_tests $file"
      ;;
    app/aggregation.py)
      backend_tests="$backend_tests tests/test_aggregation.py"
      ;;
    app/retention.py)
      backend_tests="$backend_tests tests/test_retention.py"
      ;;
    app/monitoring.py)
      backend_tests="$backend_tests tests/test_monitoring.py"
      ;;
    app/collector/*.py)
      backend_tests="$backend_tests tests/test_collector.py tests/test_collector_integration.py tests/test_gbfs_client.py tests/test_gbfs_contract.py"
      ;;
    app/api/stations.py)
      backend_tests="$backend_tests tests/test_stations_api.py"
      ;;
    app/api/geocode.py)
      backend_tests="$backend_tests tests/test_geocode.py"
      ;;
    app/auth/*.py)
      backend_tests="$backend_tests tests/test_auth.py"
      ;;
    frontend/src/test/*)
      run_frontend=true
      ;;
    frontend/src/*.test.tsx|frontend/src/*.test.ts)
      run_frontend=true
      ;;
    frontend/src/*.tsx|frontend/src/*.ts)
      test_file="${file%.tsx}.test.tsx"
      if [ ! -f "$test_file" ]; then
        test_file="${file%.ts}.test.ts"
      fi
      if [ -f "$test_file" ]; then
        run_frontend=true
      fi
      ;;
  esac
done

if $run_all_backend; then
  echo "conftest.py staged — running all backend tests (excluding smoke)"
  echo "Note: integration tests need MEVO_TEST_DATABASE_URL; they skip if absent"
  uv run pytest -v --ignore=tests/test_smoke.py
elif [ -n "$backend_tests" ]; then
  # Deduplicate and filter to existing files
  existing_tests=""
  has_integration=false
  for t in $(echo "$backend_tests" | tr ' ' '\n' | sort -u); do
    if [ -f "$t" ]; then
      existing_tests="$existing_tests $t"
      case "$t" in *integration*) has_integration=true ;; esac
    fi
  done
  if [ -n "$existing_tests" ]; then
    if $has_integration; then
      echo "Note: integration tests need MEVO_TEST_DATABASE_URL; they skip if absent"
    fi
    # shellcheck disable=SC2086
    uv run pytest -v $existing_tests
  fi
fi

if $run_frontend; then
  (cd frontend && npm test -- --run)
fi
