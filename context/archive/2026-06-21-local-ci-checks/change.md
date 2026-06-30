---
change_id: local-ci-checks
title: Local CI-equivalent checks to catch TS type errors and ruff formatting before push
status: archived
created: 2026-06-21
updated: 2026-06-22
archived_at: 2026-06-22T19:48:35Z
---

## Notes

Issue [B-04] #32: Commit `db42b44` broke CI with TS type errors (missing `is_active`, `is_superuser`, `is_verified` in test mocks) and ruff formatting violations. `/10x-implement` verification must run full CI-equivalent checks locally — `npm run typecheck` and `npm run build` for frontend, `ruff format --check` for Python. Create `scripts/check.sh` reproducing CI. Fix pre-commit hooks to cover all checks.
