# Test Plan Refresh Implementation Plan

## Overview

Refresh `context/foundation/test-plan.md` to incorporate production burns (auth session failures, DB storage exhaustion), the CI pipeline gap, and risk re-ranking discovered after test plan phases 1-3 shipped. The deliverable is an updated test-plan.md document with corrected risk map, restructured rollout phases, updated stack/gates sections, and cookbook stubs for new phases.

## Current State Analysis

The test plan was last updated 2026-06-16. Phases 1-3 are complete (1568 LOC backend tests, 710 LOC frontend tests). Since then:

- **Production burned three times on auth** (PgBouncer `statement_cache_size`, missing `users` table, cookie domain mismatch) — Risk #4 was Medium/Medium, should have been High/High
- **DB storage hit Supabase 0.5GB limit** (issue #25) — no risk existed for this, no retention code exists
- **Zero CI automation** — no GitHub Actions, no pre-commit hooks, no branch protection
- **Test-to-production gap** — all tests run in-process (ASGI transport) against local Postgres; production runs behind PgBouncer with HTTPS, real cookies, CORS enforcement

### Key Discoveries:

- Risk #4 scope was too narrow — the failure class is deployment parity, not just auth
- Risk #5 (frontend breaks) likelihood should decrease — 710 LOC of component tests now exist
- Risk #8 (DB storage exhaustion) needs adding — already triggered in production
- Phase 4 (quality gates) needs expansion into a comprehensive CI pipeline, not just config
- A new Phase 5 (deployment parity) and Phase 6 (DB storage retention) are needed
- §4 Stack and §5 Quality Gates sections contain stale information

## Desired End State

`test-plan.md` accurately reflects the project's risk landscape, includes three new rollout phases (prioritizing the active DB storage issue), has updated stack versions and quality gate definitions, and provides cookbook stubs for future phases. A reader of the updated plan can understand what risks remain unmitigated, what the next phase delivers, and how CI/deploy verification will work.

## What We're NOT Doing

- Writing test code — that's `/10x-implement`'s job
- Configuring CI/CD or hooks — that's Phase 5's implementation
- Implementing the retention policy — that's Phase 4 (B-02)
- Changing the strategy section (§1) — principles are sound
- Rewriting phase notes for completed phases (§6.6) — they're accurate

## Implementation Approach

Edit test-plan.md in four focused passes, each touching a different section group. This avoids large conflicting edits and makes review easier. The phases are ordered by section dependency: risk map first (other sections reference it), then rollout table (references risks), then stack/gates (references phases), then cookbook/freshness (references everything).

## Phase 1: Risk Map Update (§2)

### Overview

Update the risk table and risk response guidance to reflect production evidence from phases 1-3.

### Changes Required:

#### 1. Risk #4 — Broaden and re-rank

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the current auth-focused Risk #4 with a broader deployment parity risk, re-ranked to High/High. The three production auth failures (PgBouncer, missing table, cookie domain) prove both higher impact and higher likelihood than originally assessed. The failure class is "deploy-time configuration diverges from local," not just "auth breaks."

**Contract**: Risk table row #4 changes:
- Risk text: "Deploy-time configuration or migration state diverges from local — auth, DB connections, or CORS fail silently in production"
- Impact: High (was Medium)
- Likelihood: High (was Medium)
- Source: updated to cite all three production incidents + research findings

Risk response guidance row #4 changes:
- "What would prove protection": assertions that production-like env config (cookie domain, CORS origins, PgBouncer, Secure flag) produces correct behavior
- "Must challenge": "If /health returns 200, production is healthy" — health endpoint doesn't check auth, CORS, or cookie config
- "Likely cheapest layer": smoke test against deployed instance + env-specific integration tests

#### 2. Risk #5 — Drop likelihood

**File**: `context/foundation/test-plan.md`

**Intent**: Reduce Risk #5 likelihood from High to Medium. Phase 3 landed 710 LOC of component tests covering all 7 UI components and 4 pages, partially mitigating the "frontend silently breaks" scenario. The risk remains because tests are component-level only (no E2E browser tests).

**Contract**: Risk table row #5 — Likelihood changes from "High" to "Medium". Source column adds: "Phase 3 mitigated with component tests (710 LOC); residual risk is cross-component/E2E flows."

#### 3. Risk #8 — Add DB storage exhaustion

**File**: `context/foundation/test-plan.md`

**Intent**: Add a new Risk #8 for unbounded snapshot growth exhausting DB storage, ranked High/High. This already triggered in production (issue #25) and no retention/purge code exists anywhere in the codebase.

**Contract**: New risk table row #8 with:
- Risk: "Unbounded snapshot growth exhausts DB storage — Supabase pauses the database, entire app goes down"
- Impact: High
- Likelihood: High
- Source: "Issue #25 (already triggered); issue #11 (retention policy, open); no purge code in `app/`"

New risk response guidance row #8 with:
- "What would prove protection": a test that seeds old snapshots, runs a cleanup/retention function, and verifies rows beyond the retention window are deleted while recent data is preserved
- "Must challenge": "Supabase has enough storage" — the free plan has a hard 500MB limit
- "Context /10x-research must ground": current table sizes, growth rate, which table/index consumes most space, whether Supabase counts WAL/catalogs toward the limit
- "Likely cheapest layer": integration test (seed + purge + assert)
- "Anti-pattern": testing that a cron job is scheduled rather than that data is actually deleted

### Success Criteria:

#### Automated Verification:

- Risk table has 8 rows with correct rankings
- Risk response guidance has 8 matching rows
- No markdown formatting errors in the table

#### Manual Verification:

- Risk #4 text accurately reflects the three production incidents
- Risk #8 source citations match actual issues (#25, #11)
- Risk #5 likelihood change is justified by Phase 3 coverage

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Phased Rollout Restructure (§3)

### Overview

Rewrite §3 to add three new phases prioritized by urgency: DB storage retention first (active production issue), then CI pipeline, then deployment parity.

### Changes Required:

#### 1. Update completed phase statuses

**File**: `context/foundation/test-plan.md`

**Intent**: Ensure phases 1-3 show accurate completion dates and change folder paths in the rollout table.

**Contract**: Phase 1 status = `complete`, Phase 2 status = `complete`, Phase 3 status = `complete`. Change folder paths match actual archive paths.

#### 2. Replace Phase 4 row and add Phases 5-6

**File**: `context/foundation/test-plan.md`

**Intent**: Restructure the rollout to prioritize the active DB storage issue (new Phase 4), then comprehensive CI (Phase 5), then deployment parity (Phase 6). The old Phase 4 (quality gates) becomes Phase 5 with expanded scope.

**Contract**: §3 table becomes:

| # | Phase name | Goal | Risks covered | Test types | Status | Change folder |
|---|-----------|------|---------------|-----------|--------|--------------|
| 4 | DB storage retention | Research retention policies, implement chosen solution, prove snapshots are purged and recent data preserved | #8 | Integration test (seed + purge + assert) | not started | context/changes/db-storage-retention/ |
| 5 | Quality gates — comprehensive CI pipeline | Lock lint + typecheck + full test suite in CI on every push; add pre-commit hooks | cross-cutting | GitHub Actions workflow, pre-commit hooks | change opened | context/changes/testing-quality-gates/ |
| 6 | Deployment parity testing | Prove deployed artifact works — Docker build, cookie/CORS under prod env, smoke tests, frontend-backend contract | #4, #8 (deploy verification) | Docker image test, env-specific integration, smoke test wiring, API contract tests | not started | -- |

Phase 4 note: "Tied to B-02 (db-storage-fix). Includes a mandatory research phase to evaluate retention policies before implementation. Do not start implementation without completing research."

Phase 5 note: "Comprehensive — may be sub-phased during planning. Includes GitHub Actions with Postgres 16 service container for integration tests, pre-commit hooks (ruff), and all quality gates from §5."

Phase 6 note: "Covers all 5 production-vs-local gaps from the 2026-06-18 research (cookie domain, CORS origins, PgBouncer parity, health-only deploy check, secure cookies). Includes frontend-backend API contract tests."

### Success Criteria:

#### Automated Verification:

- §3 table has 6 rows (phases 1-6)
- Phases 1-3 marked complete with correct change folders
- Phase 5 change folder matches existing `context/changes/testing-quality-gates/`

#### Manual Verification:

- Phase ordering reflects agreed priority (DB storage first)
- Phase 4 description includes research requirement
- Phase 5 scope is comprehensive (not just "CI config")
- Phase 6 covers all 5 production gaps from research

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Stack & Quality Gates Update (§4, §5)

### Overview

Update §4 with actual tool versions from the codebase and add smoke test runner. Update §5 with specific CI gate definitions and enforcement points.

### Changes Required:

#### 1. Update §4 Stack — Classic layer

**File**: `context/foundation/test-plan.md`

**Intent**: Replace placeholder/stale version info with actual installed versions from pyproject.toml and package.json. Add smoke test runner entry.

**Contract**: Classic layer table updates:
- pytest: `>=8.0` (confirmed in pyproject.toml)
- pytest-asyncio: `>=0.26` (confirmed)
- Vitest: `^4.1.9` (from package.json) — version field updated from "none yet"
- testing-library/react: `^16.3.2` (from package.json) — version field updated from "none yet"
- jsdom: `^29.1.1` (from package.json)
- Notes for frontend row updated to "Installed — see Phase 3 notes"
- Playwright row: keep as "none yet — evaluate during Phase 6" (was Phase 3)
- New row: Smoke tests | httpx (direct HTTP client) | `>=0.28` | Runs against live server; markers: `smoke`

Test-base profile updated: "growing — pytest configured, 11 backend test files (1568 LOC) in `tests/`, 11 frontend test files (710 LOC) co-located in `frontend/src/`. Covers aggregation math, collector pipeline, GBFS contract, station API, geocode, auth endpoints, and all critical UI components. No CI automation, no E2E browser tests, no deployment verification."

#### 2. Update §5 Quality Gates

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the current gates table with specific CI step definitions, enforcement points, and phase references. Gates should map to actual `npm`/`uv run` commands.

**Contract**: Updated quality gates table:

| Gate | Command | Where | Required? | Catches |
|------|---------|-------|-----------|---------|
| Lint — backend (ruff check) | `uv run ruff check .` | local + CI | required | Style violations, import errors, unused variables |
| Format — backend (ruff format) | `uv run ruff format --check .` | local + CI | required | Inconsistent formatting |
| Type check — backend (mypy) | `uv run mypy .` | local + CI | required | Type drift, missing annotations |
| Lint — frontend (eslint) | `cd frontend && npm run lint` | local + CI | required | JS/TS lint violations, React hook rules |
| Type check — frontend (tsc) | `cd frontend && npm run typecheck` | local + CI | required | TypeScript type errors |
| Unit + integration — backend (pytest) | `uv run pytest` | local + CI (with Postgres service) | required after §3 Phase 1 | Logic regressions in aggregation, collector, API, auth |
| Frontend component tests (Vitest) | `cd frontend && npm test` | local + CI | required after §3 Phase 3 | UI rendering regressions |
| Frontend build | `cd frontend && npm run build` | CI | required after §3 Phase 5 | Build failures, dead code |
| Pre-commit hooks (ruff check + format) | via pre-commit framework | local | required after §3 Phase 5 | Catches lint/format before commit |
| Post-deploy smoke tests | `uv run pytest -m smoke` | deploy pipeline | required after §3 Phase 6 | Production config, auth, API health |
| Post-edit hook (AI review) | Claude Code post-edit hook | local (agent loop) | recommended after §3 Phase 5 | Regressions at edit time |
| Visual diff (deterministic) | Playwright screenshot | CI on PR | optional after §3 Phase 6 | Heatmap rendering regressions |

### Success Criteria:

#### Automated Verification:

- §4 classic layer table has correct versions matching pyproject.toml and package.json
- §4 test-base profile reflects actual file counts
- §5 gates table includes commands column
- All phase references in §5 match §3 phase numbers

#### Manual Verification:

- Stack versions match what's actually installed
- Quality gates are achievable with current tooling
- Gate commands are copy-pasteable and correct

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Cookbook & Freshness Update (§6, §7, §8)

### Overview

Add cookbook entry for new endpoint tests, update §6.6 with TBD stubs for phases 4-6, review §7 negative space, and update §8 freshness dates.

### Changes Required:

#### 1. Update §6.6 per-rollout-phase notes

**File**: `context/foundation/test-plan.md`

**Intent**: Add TBD stubs for phases 4-6 so future implementers know these sections will be filled in as phases ship.

**Contract**: Add three new sub-sections under §6.6:

```
**Phase 4 — DB storage retention (not started)**
TBD — see §3 Phase 4. Will document retention policy research outcome, test fixtures, and purge verification pattern.

**Phase 5 — Quality gates / CI pipeline (change opened)**
TBD — see §3 Phase 5. Will document GitHub Actions workflow structure, service container config, pre-commit hook setup, and CI-specific test configuration.

**Phase 6 — Deployment parity (not started)**
TBD — see §3 Phase 6. Will document Docker build verification, env-specific test fixtures, smoke test wiring into deploy.sh, and frontend-backend contract test pattern.
```

#### 2. Review §7 negative space

**File**: `context/foundation/test-plan.md`

**Intent**: Verify that the "What We Deliberately Don't Test" section still reflects team consensus after phases 1-3. Add any new exclusions identified during the refresh.

**Contract**: Existing three exclusions remain valid (GBFS client parsing, Mevo API e2e mocking, config/env parsing). No new exclusions needed — the refresh is about expanding coverage, not reducing it.

#### 3. Update §8 freshness ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Update all freshness dates to reflect this refresh.

**Contract**:
- Strategy (S1-S5) last reviewed: 2026-06-18
- Risk map last updated: 2026-06-18
- Stack versions last verified: 2026-06-18
- AI-native tool references last verified: 2026-06-18 (no changes, still current)
- Last updated date in header: 2026-06-18

### Success Criteria:

#### Automated Verification:

- §6.6 has stubs for phases 4, 5, 6
- §8 dates are all 2026-06-18
- Header "Last updated" is 2026-06-18

#### Manual Verification:

- §7 exclusions still make sense after the refresh
- §6.6 TBD stubs reference correct phase numbers and change folders
- Overall document reads coherently top-to-bottom

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Automated:

- Markdown lint (no broken tables, consistent heading levels)
- Cross-reference check: all risk numbers in §3 exist in §2, all phase references in §5 exist in §3

### Manual:

- Read the full updated test-plan.md top-to-bottom for coherence
- Verify risk rankings match production evidence
- Verify phase ordering matches agreed priority
- Verify stack versions match installed packages
- Verify quality gate commands are correct

## References

- Research: `context/changes/test-plan-refresh-2026-06-18/research.md`
- Current test plan: `context/foundation/test-plan.md`
- PRD: `context/foundation/prd.md`
- Roadmap: `context/foundation/roadmap.md`
- GitHub issue #24 (auth session fix): B-01
- GitHub issue #25 (DB storage fix): B-02
- Existing Phase 4 change: `context/changes/testing-quality-gates/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk Map Update

#### Automated

- [x] 1.1 Risk table has 8 rows with correct rankings
- [x] 1.2 Risk response guidance has 8 matching rows
- [x] 1.3 No markdown formatting errors in tables

#### Manual

- [x] 1.4 Risk #4 text reflects three production incidents
- [x] 1.5 Risk #8 source citations match issues #25 and #11
- [x] 1.6 Risk #5 likelihood change justified by Phase 3 coverage

### Phase 2: Phased Rollout Restructure

#### Automated

- [x] 2.1 §3 table has 6 rows (phases 1-6)
- [x] 2.2 Phases 1-3 marked complete with correct change folders
- [x] 2.3 Phase 5 change folder matches existing testing-quality-gates

#### Manual

- [x] 2.4 Phase ordering reflects priority (DB storage first)
- [x] 2.5 Phase 4 description includes research requirement
- [x] 2.6 Phase 5 scope is comprehensive
- [x] 2.7 Phase 6 covers all 5 production gaps

### Phase 3: Stack & Quality Gates Update

#### Automated

- [x] 3.1 §4 versions match pyproject.toml and package.json
- [x] 3.2 §4 test-base profile reflects actual file counts
- [x] 3.3 §5 gates table includes commands column
- [x] 3.4 Phase references in §5 match §3 phase numbers

#### Manual

- [x] 3.5 Stack versions match installed packages
- [x] 3.6 Quality gates are achievable with current tooling
- [x] 3.7 Gate commands are copy-pasteable and correct

### Phase 4: Cookbook & Freshness Update

#### Automated

- [x] 4.1 §6.6 has stubs for phases 4, 5, 6
- [x] 4.2 §8 dates are all 2026-06-18
- [x] 4.3 Header "Last updated" is 2026-06-18

#### Manual

- [x] 4.4 §7 exclusions still valid after refresh
- [x] 4.5 §6.6 TBD stubs reference correct phase numbers
- [x] 4.6 Document reads coherently top-to-bottom
