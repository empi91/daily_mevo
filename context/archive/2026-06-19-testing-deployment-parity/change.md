---
change_id: testing-deployment-parity
title: Deployment parity testing — prove the deployed artifact works
status: archived
created: 2026-06-19
updated: 2026-06-19
archived_at: 2026-06-19T21:00:24Z
---

## Notes

Phase 6 of the test plan rollout. Goal: prove the deployed artifact works end-to-end — Docker build verification, cookie/CORS behavior under production env config, smoke test wiring into the deploy pipeline, and frontend-backend API contract tests. Covers risks #4 (deploy-time config divergence) and #8 (DB storage — deploy verification angle). See `context/foundation/test-plan.md` §3 Phase 6 and §2 Risk Response Guidance for #4 and #8.

## Context

### Why this phase exists

Three separate production failures all escaped the existing test suite because tests ran against localhost with default env config, not the actual production environment:

1. **PgBouncer statement_cache_size** — asyncpg prepared statements incompatible with Supabase PgBouncer transaction mode → 500 on all auth endpoints (fixed manually in commit `edf8495`)
2. **Missing users table** — Alembic recorded migration 005 as applied but the table didn't exist in production → auth broken on first deploy
3. **Cookie/session persistence** — `fastapiusersauth` cookie set on `dailymevo.pl` not stored or sent back by browser; likely `SameSite`/`Secure`/`Domain` misconfiguration, or CORS `Access-Control-Allow-Credentials` mismatch (issue #24, still open)

All three share the same root cause: the test suite uses `ASGITransport` (in-process) with localhost defaults; production uses HTTPS, a real domain, and PgBouncer. No test exercised the real transport stack.

### Open GitHub issues directly relevant to this phase

- **#24 [B-01]** (open) — Auth session not persisting on `dailymevo.pl`. Likely cookie domain/SameSite/Secure misconfiguration or CORS credentials mismatch. Smoke tests confirmed the 500 fix; manual browser testing revealed the session persistence failure. This phase's deployment-parity tests are the right place to catch this class of bug.

### Roadmap context

- **B-01 (auth-session-fix)** is `ready` in the roadmap — blocked on a fix, not on research. Phase 6 of this test plan is the quality gate that will verify a fix actually works in production-like conditions, not just in-process.
- **S-03 (favourites-dashboard)** is `proposed` and depends on working auth sessions — B-01 must be resolved before S-03 can ship.
- **F-03 (CI/CD pipeline)** is `done` and already includes smoke tests (`uv run pytest tests/test_smoke.py -v` via `MEVO_SMOKE_BASE_URL`) and a 90s health poll in the deploy job. This phase extends and validates that wiring.

### What the test plan says to verify (§2 Risk Response Guidance, Risk #4)

Must challenge: "If /health returns 200, production is healthy" — three separate production failures went undetected by /health.

Must verify:
- Cookie transport config (`cookie_domain`, `SameSite`, `Secure`) produces correct browser behavior on the production domain
- CORS `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials` match the production frontend origin
- asyncpg `statement_cache_size=0` is set for Supabase PgBouncer (already fixed; needs a regression test so it can't silently revert)
- Alembic migration state matches actual DB tables (migration-vs-schema gap caused the missing `users` table incident)
- Deploy pipeline health check scope extends beyond `/health` to cover auth + API + CORS

### Production environment facts (for research grounding)

- Domain: `dailymevo.pl` (HTTPS)
- Hosting: Mikr.us VPS via Docker Compose + SSH deploy (`deploy.sh`)
- DB: Supabase (PostgreSQL with PgBouncer in transaction mode)
- Auth: fastapi-users with JWT cookie (`fastapiusersauth`)
- Smoke base URL configured via `MEVO_SMOKE_BASE_URL` GitHub Secret
