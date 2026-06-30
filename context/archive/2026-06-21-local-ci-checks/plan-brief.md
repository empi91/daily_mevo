# Local CI-Equivalent Checks — Plan Brief

> Full plan: `context/changes/local-ci-checks/plan.md`
> Research: `context/changes/local-ci-checks/research.md`

## What & Why

Create a `scripts/check.sh` that mirrors CI's backend + frontend checks locally, wired as a pre-push hook. Issue B-04 showed that TS type errors and ruff formatting violations slipped through because local hooks only cover ruff auto-fix and related tests — no typecheck, no ESLint, no mypy.

## Starting Point

CI runs 10 check categories. Local pre-commit hooks cover 3 (ruff lint auto-fix, ruff format auto-fix, related tests). There is no pre-push hook and no script to run all CI checks locally. The `pre-commit` framework is already in use.

## Desired End State

`git push` automatically runs all CI-equivalent checks (ruff check, ruff format --check, mypy, eslint, tsc -b, pytest, vitest). Push is blocked on failure. Developers can also run `scripts/check.sh` manually anytime. The B-04 class of failures is eliminated.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| Hook type | Pre-push (not pre-commit) | Keeps commits fast; catches everything before code leaves the machine | Plan |
| Hook framework | pre-commit `stages: [pre-push]` | Single toolchain — reuses existing pre-commit setup, no new dependencies | Plan |
| Mypy inclusion | Yes, in check.sh | Matches CI exactly; Python type errors are the same class of bug as B-04's TS errors | Plan |
| Frontend build | Excluded from check.sh | `tsc -b` already covers type checking; `vite build` adds time without catching new errors | Plan |
| E2E/Docker | Excluded from check.sh | Too slow for local checks (~2+ min each); stays CI-only | Research |

## Scope

**In scope:**
- `scripts/check.sh` mirroring CI's backend + frontend jobs
- Pre-push hook in `.pre-commit-config.yaml`
- CLAUDE.md updated with setup command and manual run command
- Worktree post-checkout hook updated to install pre-push hooks

**Out of scope:**
- E2E tests, Docker build, smoke tests in local checks
- Replacing existing pre-commit hooks (ruff auto-fix stays)
- Adding husky/lint-staged

## Architecture / Approach

Single bash script (`scripts/check.sh`) runs 7 checks sequentially, matching CI's `backend` and `frontend` jobs. Wired into git via `pre-commit` framework's `stages: [pre-push]` support. One phase, straightforward implementation.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Create check script and wire pre-push hook | Full CI-equivalent local checks with automatic pre-push enforcement | Developer must run `pre-commit install --hook-type pre-push` (same adoption pattern as existing hooks) |

**Prerequisites:** Current codebase passes all CI checks (it does — main is green)
**Estimated effort:** ~1 session, single phase

## Open Risks & Assumptions

- Developers must run `pre-commit install --hook-type pre-push` once (documented in CLAUDE.md, auto-installed in worktrees)
- Pre-push hook adds ~30-60s to every push — acceptable tradeoff for catching CI failures early
- `--no-verify` bypass exists but is intentional git behavior

## Success Criteria (Summary)

- `scripts/check.sh` passes on clean codebase and catches deliberate type errors
- `git push` is blocked when checks fail (pre-push hook works)
- Push succeeds when all checks pass
