---
date: "2026-06-20T11:31:19Z"
researcher: Claude (10x-research)
git_commit: dfb18bdc691b520fa13b2421d7b2bcf0d62878fc
branch: main
repository: daily_mevo
topic: "Favourites dashboard — full-stack implementation research"
tags: [research, codebase, favourites, dashboard, auth, stations]
status: complete
last_updated: 2026-06-20
last_updated_by: Claude (10x-research)
---

# Research: Favourites Dashboard (S-03)

**Date**: 2026-06-20T11:31:19Z
**Researcher**: Claude (10x-research)
**Git Commit**: `dfb18bdc691b520fa13b2421d7b2bcf0d62878fc`
**Branch**: `main`
**Repository**: daily_mevo

## Research Question

Full-stack implementation-ready research for the favourites-dashboard feature (S-03): what exists, what patterns to follow, what to build.

## Summary

All prerequisites are done (S-01, S-02, B-01). No favourites code exists yet — entirely greenfield. The backend uses raw asyncpg SQL queries with FastAPI routers, cookie-based JWT auth via fastapi-users, and raw SQL Alembic migrations. The frontend uses React 19 + React Router + TanStack React Query + Tailwind CSS 4. The `PopularStations` card grid is the closest UI pattern to a favourites dashboard. The `current_active_user` auth dependency is pre-built and ready for protecting new endpoints.

## Detailed Findings

### 1. Database Schema (Current State)

Six migrations exist (`alembic/versions/001` through `006`), all using raw SQL `op.execute()`.

| Table | PK | Purpose |
|---|---|---|
| `stations` | `station_id TEXT` | Station metadata (name, address, lat, lon, capacity) |
| `snapshots` | `id BIGSERIAL` | Raw availability snapshots per station per timestamp |
| `station_availability` | `(station_id, day_of_week, time_slot)` | Aggregated avg availability per 15-min slot per day-of-week |
| `agg_watermark` | `id INTEGER (CHECK id=1)` | Singleton watermark for incremental aggregation |
| `users` | `id UUID` | Standard fastapi-users fields (email, hashed_password, is_active, is_superuser, is_verified) |
| `db_size_log` | `id SERIAL` | DB size monitoring records |

**No `favourites` table exists.** Migration `007` will be needed.

**Migration pattern**: file named `NNN_description.py`, revision chain is linear, raw SQL in `op.execute()` for both upgrade/downgrade.

### 2. API Endpoint Patterns

**Router registration** (`app/main.py:208-209`):
```python
app.include_router(api_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
```

**API router aggregation** (`app/api/__init__.py`):
```python
router.include_router(stations_router)
router.include_router(geocode_router)
```

**Current endpoints**:

| Method | Path | File |
|---|---|---|
| GET | `/api/v1/stations` | `app/api/stations.py:31` |
| GET | `/api/v1/stations/nearby` | `app/api/stations.py:42` |
| GET | `/api/v1/stations/{station_id}` | `app/api/stations.py:71` |
| GET | `/api/v1/geocode` | `app/api/geocode.py:17` |
| POST | `/api/v1/auth/cookie/login` | fastapi-users |
| POST | `/api/v1/auth/cookie/logout` | fastapi-users |
| POST | `/api/v1/auth/register` | fastapi-users |
| GET | `/api/v1/users/me` | fastapi-users |

**DB access pattern**: manual helper `_get_pool(request)` at top of each handler, then `async with pool.acquire() as conn:` + raw SQL with `$1`, `$2` params. No repository/service layer.

**Pydantic schemas**: all in `app/api/models.py` — `StationResponse`, `AvailabilitySlot`, `StationDetailResponse`, `NearbyStationResponse`, `GeocodeResponse`.

### 3. Auth System

**Config** (`app/auth/config.py`):
- Cookie-based JWT via `CookieTransport`, cookie name `fastapiusersauth`
- httponly=True, samesite=lax, secure in non-dev
- JWT lifetime: 30 days (2592000s)
- **Key export (line 40)**: `current_active_user = fastapi_users.current_user(active=True)`

**User model** (`app/auth/models.py`):
- `User` extends `SQLAlchemyBaseUserTableUUID` — UUID `id`, `email`, `hashed_password`, standard flags
- `__tablename__ = "users"`

**Two-pool architecture**:
- asyncpg pool (`app/db.py`) — all data queries (min=2, max=5)
- SQLAlchemy async engine (`app/auth/db.py`) — auth only (pool_size=3, max_overflow=2)

**Protecting endpoints**:
```python
from app.auth.config import current_active_user
from app.auth.models import User

@router.get("/favourites")
async def list_favourites(user: User = Depends(current_active_user)):
    # user.id is a UUID
```

### 4. Frontend Architecture

**Stack**: React 19 + react-router-dom 7 + @tanstack/react-query 5 + Tailwind CSS 4 + Vite 8.

**Routing** (`router.tsx`): `BrowserRouter` with nested `Routes` inside `<Layout />`. No auth-guarded routes exist yet.

| Path | Component |
|---|---|
| `/` | `HomePage` |
| `/stations/:stationId` | `StationDetailPage` |
| `/login` | `LoginPage` |
| `/register` | `RegisterPage` |

**Auth hook** (`hooks/useAuth.ts`):
- `useQuery(['auth', 'me'], fetchMe)` with `.catch(() => null)` on 401
- Returns: `user`, `isLoading`, `isAuthenticated`, `loginMutation`, `registerMutation`, `logoutMutation`
- Auth transport: httpOnly cookies, `credentials: 'include'` on all fetch calls

**API client** (`api/client.ts`):
- `apiFetch<T>(path)` — GET
- `apiPostJson<T>(path, body)` — POST JSON
- `apiPostForm(path, data)` — POST form-encoded
- `apiPost(path)` — POST no body
- **Missing**: `apiDelete` — needed for removing favourites

**Station data types** (`api/stations.ts`):
- `StationResponse`: `station_id`, `name`, `address`, `lat`, `lon`, `capacity`
- `AvailabilitySlot`: `day_of_week`, `time_slot`, `avg_bikes`, `avg_ebikes`, `sample_count`, `reliability_label`
- `StationDetailResponse`: station + `availability: AvailabilitySlot[]`

**UI pattern to follow** — `PopularStations.tsx`:
- Card grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`
- Each card is a `<Link to={/stations/${id}}>` with station name + address
- This is the closest model for the favourites dashboard

**Layout** (`Layout.tsx`): shows email + logout button when authenticated, login/register links when not. Navigation lives here.

**Test patterns**: Vitest + @testing-library/react + jsdom. Every component/page has tests. Helpers in `test/helpers.tsx` provide `renderWithProviders()`, `createMockAuthValue()`. API mocked via `vi.mock()`.

### 5. Backend Test Patterns

**Config** (`tests/conftest.py`):
- `db_pool` fixture (session-scoped): asyncpg pool against `MEVO_TEST_DATABASE_URL`, runs Alembic migrations
- `api_client` fixture (session-scoped): `httpx.AsyncClient` with `ASGITransport`
- `clean_tables` fixture (autouse): TRUNCATEs all tables between tests — **new `favourites` table must be added here**
- Integration marker: `pytestmark = [pytest.mark.asyncio(loop_scope="session"), pytest.mark.integration]`

**Auth test helpers** (`tests/test_auth.py`):
- `_register_and_login(client)` — registers user, logs in, returns cookie string
- `_cookie_header(cookie)` — wraps cookie into headers dict
- These should be extracted to conftest or imported for favourites tests

## Code References

- `app/main.py:208-209` — Router registration
- `app/api/__init__.py` — API router aggregation
- `app/api/stations.py:31-90` — Station endpoint patterns (list, nearby, detail)
- `app/api/models.py` — Pydantic response schemas
- `app/auth/config.py:40` — `current_active_user` dependency
- `app/auth/models.py` — User SQLAlchemy model
- `app/auth/db.py` — SQLAlchemy async engine for auth
- `app/db.py` — asyncpg pool creation
- `alembic/versions/` — Migration chain (001–006)
- `tests/conftest.py:128-161` — Test fixtures (db_pool, api_client, clean_tables)
- `tests/test_auth.py:16-32` — Auth test helpers
- `frontend/src/router.tsx` — Route definitions
- `frontend/src/hooks/useAuth.ts` — Auth state hook
- `frontend/src/api/client.ts` — API client (needs apiDelete)
- `frontend/src/api/stations.ts` — Station API functions and types
- `frontend/src/components/PopularStations.tsx` — Card grid pattern for dashboard
- `frontend/src/components/Layout.tsx` — Navigation header
- `frontend/src/test/helpers.tsx` — Test render helpers

## Architecture Insights

1. **Dual-pool decision**: The favourites table joins `users` (UUID FK) and `stations` (TEXT FK). Since it's a data query (not auth), it should use the **asyncpg pool**, consistent with all station/snapshot queries. The `user.id` from the auth dependency bridges the two pools.

2. **No service layer**: Queries go directly in route handlers. Favourites should follow this pattern — no new abstraction layer.

3. **Cookie auth, not Bearer**: All auth flows through httpOnly cookies with `credentials: 'include'`. No `Authorization` headers anywhere. Frontend favourites API calls just need `credentials: 'include'` (already default in `client.ts`).

4. **No auth-guarded routes in frontend**: The favourites dashboard will be the first auth-guarded route. Need a simple redirect-to-login wrapper.

5. **TanStack Query for mutations**: Login/register already use `useMutation`. Favourites add/remove should follow the same pattern with query invalidation.

## Historical Context (from prior changes)

- `context/archive/2026-06-11-user-auth/plan.md` — Auth explicitly exported `current_active_user` "for use in future protected endpoints (S-03)". Scope boundary: "Favourites or dashboard (that's S-03)" was excluded from S-02.
- `context/archive/2026-06-11-user-auth/research.md` — GDPR research mentions favourites in data model scope. Account deletion (Art. 17) must delete favourites. Data export (Art. 20) must include favourites. Legal basis: Art. 6(1)(b) contract performance.
- `context/archive/2026-06-19-auth-session-fix/` — Cookie domain is `None` (host-only), validated against parity contract. `cookie_secure` is ON with Cloudflare HTTPS redirect.
- `context/archive/2026-06-05-station-availability-page/plan.md` — Station detail page patterns (heatmap, day-part sections) that the dashboard quick-view should reference.

## PRD Requirements (US-02, FR-010–012)

- **US-02**: Dashboard is the default landing page after login. Each favourite card links to station detail. Remove button on dashboard card.
- **FR-010**: Add station to favourites (must-have).
- **FR-011**: Remove station from favourites (must-have).
- **FR-012**: Personal dashboard listing favourites (must-have).

## Implementation Boundaries

### In scope (S-03)
- `favourites` DB table + migration
- Backend API: list/add/remove favourites (3 endpoints)
- Frontend: favourites page with station card grid
- Frontend: favourite toggle on station detail page
- Auth-guarded route for `/favourites`
- Navigation link in header (authenticated only)
- Frontend + backend tests

### Likely out of scope (but flagged)
- **Dashboard as default landing after login** — PRD says yes (US-02 acceptance criteria). Scope decision for /10x-plan.
- **GDPR account deletion cascade** — required before launch but may be a separate change.
- **GDPR data export** — required before launch but may be a separate change.
- **Quick-view availability on cards** — PRD says "quick-view of current/recent availability". Scope decision: mini heatmap vs. simple text summary vs. deferred.

## GitHub Issue

**Issue #6**: `[S-03] Favourites and personal dashboard` — OPEN, labels: `slice`, `stream-a`. Comment from 2026-06-13: "Prerequisite S-02 (user-auth) is now done. S-03 is ready for /10x-plan."

## Open Questions

1. **Quick-view format**: Should each favourites card show a mini availability summary (e.g., "reliable at 8:00 on weekdays") or just station name + address + link? The PRD says "quick-view of current / recent availability" but doesn't specify format.
2. **Dashboard as default landing**: US-02 says "dashboard is the default landing page after login" — should authenticated users be redirected from `/` to `/favourites`, or should the homepage show favourites inline?
3. **GDPR scope**: Should account deletion cascade (delete favourites) and data export (include favourites) be part of S-03 or a follow-up change?
4. **Favourite toggle placement**: Should the "add to favourites" button appear on the station detail page, in search results, or both?
5. **Which pool for favourites queries**: asyncpg pool (consistent with data queries) vs. SQLAlchemy engine (consistent with user-related data). Research recommends asyncpg pool.
