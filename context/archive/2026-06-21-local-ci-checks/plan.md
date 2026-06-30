# Local CI-Equivalent Checks Implementation Plan

## Overview

Create a `scripts/check.sh` that mirrors all CI checks locally and wire it as a pre-push hook via the `pre-commit` framework, so type errors and formatting violations are caught before code reaches CI. This directly addresses issue [B-04] #32.

## Current State Analysis

CI (`.github/workflows/ci.yml`) runs 10 check categories across 5 jobs. Local pre-commit hooks (`.pre-commit-config.yaml`) cover only 3:

| Check | CI | Local |
|-------|:--:|:-----:|
| Ruff lint | ✓ | ✓ (pre-commit, auto-fix) |
| Ruff format | ✓ | ✓ (pre-commit, auto-fix) |
| Mypy | ✓ | ✗ |
| Backend pytest | ✓ | Partial (related tests only) |
| ESLint | ✓ | ✗ |
| TypeScript typecheck (`tsc -b`) | ✓ | ✗ |
| Frontend vitest | ✓ | Partial (related tests only) |
| Frontend build (`vite build`) | ✓ | ✗ |
| E2E (Playwright) | ✓ | ✗ (expected) |
| Docker build | ✓ | ✗ (expected) |

The missing `tsc -b` is the root cause of B-04 — Vitest uses esbuild which strips types without checking.

### Key Discoveries:

- `.pre-commit-config.yaml` uses `astral-sh/ruff-pre-commit` v0.15.16 and a local `related-tests` hook
- `scripts/run-related-tests.sh` (83 lines) maps staged files to tests but doesn't run typecheck/lint
- `frontend/package.json:8` defines `"typecheck": "tsc -b"` — already available, just not wired
- Pre-commit framework supports `stages: [pre-push]` hooks via `pre-commit install --hook-type pre-push`
- No Makefile exists; `scripts/` is the established location for shell scripts

## Desired End State

Running `git push` triggers `scripts/check.sh` via a pre-push hook. The script runs ruff check, ruff format --check, mypy, eslint, tsc -b, backend tests, and frontend tests — matching CI's backend and frontend jobs. If any check fails, push is blocked. Developers can also run `scripts/check.sh` manually at any time.

**Verification**: Push a commit with a deliberate type error in a frontend test file. The pre-push hook blocks the push with a clear error message pointing to the type error.

## What We're NOT Doing

- **E2E tests in the hook** — too slow for pre-push (~2+ minutes), stays CI-only
- **Docker build in the hook** — too slow, stays CI-only
- **Smoke tests** — require a running server, stays CI-only
- **Replacing pre-commit hooks** — existing ruff auto-fix on commit is valuable and stays
- **Adding husky/lint-staged** — unnecessary complexity; pre-commit framework handles both stages
- **Running frontend build (vite build)** — `tsc -b` already covers type checking; vite build adds time but catches nothing extra for correctness

## Implementation Approach

Single phase: create `scripts/check.sh` mirroring CI's backend + frontend jobs, add a pre-push hook entry to `.pre-commit-config.yaml`, update `CLAUDE.md` with the new setup command, and update the `post-checkout` worktree hook to install pre-push hooks too.

## Phase 1: Create check script and wire pre-push hook

### Overview

Create the check script, add it to pre-commit config as a pre-push stage hook, update docs and worktree setup.

### Changes Required:

#### 1. Create check script

**File**: `scripts/check.sh` (new)

**Intent**: Single script that runs the same checks as CI's `backend` and `frontend` jobs, in the same order. Exit on first failure with a clear message showing which check failed.

**Contract**: Bash script with `set -euo pipefail`. Runs these commands in order, each with a header banner:
1. `uv run ruff check .` (not `--fix` — match CI's strict mode)
2. `uv run ruff format --check .`
3. `uv run mypy .`
4. `cd frontend && npm run lint` (`eslint .`)
5. `cd frontend && npm run typecheck` (`tsc -b`)
6. `uv run pytest -v --ignore=tests/test_smoke.py`
7. `cd frontend && npm test` (`vitest run`)

Each step prints a colored banner (e.g., `=== Ruff lint ===`) before running. On failure, the step name is shown in the error. On success, print a summary line at the end.

#### 2. Add pre-push hook to pre-commit config

**File**: `.pre-commit-config.yaml`

**Intent**: Wire `scripts/check.sh` as a pre-push stage hook so it runs automatically on `git push`.

**Contract**: Add a new local hook entry with `id: full-check`, `stages: [pre-push]`, `entry: scripts/check.sh`, `always_run: true`, `pass_filenames: false`, `language: script`.

#### 3. Update CLAUDE.md setup instructions

**File**: `CLAUDE.md`

**Intent**: Document the new pre-push hook installation command alongside the existing pre-commit install.

**Contract**: Update the "Set up pre-commit hooks" line to include `--hook-type pre-push`:
```
# Set up pre-commit hooks (one-time after clone)
uv run pre-commit install && uv run pre-commit install --hook-type pre-push
```

Add a new command entry for running checks manually:
```
# Run all CI checks locally (same as pre-push hook)
scripts/check.sh
```

#### 4. Update worktree post-checkout hook

**File**: `.git/hooks/post-checkout`

**Intent**: Ensure worktrees also get the pre-push hook installed, not just pre-commit.

**Contract**: After the existing `pre-commit install` call, add `uv run pre-commit install --hook-type pre-push` in the same block.

### Success Criteria:

#### Automated Verification:

- `scripts/check.sh` exists and is executable
- `scripts/check.sh` runs successfully on the current codebase (all checks pass)
- `.pre-commit-config.yaml` contains a `pre-push` stage hook entry
- `uv run pre-commit install --hook-type pre-push` succeeds
- Ruff check passes: `uv run ruff check .`
- Ruff format passes: `uv run ruff format --check .`
- Mypy passes: `uv run mypy .`
- Frontend lint passes: `cd frontend && npm run lint`
- Frontend typecheck passes: `cd frontend && npm run typecheck`
- Backend tests pass: `uv run pytest -v --ignore=tests/test_smoke.py`
- Frontend tests pass: `cd frontend && npm test`

#### Manual Verification:

- Introduce a deliberate TS type error (e.g., remove `is_active` from a test mock), verify `scripts/check.sh` catches it
- Verify `git push` is blocked by the pre-push hook when the type error is present
- Revert the error, verify push succeeds

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Automated:

- Run `scripts/check.sh` on the current clean codebase — all checks must pass
- Verify the pre-commit config is valid: `uv run pre-commit validate-config` (if available) or `uv run pre-commit run --hook-stage pre-push --all-files`

### Manual:

1. Introduce a type error in `frontend/src/hooks/useFavourites.test.ts` (remove `is_active` from mock)
2. Run `scripts/check.sh` — should fail at the typecheck step
3. Attempt `git push` — pre-push hook should block
4. Fix the error, push should succeed

## References

- Related research: `context/changes/local-ci-checks/research.md`
- CI workflow: `.github/workflows/ci.yml`
- Current pre-commit config: `.pre-commit-config.yaml`
- Related tests script: `scripts/run-related-tests.sh`
- Prior quality gates change: `context/archive/2026-06-18-testing-quality-gates/plan.md`
- Issue: [B-04] #32

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Create check script and wire pre-push hook

#### Automated

- [x] 1.1 scripts/check.sh exists and is executable — 39238f6
- [x] 1.2 scripts/check.sh runs successfully on current codebase — 39238f6
- [x] 1.3 .pre-commit-config.yaml contains pre-push stage hook — 39238f6
- [x] 1.4 pre-commit install --hook-type pre-push succeeds — 39238f6
- [x] 1.5 Ruff check passes — 39238f6
- [x] 1.6 Ruff format passes — 39238f6
- [x] 1.7 Mypy passes — 39238f6
- [x] 1.8 Frontend lint passes — 39238f6
- [x] 1.9 Frontend typecheck passes — 39238f6
- [x] 1.10 Backend tests pass — 39238f6
- [x] 1.11 Frontend tests pass — 39238f6

#### Manual

- [x] 1.12 Deliberate TS type error caught by scripts/check.sh — 39238f6
- [ ] 1.13 git push blocked by pre-push hook with type error
- [ ] 1.14 Push succeeds after fixing error
