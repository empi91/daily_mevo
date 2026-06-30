<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: User Registration and Login

- **Plan**: context/changes/user-auth/plan.md
- **Scope**: All Phases (1-3)
- **Date**: 2026-06-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Tests use real database and DROP tables on teardown

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/test_auth.py:17-24
- **Detail**: The setup_db fixture uses settings.database_url (from MEVO_DATABASE_URL) and runs Base.metadata.drop_all on teardown. If tests are ever run with a production .env, this will DROP the users table. Currently safe because this worktree uses mevo_test, but there's no guard.
- **Fix A ⭐ Recommended**: Add an environment guard — refuse to run if environment != "development". Prevents accidental production data loss with zero overhead.
  - Strength: One-line check, no architectural change.
  - Tradeoff: Still uses the real dev DB — not fully isolated.
  - Confidence: HIGH — simple guard.
  - Blind spot: None significant.
- **Fix B**: Use a dedicated MEVO_TEST_DATABASE_URL for full isolation.
  - Strength: Test DB is always separate from dev/prod.
  - Tradeoff: Extra env var, second database, more setup for contributors.
  - Confidence: MEDIUM — better long-term but heavier for MVP.
  - Blind spot: CI pipeline would need provisioning.
- **Decision**: FIXED

### F2 — Auth engine created with potentially None database URL

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: app/auth/db.py:11
- **Detail**: settings.database_url is typed str | None. The auth engine does `settings.database_url or ""`, creating an engine with an empty DSN. The existing asyncpg pool guards with `if settings.database_url`.
- **Fix**: Make database_url required (remove | None) in Settings.
- **Decision**: FIXED

### F3 — Register-then-login error not displayed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: frontend/src/pages/RegisterPage.tsx:21-30
- **Detail**: After successful registration, loginMutation.mutate() is called immediately. If login fails, the user sees no error — errorMessage only displays registerMutation errors.
- **Fix**: Include loginMutation.error in the errorMessage derivation.
- **Decision**: FIXED

### F4 — CORS origins hardcoded to localhost

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: app/main.py:151
- **Detail**: allow_origins=["http://localhost:5173"] will need updating for production. Consider making configurable via Settings (MEVO_CORS_ORIGINS).
- **Decision**: FIXED

### F5 — Redundant index on users.email

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Performance
- **Location**: alembic/versions/004_create_users.py:29
- **Detail**: UNIQUE constraint already creates an index. The explicit CREATE INDEX is redundant, wastes disk and slows writes.
- **Decision**: FIXED

### F6 — Test ordering dependency

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Reliability
- **Location**: tests/test_auth.py:34-51
- **Detail**: test_register_duplicate_email depends on test_register_new_user running first. Fragile if test-randomization plugins are added.
- **Decision**: FIXED
