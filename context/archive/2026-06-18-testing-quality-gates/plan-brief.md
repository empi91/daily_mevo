# Quality Gates — CI Pipeline, Pre-commit Hooks, Auto-Deploy — Plan Brief

> Full plan: `context/changes/testing-quality-gates/plan.md`
> Research: `context/changes/testing-quality-gates/research.md`

## What & Why

Wire the project's existing quality gates (lint, typecheck, tests) into automated enforcement at three levels: CI (GitHub Actions on every push/PR), pre-commit (ruff + related tests before each commit), and edit-time (Claude Code hooks). Add SSH-based auto-deploy on merge to main with post-deploy smoke tests. This delivers test plan Phase 5 and roadmap item F-03 — the last missing piece before all test infrastructure is automated.

## Starting Point

All gate commands exist and pass locally: ruff, mypy, eslint, tsc, pytest (22 test files, ~2600 LOC), vitest, and npm build. Deploy is manual via `deploy.sh` (SSH to Mikr.us). Smoke tests are pre-built (`tests/test_smoke.py`) but unwired. Zero CI, zero pre-commit hooks, zero editor hooks are configured.

## Desired End State

Every push runs the full gate suite in GitHub Actions. Pre-commit hooks catch formatting and related-test regressions locally. Claude Code hooks flag lint and type issues at edit time. Merges to main auto-deploy to Mikr.us and run smoke tests against the live instance. Documentation reflects the actual Mikr.us deployment target.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Deploy trigger from CI | SSH key in GitHub Secrets | Proven path — deploy.sh already uses SSH; no 60s timeout risk like /exec API | Plan |
| Per-edit type check scope | Single-file only (mypy --follow-imports=silent) | Keeps edit latency low (~200ms ruff + ~1-3s mypy); full tsc not feasible for single files | Plan |
| Coverage tooling | Deferred | Keeps scope focused on gate enforcement; threshold calibration is a separate effort | Plan |
| Strict TypeScript / mypy | Deferred | Orthogonal to CI wiring; enabling strict is a large fix-up effort | Plan |
| Pre-commit test scope | Ruff + related tests (source-to-test mapping) | Catches regressions before CI; integration tests skip gracefully without test DB | Plan |
| Fly.io docs fix | Include in this change | Trivial, zero-risk; avoids misleading future contributors | Plan |

## Scope

**In scope:**
- GitHub Actions workflow (backend + frontend jobs, Postgres 16 service container)
- Pre-commit hooks (ruff lint+format, source-to-test mapping script)
- Claude Code PostToolUse hooks (linter + single-file type check)
- SSH-based auto-deploy job on merge to main
- Post-deploy smoke tests
- Docs fix: Fly.io → Mikr.us in CLAUDE.md and tech-stack-v2.md
- Test plan §6 Phase 5 cookbook entry

**Out of scope:**
- Strict TypeScript / strict mypy enablement
- Coverage tooling (pytest-cov)
- Security scanning (bandit, pip-audit)
- E2E browser tests (Phase 6)
- Docker image / deployment parity tests (Phase 6)
- Preview/staging deployments
- CI-triggered rollback

## Architecture / Approach

GitHub Actions workflow with two parallel jobs (`backend` on Python 3.12 + Postgres 16 service, `frontend` on Node 20) plus a gated `deploy` job that runs only on push to main after both pass. Deploy executes the same SSH sequence as `deploy.sh`, then runs smoke tests against the live URL. Locally, `pre-commit` runs ruff and a custom `scripts/run-related-tests.sh` that maps staged source files to their test files. Claude Code hooks run per-edit linting and single-file type checking via `.claude/settings.json` PostToolUse config.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. GitHub Actions CI Workflow | Full gate suite on every push/PR | Postgres service container config — integration tests must connect correctly |
| 2. Pre-commit Hooks | Local ruff + related-test enforcement | Source-to-test mapping script must handle all file patterns correctly |
| 3. Claude Code Per-Edit Hooks | Edit-time lint + type feedback | Hook env var for edited file path — must verify Claude Code's hook API |
| 4. Auto-Deploy on Merge | SSH deploy + smoke tests on main | SSH key management — dedicated CI key must be generated and configured |
| 5. Docs Cleanup | Fly.io → Mikr.us, test plan §6 update | None — trivial changes |

**Prerequisites:** All test phases 1–4 complete (they are). GitHub repo access for Actions. SSH key generation for deploy.
**Estimated effort:** ~2-3 sessions across 5 phases.

## Open Risks & Assumptions

- SSH key for CI deploy must be generated and added to both GitHub Secrets and Mikr.us `authorized_keys` — manual setup step
- Docker build on Mikr.us (768MB RAM) — CI does not build images, only the server does; if server OOMs during build, deploy fails
- Single-file mypy may miss cross-file type errors — accepted trade-off for edit-loop speed; full check runs in CI
- Pre-commit related-tests hook relies on naming convention — new modules must follow the pattern or tests won't be auto-discovered

## Success Criteria (Summary)

- Every push to any branch runs all quality gates in GitHub Actions and reports pass/fail
- Merging to main triggers deploy to Mikr.us and smoke tests confirm the live instance works
- Pre-commit hooks prevent committing lint violations and catch related-test regressions locally
