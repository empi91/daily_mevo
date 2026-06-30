# Quality Gates — CI Pipeline, Pre-commit Hooks, Auto-Deploy Implementation Plan

## Overview

Wire lint, typecheck, and the full test suite into a GitHub Actions CI workflow on every push/PR; add pre-commit hooks (ruff lint+format and related-test runner); configure Claude Code per-edit hooks (linter + single-file type check); add SSH-based auto-deploy on merge to main with post-deploy smoke tests. Fix stale deployment-target references in docs.

This delivers Phase 5 of the test plan rollout (§3) and roadmap item F-03 (cicd-pipeline).

## Current State Analysis

All quality-gate commands exist and pass locally. Zero CI automation, zero pre-commit hooks, and zero Claude Code hooks are configured. Deploy is fully manual via `deploy.sh` (SSH to Mikr.us).

### Key Discoveries:

- All gate commands work: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy .`, `cd frontend && npm run lint`, `cd frontend && npm run typecheck`, `uv run pytest`, `cd frontend && npm test`, `cd frontend && npm run build`
- 22 test files (~2600 LOC): 12 backend (pytest), 11 frontend (vitest) — all passing
- Integration tests need Postgres 16 + `MEVO_TEST_DATABASE_URL` + `MEVO_JWT_SECRET`
- Frontend tests need no backend — jsdom environment, fully self-contained
- `deploy.sh` uses SSH alias `mikrus` → `root@srv66.mikr.us:10312` — does `git pull && docker compose build && docker compose up -d` on the server
- Smoke tests (`tests/test_smoke.py`) ready with `@pytest.mark.smoke` marker and configurable `MEVO_SMOKE_BASE_URL`
- `.claude/settings.json` has `{"respectGitignore": false}` — no hooks configured
- No `.pre-commit-config.yaml` exists
- No `.github/workflows/` directory exists
- `CLAUDE.md:19` and `tech-stack-v2.md:8` still reference Fly.io — actual target is Mikr.us

## Desired End State

Every push and PR runs the full quality-gate suite in GitHub Actions (lint, typecheck, tests for both backend and frontend). Pre-commit hooks catch formatting and related-test regressions before code reaches the remote. Claude Code hooks catch lint and type issues at edit time. Merges to main auto-deploy to Mikr.us with a post-deploy smoke test confirming the deployed instance is healthy. Documentation reflects the actual deployment target.

### Verification:

- Push a branch → CI runs all gates, reports pass/fail
- Create a PR → same CI checks appear as required status checks
- Merge to main → CI gates pass → deploy job SSHs to Mikr.us → smoke test confirms health
- `git commit` locally → pre-commit runs ruff + related tests
- Edit a `.py` file in Claude Code → ruff check runs automatically; mypy single-file check runs
- Edit a `.ts`/`.tsx` file → eslint runs automatically; tsc single-file not feasible (documented)
- `CLAUDE.md` and `tech-stack-v2.md` reference Mikr.us, not Fly.io

## What We're NOT Doing

- Enabling strict TypeScript or strict mypy (separate effort)
- Adding pytest-cov or coverage thresholds (deferred)
- Adding security scanning (bandit, pip-audit)
- Adding Prettier for frontend formatting
- Adding E2E browser tests (Phase 6)
- Docker image tests or deployment parity tests (Phase 6)
- Preview/staging deployments (single VPS constraint)
- Rollback automation from CI (manual via `rollback.sh`)

## Implementation Approach

Five phases, ordered by dependency: CI workflow first (the backbone), then pre-commit hooks (local enforcement), then Claude Code hooks (edit-time feedback), then auto-deploy (depends on CI passing), then docs cleanup (trivial, last).

---

## Phase 1: GitHub Actions CI Workflow

### Overview

Create the CI workflow that runs all quality gates on every push and PR. This is the backbone — all other phases layer on top of it.

### Changes Required:

#### 1. Create GitHub Actions workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Define a CI pipeline that runs backend and frontend quality gates in parallel, using a Postgres 16 service container for integration tests. Triggers on push to any branch and PRs to main.

**Contract**: The workflow has two jobs:

- `backend` — runs on `ubuntu-latest`, uses `actions/setup-python` + `astral-sh/setup-uv`, starts a Postgres 16 service container on port 5432. Steps: `uv sync`, then in order: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy .`, `uv run pytest -v`. Environment: `MEVO_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`, `MEVO_JWT_SECRET=ci-test-secret`.

- `frontend` — runs on `ubuntu-latest`, uses `actions/setup-node` (Node 20). Steps: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Working directory: `frontend/`.

Both jobs run in parallel (no dependency between them).

### Success Criteria:

#### Automated Verification:

- Workflow file passes `actionlint` or GitHub's syntax validation
- Push to a test branch triggers both `backend` and `frontend` jobs
- Backend job: ruff check, ruff format --check, mypy, and pytest all pass
- Frontend job: eslint, tsc, vitest, and build all pass
- A deliberate lint violation on a branch causes the backend job to fail

#### Manual Verification:

- GitHub Actions UI shows both jobs with clear step names
- PR check status appears on pull requests

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Pre-commit Hooks

### Overview

Add the `pre-commit` framework with ruff hooks and a custom source-to-test mapping script, so developers catch formatting issues and test regressions before pushing.

### Changes Required:

#### 1. Add pre-commit to dev dependencies

**File**: `pyproject.toml`

**Intent**: Add `pre-commit` as a dev dependency so it's available via `uv run pre-commit`.

**Contract**: Add `"pre-commit>=4.0"` to the `[project.optional-dependencies] dev` array.

#### 2. Create pre-commit configuration

**File**: `.pre-commit-config.yaml`

**Intent**: Configure ruff lint+format hooks (from the official `astral-sh/ruff-pre-commit` repo) and a local hook that runs tests related to staged source files.

**Contract**: Three hooks:
- `ruff` (lint) from `astral-sh/ruff-pre-commit` — runs on Python files, auto-fixes
- `ruff-format` from the same repo — runs on Python files
- `local` hook named `related-tests` — runs `scripts/run-related-tests.sh` on staged files, `pass_filenames: true`, `types: [file]`, `language: script`

#### 3. Create source-to-test mapping script

**File**: `scripts/run-related-tests.sh`

**Intent**: Given a list of staged file paths, determine which test files are related and run only those. This keeps pre-commit fast by avoiding the full test suite.

**Contract**: Shell script (bash, `set -euo pipefail`) that:
1. Receives file paths as arguments (from pre-commit `pass_filenames`)
2. For each `.py` file, maps to related test files using the convention documented in research.md §7.3 (e.g., `app/aggregation.py` → `tests/test_aggregation.py`, `app/collector/*.py` → `tests/test_collector.py tests/test_collector_integration.py tests/test_gbfs_client.py tests/test_gbfs_contract.py`, etc.)
3. For `.ts`/`.tsx` files, checks if a co-located `.test.tsx` exists
4. If `tests/conftest.py` is staged, runs all backend tests
5. Deduplicates and runs: `uv run pytest <matched-backend-tests>` if any, `cd frontend && npm test` if any frontend matches
6. Exits 0 if no test files matched (pure config/docs change)
7. Prints a note when integration tests are included: "Note: integration tests need MEVO_TEST_DATABASE_URL; they skip if absent"

#### 4. Install pre-commit hooks step in dev docs

**File**: `CLAUDE.md`

**Intent**: Document the `pre-commit install` step so developers know to run it after cloning.

**Contract**: Add a line under the Development Commands section: `uv run pre-commit install` with a note that it's a one-time setup after clone.

### Success Criteria:

#### Automated Verification:

- `uv sync` installs pre-commit
- `uv run pre-commit run --all-files` passes (ruff hooks pass on current codebase)
- `scripts/run-related-tests.sh` is executable
- Staging a `.py` file with a lint violation and running `git commit` triggers ruff and blocks the commit

#### Manual Verification:

- Staging a change to `app/aggregation.py` and committing runs `tests/test_aggregation.py`
- Staging only a `.md` file and committing skips the related-tests hook (no test files matched)
- Integration tests skip gracefully when `MEVO_TEST_DATABASE_URL` is absent

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Claude Code Per-Edit Hooks

### Overview

Configure Claude Code `PostToolUse` hooks so that every file edit automatically runs the linter and single-file type checker for that file's language.

### Changes Required:

#### 1. Configure PostToolUse hooks

**File**: `.claude/settings.json`

**Intent**: Add hooks that run after Edit/Write tool use — routing to the correct linter and type checker based on file extension.

**Contract**: Add a `hooks` key to the existing settings JSON. The `PostToolUse` hook triggers on `Edit` and `Write` events. The hook script:

- For `.py` files: runs `uv run ruff check --fix $CLAUDE_FILE_PATH` then `uv run mypy --follow-imports=silent $CLAUDE_FILE_PATH`
- For `.ts`/`.tsx` files: runs `cd frontend && npx eslint $CLAUDE_FILE_PATH` (no single-file tsc — TypeScript project-references mode requires full build; document this limitation)
- For other file types: no-op (exit 0)

The environment variable containing the edited file path is provided by Claude Code's hook system (`$CLAUDE_FILE_PATH` or equivalent — verify from Claude Code docs).

### Success Criteria:

#### Automated Verification:

- `.claude/settings.json` is valid JSON with `hooks.PostToolUse` configured
- Hook script is executable and handles `.py`, `.ts`, `.tsx`, and other extensions

#### Manual Verification:

- Editing a `.py` file in Claude Code triggers ruff check + mypy output
- Editing a `.tsx` file triggers eslint output
- Editing a `.md` file produces no hook output (no-op)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Auto-Deploy on Merge

### Overview

Add a deploy job to the CI workflow that runs after quality gates pass on main, SSHs to Mikr.us to deploy, and runs post-deploy smoke tests.

### Changes Required:

#### 1. Add deploy job to CI workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Add a `deploy` job that runs only on pushes to `main`, after both `backend` and `frontend` jobs pass. Uses SSH to execute the deploy sequence on Mikr.us.

**Contract**: The `deploy` job:
- `needs: [backend, frontend]` — runs only after both pass
- `if: github.ref == 'refs/heads/main' && github.event_name == 'push'` — only on merge/push to main, not on PRs
- Uses `appleboy/ssh-action` or raw SSH with a configured key from `secrets.SSH_PRIVATE_KEY`
- SSH target: `root@${{ secrets.MIKRUS_SERVER }}` on port `${{ secrets.MIKRUS_SSH_PORT }}`
- Runs the same sequence as `deploy.sh`: tag current image `:prev`, `git pull`, `docker compose build`, `docker compose up -d`
- Waits for health check (polls `/health` endpoint)

#### 2. Add smoke test step post-deploy

**File**: `.github/workflows/ci.yml` (same deploy job, additional step)

**Intent**: After deploy succeeds and health check passes, run smoke tests against the live instance to verify the deployed app works.

**Contract**: Step runs `uv run pytest -m smoke -v` with `MEVO_SMOKE_BASE_URL` set to the production URL (e.g., `https://dailymevo.pl` or `https://srv66-20312.wykr.es`). This uses the existing `tests/test_smoke.py` which is already built and uses `httpx.AsyncClient` against a configurable base URL.

#### 3. Document required GitHub Secrets

**File**: `context/changes/testing-quality-gates/SECRETS.md` (reference doc, not committed to main — lives in context/)

**Intent**: Document which GitHub repository secrets need to be configured for CI deploy to work.

**Contract**: List of required secrets:
- `SSH_PRIVATE_KEY` — dedicated CI SSH key (ed25519), public key added to Mikr.us `~/.ssh/authorized_keys`
- `MIKRUS_SERVER` — e.g., `srv66.mikr.us`
- `MIKRUS_SSH_PORT` — e.g., `10312`
- `SMOKE_BASE_URL` — e.g., `https://dailymevo.pl`

### Success Criteria:

#### Automated Verification:

- Workflow file is valid YAML with deploy job correctly gated by `if` condition and `needs`
- Deploy job does not run on PR events (only push to main)
- Smoke test step references `MEVO_SMOKE_BASE_URL` env var

#### Manual Verification:

- Configure GitHub Secrets (SSH key, server details)
- Merge a change to main → deploy job runs → health check passes → smoke tests pass
- Push to a non-main branch → deploy job is skipped, only quality gates run
- If deploy health check fails, the job reports failure (does not silently pass)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Docs Cleanup & Test Plan Update

### Overview

Fix stale Fly.io references, update the test plan cookbook (§6.5), and update RUNNING_TESTS.md with CI-related test commands.

### Changes Required:

#### 1. Fix deployment target in CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Replace stale "Fly.io (placeholder, final decision pending)" with the actual deployment target.

**Contract**: Change `Deployment target: Fly.io (placeholder, final decision pending)` to `Deployment target: Mikr.us VPS (Docker Compose, SSH deploy)`.

#### 2. Fix deployment target in tech-stack-v2.md

**File**: `context/foundation/tech-stack-v2.md`

**Intent**: Update the deployment_target field to reflect reality.

**Contract**: Change `deployment_target: fly` to `deployment_target: mikrus`.

#### 3. Update test plan §6 Phase 5 cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in the Phase 5 cookbook entry (currently "TBD") with the actual CI workflow structure, pre-commit setup, and hook configuration.

**Contract**: Replace the TBD placeholder under "Phase 5 — Quality gates / CI pipeline (change opened)" in §6.6 with documentation of: GitHub Actions workflow structure (two parallel jobs: backend + frontend), service container config, pre-commit hook setup (ruff + related-tests), Claude Code hook config, and auto-deploy job gating.

#### 4. Update test plan §3 Phase 5 status

**File**: `context/foundation/test-plan.md`

**Intent**: Update Phase 5 row status from "change opened" to "planned" once plan is written.

**Contract**: In the §3 table, change Phase 5 status from `change opened` to `planned`.

#### 5. Update RUNNING_TESTS.md

**File**: `context/RUNNING_TESTS.md`

**Intent**: Add CI-related test commands so developers know how to run gates locally.

**Contract**: Add a section documenting: pre-commit commands (`uv run pre-commit run --all-files`, `uv run pre-commit install`), the full CI gate sequence for local verification, and smoke test commands.

### Success Criteria:

#### Automated Verification:

- `grep -r "Fly.io" CLAUDE.md` returns no results
- `grep "deployment_target: fly" context/foundation/tech-stack-v2.md` returns no results
- `grep "TBD" context/foundation/test-plan.md` shows only Phase 6 TBD (not Phase 5)

#### Manual Verification:

- CLAUDE.md deployment target reads "Mikr.us VPS"
- Test plan §6.6 Phase 5 entry is filled in with actual CI structure
- RUNNING_TESTS.md includes pre-commit and CI gate commands

**Implementation Note**: After completing this phase, the change is complete. Update `change.md` status to `implementing`.

---

## Testing Strategy

### Unit Tests:

- No new unit tests — this change is infrastructure/configuration

### Integration Tests:

- CI workflow is tested by pushing a branch and observing job results
- Pre-commit is tested by staging files with known issues and attempting to commit

### Manual Testing Steps:

1. Push a branch with all changes → verify CI runs both backend and frontend jobs
2. Introduce a deliberate ruff violation → verify CI fails
3. Stage a Python file and commit → verify pre-commit runs ruff + related tests
4. Edit a `.py` file in Claude Code → verify ruff + mypy hook fires
5. Merge to main → verify deploy job runs and smoke tests pass
6. Verify GitHub Actions UI shows clear job names and step structure

## Performance Considerations

- CI backend job includes Postgres service container startup (~10-15s)
- Pre-commit related-tests hook runs only matched tests, not the full suite
- Claude Code hooks use single-file checks to keep edit latency low (~200ms for ruff, ~1-3s for mypy single-file)
- Frontend tsc cannot be scoped to a single file — per-edit type checking for TypeScript is not included (full tsc runs in pre-commit and CI)

## Migration Notes

- Developers must run `uv run pre-commit install` once after this change lands
- GitHub repository secrets must be configured before auto-deploy works (SSH key, server details)
- No data migration or schema changes

## References

- Research: `context/changes/testing-quality-gates/research.md`
- Test plan: `context/foundation/test-plan.md` (§3 Phase 5, §5 Quality Gates)
- Roadmap: `context/foundation/roadmap.md` (F-03)
- Deploy script: `deploy.sh`
- Smoke tests: `tests/test_smoke.py`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: GitHub Actions CI Workflow

#### Automated

- [x] 1.1 Workflow file passes syntax validation — bfc7be0
- [x] 1.2 Push to test branch triggers both backend and frontend jobs — bfc7be0
- [x] 1.3 Backend job: ruff check, ruff format --check, mypy, pytest all pass — bfc7be0
- [x] 1.4 Frontend job: eslint, tsc, vitest, build all pass — bfc7be0
- [x] 1.5 Deliberate lint violation causes backend job to fail — bfc7be0

#### Manual

- [x] 1.6 GitHub Actions UI shows both jobs with clear step names — bfc7be0
- [x] 1.7 PR check status appears on pull requests — bfc7be0

### Phase 2: Pre-commit Hooks

#### Automated

- [x] 2.1 `uv sync` installs pre-commit — e587143
- [x] 2.2 `uv run pre-commit run --all-files` passes — e587143
- [x] 2.3 `scripts/run-related-tests.sh` is executable — e587143
- [x] 2.4 Staging a lint violation and committing triggers ruff and blocks commit — e587143

#### Manual

- [x] 2.5 Staging `app/aggregation.py` change runs `tests/test_aggregation.py` — e587143
- [x] 2.6 Staging only a `.md` file skips related-tests hook — e587143
- [x] 2.7 Integration tests skip gracefully without `MEVO_TEST_DATABASE_URL` — e587143

### Phase 3: Claude Code Per-Edit Hooks

#### Automated

- [x] 3.1 `.claude/settings.json` is valid JSON with `hooks.PostToolUse` configured
- [x] 3.2 Hook script handles `.py`, `.ts`, `.tsx`, and other extensions

#### Manual

- [x] 3.3 Editing a `.py` file triggers ruff + mypy output
- [x] 3.4 Editing a `.tsx` file triggers eslint output
- [x] 3.5 Editing a `.md` file produces no hook output

### Phase 4: Auto-Deploy on Merge

#### Automated

- [x] 4.1 Workflow YAML has deploy job gated by `if` condition and `needs` — 5837080
- [x] 4.2 Deploy job does not run on PR events — 5837080
- [x] 4.3 Smoke test step references `MEVO_SMOKE_BASE_URL` — 5837080

#### Manual

- [x] 4.4 Configure GitHub Secrets (SSH key, server details)
- [x] 4.5 Merge to main triggers deploy → health check → smoke tests pass
- [x] 4.6 Push to non-main branch skips deploy job — 5837080
- [x] 4.7 Failed health check reports job failure — 5837080

### Phase 5: Docs Cleanup & Test Plan Update

#### Automated

- [x] 5.1 No "Fly.io" references in CLAUDE.md
- [x] 5.2 No `deployment_target: fly` in tech-stack-v2.md
- [x] 5.3 Phase 5 TBD replaced in test-plan.md (only Phase 6 TBD remains)

#### Manual

- [x] 5.4 CLAUDE.md deployment target reads "Mikr.us VPS"
- [x] 5.5 Test plan §6.6 Phase 5 entry filled in
- [x] 5.6 RUNNING_TESTS.md includes pre-commit and CI commands
