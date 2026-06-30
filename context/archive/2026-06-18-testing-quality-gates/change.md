---
change_id: testing-quality-gates
title: Wire quality gates — lint, typecheck, and test suite run in CI on every push
status: archived
created: 2026-06-18
updated: 2026-06-20
archived_at: 2026-06-20T11:19:47Z
---

## Notes

Phase 5 of the test plan rollout (§3). Lock lint + typecheck + full test suite in CI on every push; add pre-commit hooks.

### Roadmap alignment

This change delivers **F-03 (cicd-pipeline)** from the roadmap — "GitHub Actions auto-deploy on merge." F-03 is a prerequisite for S-03 (favourites-dashboard) and was sequenced to land before auth ships (S-02 is already done, so this is overdue).

Phase 5 and F-03 overlap significantly: both require a GitHub Actions workflow. Phase 5 focuses on quality gates (lint, typecheck, tests); F-03 adds build + deploy + health-check. Implementing them together avoids two separate CI workflow iterations.

### Scope (from test plan §3 + §5)

- GitHub Actions workflow with Postgres 16 service container for integration tests
- Gates: ruff check, ruff format --check, mypy, pytest (backend), npm run lint, npm run typecheck, npm test (frontend), npm run build
- Claude Code per-edit hooks: linter (ruff/eslint) + type check (mypy/tsc) after every file edit
- Git pre-commit hook: ruff lint+format + run tests related to staged files (source-to-test mapping script)
- Auto-deploy on merge to main (F-03 scope — deploy.sh or Mikr.us /exec API)
- Post-deploy health check (F-03 scope)

### Risks covered

Cross-cutting (all test plan risks benefit from CI enforcement). Specifically addresses Risk #4 (deploy-time config divergence) by ensuring tests run before deploy.

### Prerequisites

All test phases 1–4 complete. Backend: 11 test files (1568 LOC). Frontend: 11 test files (710 LOC).
