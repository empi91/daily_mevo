<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: User Registration and Login

- **Plan**: context/changes/user-auth/plan.md
- **Scope**: Phase 1 of 3
- **Date**: 2026-06-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — JWT secret has a default value

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: app/config.py:17
- **Detail**: Plan says jwt_secret must be required with no default. Implementation added `jwt_secret: str = "change-me-in-production"`. App could silently start with a known insecure secret.
- **Fix**: Remove the default value so the field becomes required: `jwt_secret: str`.
- **Decision**: FIXED — removed default, added type: ignore on Settings() instantiation for mypy compatibility with pydantic-settings.

### F2 — SQLAlchemy engine never disposed on shutdown

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: app/auth/db.py:10-14, app/main.py (lifespan)
- **Detail**: SQLAlchemy async engine is a module-level global with no lifecycle management. Leaked connections accumulate on Mikr.us.
- **Fix A ⭐ Recommended**: Add engine.dispose() to lifespan shutdown.
- **Decision**: FIXED via Fix A — added `await auth_engine.dispose()` to lifespan shutdown.

### F3 — get_user_db type annotation uses int instead of UUID

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: app/auth/db.py:26
- **Detail**: Return type was `SQLAlchemyUserDatabase[User, int]` but User uses UUID. Official docs use no generic params.
- **Fix**: Drop generic type params from annotation.
- **Decision**: FIXED — changed to `SQLAlchemyUserDatabase` with no type args.

### F4 — Users router tagged ["users"] instead of ["auth"]

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: app/auth/__init__.py:20
- **Detail**: Plan says all routers tagged ["auth"]. Users router used ["users"].
- **Fix**: Change tags to ["auth"].
- **Decision**: FIXED.

### F5 — get_user_db placed in db.py instead of manager.py

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: app/auth/db.py:24-27
- **Detail**: Plan step 6 places get_user_db in manager.py. Implementation puts it in db.py (better design, avoids circular imports).
- **Decision**: SKIPPED — acceptable deviation.

### F6 — CORS origins not configurable via env

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: app/main.py:148
- **Detail**: CORS allow_origins hardcoded. Plan notes same-origin in production makes this a no-op.
- **Decision**: SKIPPED — acceptable per plan.
