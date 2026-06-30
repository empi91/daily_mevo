---
date: "2026-06-21T08:59:24Z"
researcher: Claude
git_commit: deaa4cbc9da5c142a12479595293c38d1c51fbf6
branch: main
repository: empi91/daily_mevo
topic: "Gap analysis between CI checks and local pre-commit/pre-push hooks"
tags: [research, ci, pre-commit, type-checking, linting, dx]
status: complete
last_updated: 2026-06-21
last_updated_by: Claude
---

# Research: Local CI-equivalent checks gap analysis

**Date**: 2026-06-21T08:59:24Z
**Researcher**: Claude
**Git Commit**: deaa4cbc9da5c142a12479595293c38d1c51fbf6
**Branch**: main
**Repository**: empi91/daily_mevo

## Research Question

Issue [B-04] #32: CI caught TS type errors and ruff formatting violations that should have been caught locally. What checks does CI run, what do local hooks cover, and what gaps exist?

## Summary

CI runs **10 distinct check categories** across 5 jobs. Local pre-commit hooks cover only **3 of those**: ruff lint (with auto-fix), ruff format (with auto-fix), and selective related tests. The critical gaps are: **no frontend type checking** (`tsc -b`), **no frontend ESLint**, **no mypy**, **no frontend build verification**, and **no pre-push hook** at all. There is no `scripts/check.sh` or equivalent "run everything CI runs" script. The breaking issue (missing `is_active`/`is_superuser`/`is_verified` in test mocks) has already been fixed in the current codebase.

## Detailed Findings

### CI Pipeline (`.github/workflows/ci.yml`)

Five jobs run on every push/PR:

| Job | Checks | Commands |
|-----|--------|----------|
| `backend` | ruff lint, ruff format, mypy, pytest | `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy .`, `uv run pytest -v` |
| `frontend` | eslint, typecheck, tests, build | `npm run lint`, `npm run typecheck` (`tsc -b`), `npm test` (`vitest run`), `npm run build` (`tsc -b && vite build`) |
| `e2e` | migrations, build, playwright | `uv run alembic upgrade head`, `npm run build`, `npx playwright test` |
| `docker-build` | image build | `docker compose build` |
| `deploy` | health check, smoke tests | Only on main push, gated by all other jobs |

### Pre-commit Hooks (`.pre-commit-config.yaml`)

Three hooks, all run on commit (not push):

| Hook | Source | What it does |
|------|--------|-------------|
| `ruff` | `astral-sh/ruff-pre-commit` v0.15.16 | Lint with `--fix` (auto-corrects) |
| `ruff-format` | same | Format (auto-corrects) |
| `related-tests` | local `scripts/run-related-tests.sh` | Runs only tests for staged files |

The `related-tests` script maps source files to test files (e.g., `app/collector/*.py` → `tests/test_collector.py`) and runs frontend tests when frontend files are staged.

### Gap Analysis

| Check | CI | Pre-commit | Gap? |
|-------|:--:|:----------:|:----:|
| Ruff lint | `ruff check .` (strict) | `ruff --fix` (auto-fix) | Behavioral difference: pre-commit auto-fixes, CI rejects. If auto-fix leaves unfixable issues, pre-commit passes but CI fails. |
| Ruff format | `ruff format --check .` (strict) | `ruff-format` (auto-fix) | Same pattern — auto-fix vs check. Normally fine but can diverge. |
| Mypy | `uv run mypy .` | **NOT RUN** | **GAP**: Python type errors only caught in CI |
| Full pytest | `uv run pytest -v` | Selective only | Minor gap: related-tests covers most cases but can miss cross-cutting changes |
| ESLint | `npm run lint` | **NOT RUN** | **GAP**: Frontend lint errors only caught in CI |
| TypeScript typecheck | `npm run typecheck` (`tsc -b`) | **NOT RUN** | **CRITICAL GAP**: This is exactly what caused B-04. Vitest uses esbuild which strips types without checking. |
| Frontend build | `npm run build` (`tsc -b && vite build`) | **NOT RUN** | **GAP**: Build failures only caught in CI |
| E2E tests | `npx playwright test` | **NOT RUN** | Expected — too slow for pre-commit |
| Docker build | `docker compose build` | **NOT RUN** | Expected — too slow for pre-commit |

### Why B-04 Happened

The `User` interface in `frontend/src/api/auth.ts:3-9` requires five fields: `id`, `email`, `is_active`, `is_superuser`, `is_verified`. Test mock objects in `useFavourites.test.ts` and `HomePage.test.tsx` were missing the last three. Vitest (via esbuild) doesn't run type checking — it strips types for speed. Only `tsc -b` catches these errors, and `tsc -b` was not part of any local hook.

The fix has already been applied: all mock objects now include the required fields.

### Frontend Tooling Details

- TypeScript 6.0.2 with solution-style `tsconfig.json` referencing three sub-projects (app, node, test)
- All three sub-configs set `noEmit: true`
- `npm run typecheck` = `tsc -b` (checks all three projects)
- `npm run build` = `tsc -b && vite build` (typecheck + bundle)
- ESLint v10 flat config with `typescript-eslint`, `react-hooks`, `react-refresh`

### Python Tooling Details

- `pyproject.toml` has `[tool.mypy]` config (non-strict, with asyncpg/apscheduler ignores) but mypy is not in any hook
- No `[tool.ruff]` section — runs with all defaults
- Dev deps include `ruff>=0.11`, `mypy>=1.15`, `pre-commit>=4.0`

### Pre-commit Activation Risk

Pre-commit hooks only fire if `pre-commit install` has been run. There is no `.git/hooks/pre-commit` file by default — only a `post-checkout` hook (for worktree symlinks). CLAUDE.md documents the `uv run pre-commit install` step, but a developer who skips it gets zero local checks.

## Code References

- `.github/workflows/ci.yml:39-52` — backend checks (ruff, mypy, pytest)
- `.github/workflows/ci.yml:74-83` — frontend checks (eslint, typecheck, test, build)
- `.pre-commit-config.yaml` — all three hooks
- `scripts/run-related-tests.sh` — selective test runner
- `frontend/package.json:6-14` — npm scripts (build, typecheck, lint, test)
- `frontend/src/api/auth.ts:3-9` — User interface definition
- `frontend/src/hooks/useFavourites.test.ts:27` — mock with required fields (fixed)
- `frontend/src/pages/HomePage.test.tsx:77,85` — mock with required fields (fixed)
- `pyproject.toml:31-38` — mypy configuration

## Architecture Insights

1. **Auto-fix vs check divergence**: Pre-commit hooks auto-fix (ruff --fix, ruff-format) while CI checks strictly (ruff check, ruff format --check). This usually works because auto-fix runs before commit, but if a developer commits with `--no-verify`, CI catches the drift.

2. **esbuild type-erasure blind spot**: Vitest uses esbuild for speed, which strips TypeScript types without checking them. This makes `npm test` pass even with type errors. The only way to catch type errors is `tsc -b`, which must be run separately.

3. **No pre-push hook**: There is no mechanism to gate `git push`. A `scripts/check.sh` that mirrors CI would fill this gap — developers could run it manually or wire it as a pre-push hook.

4. **Selective vs full testing**: The `related-tests` pre-commit hook is a good optimization for commit speed but can miss failures caused by cross-cutting changes (e.g., changing a shared type).

## Historical Context (from prior changes)

No prior changes directly address CI/local check parity. The `scripts/run-related-tests.sh` was added as part of the testing quality gates work (archived at `context/archive/2026-06-18-testing-quality-gates/`).

## Open Questions

1. **Should `scripts/check.sh` be a pre-push hook or manual-only?** Pre-push adds ~30-60s but catches everything before CI. Manual-only relies on developer discipline.
2. **Should mypy be added to pre-commit?** It's slower than ruff but catches real bugs. Could be a pre-push hook instead.
3. **Should frontend checks (typecheck, lint) be pre-commit hooks?** `tsc -b` can take several seconds on a large codebase. lint-staged with husky is the standard approach for JS/TS repos but adds tooling complexity.
4. **Should the ruff auto-fix behavior stay or switch to check-only?** Auto-fix is convenient but masks issues that CI would catch if combined with `--no-verify` usage.
