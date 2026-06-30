# Test Plan Refresh — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-06-18/plan.md`
> Research: `context/changes/test-plan-refresh-2026-06-18/research.md`

## What & Why

Refresh `context/foundation/test-plan.md` after phases 1-3 revealed production burns (auth session failures x3, DB storage exhaustion) that the original risk map under-ranked or missed entirely. The CI pipeline gap (zero GitHub Actions, no pre-commit hooks) and a systematic test-to-production parity problem also need to be reflected in the plan before Phase 4 work begins.

## Starting Point

Test plan was written 2026-06-13, last updated 2026-06-16. Phases 1-3 complete: 1568 LOC backend tests (11 files) + 710 LOC frontend tests (11 files). Risk map has 7 risks, rollout table has 4 phases (3 complete, 1 not started). Production has broken in ways the test suite didn't catch — auth failures, DB storage limit, no CI automation.

## Desired End State

An updated test-plan.md where: the risk map reflects real production evidence (8 risks, correctly ranked), the rollout table has 6 phases prioritized by urgency (DB storage fix first), the stack section shows actual tool versions, quality gates have executable commands, and cookbook stubs exist for all future phases.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| Risk #4 scope | Broaden to "deployment parity" (High/High) | Three distinct production failures prove the failure class is config divergence, not just auth | Research |
| Risk #5 likelihood | Drop from High to Medium | 710 LOC of component tests partially mitigate the frontend regression risk | Plan |
| Risk #8 | Add "DB storage exhaustion" (High/High) | Already triggered in production (issue #25), no retention code exists | Research |
| Phase priority | DB storage (P4) → CI pipeline (P5) → Deploy parity (P6) | DB storage is an active production issue, highest urgency | Plan |
| Risk #8 approach | Dedicated phase with research → implement → test, tied to B-02 | Retention policy needs evaluation before implementation, not a one-size-fits-all fix | Plan |
| CI test DB | GitHub Actions Postgres service container | Native GH Actions feature, matches local Docker setup | Plan |
| Deploy parity scope | Full: Docker build + smoke + env assertions + contract tests | Covers all 5 production-vs-local gaps from research | Plan |
| §4/§5 updates | Update now with known facts | Stack versions are observable facts, not design decisions | Plan |
| Phase notes style | Same detail level as phases 1-3 | CI/infra decisions are as important to document as test patterns | Plan |

## Scope

**In scope:**
- §2 Risk map: re-rank #4, drop #5 likelihood, add #8
- §3 Rollout: add phases 4 (DB storage), 5 (CI pipeline), 6 (deploy parity)
- §4 Stack: update tool versions, add smoke test runner, update test-base profile
- §5 Quality gates: add commands column, specific enforcement points
- §6.6 Cookbook: add TBD stubs for phases 4-6
- §7 Negative space: review, no changes needed
- §8 Freshness: update all dates to 2026-06-18

**Out of scope:**
- Writing test code (that's `/10x-implement`)
- Configuring CI/CD or hooks (that's Phase 5 implementation)
- Implementing retention policy (that's Phase 4 / B-02)
- Changing §1 strategy principles (still sound)
- Rewriting completed phase notes in §6.6

## Architecture / Approach

Four sequential editing passes through test-plan.md, ordered by section dependency: risk map first (other sections reference it), then rollout table (references risks), then stack/gates (references phases), then cookbook/freshness (references everything). Each pass is independently reviewable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|------------------|----------|
| 1. Risk map update | Corrected §2 with 8 risks, accurate rankings | Risk descriptions may not precisely match production incident details |
| 2. Rollout restructure | §3 with 6 phases, correct priority ordering | Phase numbering change could confuse references in other docs |
| 3. Stack & gates update | §4 with real versions, §5 with executable commands | Tool versions could drift before Phase 5 ships |
| 4. Cookbook & freshness | §6.6 stubs, §7 review, §8 dates | Minimal risk — informational updates |

**Prerequisites:** Research doc complete, all phases 1-3 complete, tool versions verified
**Estimated effort:** ~1 session, 4 passes through the document

## Open Risks & Assumptions

- Phase numbering in external references (change.md files, CLAUDE.md) may need updating if they reference "Phase 4 = quality gates"
- The `testing-quality-gates` change folder already exists as the old Phase 4; it becomes Phase 5 in the new numbering — its change.md title should be updated

## Success Criteria (Summary)

- A reader of the updated test-plan.md can identify all 8 risks and understand their production evidence
- The rollout table clearly shows DB storage as the next priority
- Quality gate commands are copy-pasteable and correct for the current tooling
