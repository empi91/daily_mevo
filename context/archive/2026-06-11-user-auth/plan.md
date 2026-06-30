# User Registration and Login — Implementation Plan

## Overview

Add user authentication to MevoStats — registration with email/password, login, and logout — using fastapi-users with SQLAlchemy async backend and httpOnly cookie-based JWT transport. This is the auth foundation that S-03 (favourites/dashboard) will build on. The frontend gets Login and Register pages plus header auth controls, with auth state managed via React Query and a `/users/me` endpoint.

## Current State Analysis

**Backend**: FastAPI app with raw asyncpg for all database access. No auth infrastructure — no user tables, no JWT handling, no auth middleware. SQLAlchemy exists only as a transitive dependency via Alembic. Configuration has unused `supabase_url`/`supabase_anon_key` fields.

**Frontend**: React 19 + React Router + React Query + Tailwind. Two routes (`/`, `/stations/:stationId`). API client (`frontend/src/api/client.ts`) supports only GET requests with no auth headers. Layout header has site title and tagline — no user controls.

**Database**: Three tables (stations, snapshots, station_availability) managed via Alembic raw SQL migrations. No users table.

### Key Discoveries:

- fastapi-users requires SQLAlchemy ORM models — introduces a second data-access pattern alongside raw asyncpg (`app/db.py:6-7`)
- Two connection pools needed: existing asyncpg pool for data operations, new SQLAlchemy async engine for auth. Auth traffic is low — small pool (3 connections) is sufficient
- fastapi-users provides register, login, logout, /me endpoints out of the box — minimal custom code
- Cookie transport with httpOnly + SameSite=Lax handles both XSS and CSRF protection
- No CORS middleware exists yet (`app/main.py:138-145`) — needed for dev (Vite port 5173 → backend port 8000)
- Login endpoint expects form data (`username` + `password`), not JSON — frontend must use `application/x-www-form-urlencoded`
- Frontend `apiFetch()` (`frontend/src/api/client.ts:1-9`) only does GET — needs POST support and `credentials: 'include'` for cookies

## Desired End State

A visitor can register with email and password, log in, and log out. The frontend shows the user's auth state in the header (email + logout button when logged in, login/register links when not). Auth state persists across page refreshes via an httpOnly cookie with 30-day TTL. All existing station browsing functionality remains public and unchanged.

Verification: register a new user, log in, refresh the page (cookie persists), log out, confirm header updates. Existing station pages load without auth. `uv run ruff check .`, `uv run mypy .`, `uv run pytest` all pass.

## What We're NOT Doing

- Email verification flow (no `is_verified` enforcement)
- Password reset / forgot password
- Rate limiting on auth endpoints
- Admin/superuser functionality
- Favourites or dashboard (that's S-03)
- Migrating existing data operations from raw asyncpg to SQLAlchemy
- OAuth / social login
- User profile editing beyond what fastapi-users /me provides

## Implementation Approach

**Phase 1 (backend)**: Add fastapi-users with SQLAlchemy async. Create a users table migration. Configure cookie transport + JWT strategy with 30-day TTL. Wire auth and users routers into the FastAPI app. Add CORS middleware. The SQLAlchemy async engine runs its own small connection pool alongside the existing asyncpg pool.

**Phase 2 (frontend)**: Extend the API client to support POST and cookie credentials. Add a `useAuth` hook backed by React Query fetching `/users/me`. Build Login and Register page components with forms. Add auth state display and controls to the Layout header. Wire new routes in the router.

**Phase 3 (testing)**: Add endpoint tests for the auth flow using FastAPI TestClient — register, login, /me, logout.

## Critical Implementation Details

**Two connection pools**: The SQLAlchemy async engine (`postgresql+asyncpg://`) creates its own connection pool. It cannot share the existing `asyncpg.Pool` from `app/db.py`. Configure it with `pool_size=3, max_overflow=2` to stay within the 768MB Mikr.us memory budget. Both pools connect to the same database.

**Login form encoding**: fastapi-users login endpoint expects `application/x-www-form-urlencoded` with fields `username` (which is the email) and `password` — not JSON. The frontend must use `FormData` or URL-encoded body for the login request specifically.

**Cookie secure flag**: Set `cookie_secure=False` for local development (HTTP), `True` for production (HTTPS). Use the existing `settings.environment` to switch.

---

## Phase 1: Backend Auth Setup

### Overview

Add fastapi-users with all supporting infrastructure: dependencies, SQLAlchemy engine, User model, migration, auth configuration, routers, and CORS middleware.

### Changes Required:

#### 1. Add dependencies

**File**: `pyproject.toml`

**Intent**: Add fastapi-users with SQLAlchemy backend and async SQLAlchemy support.

**Contract**: Add `fastapi-users[sqlalchemy]>=14.0` and `sqlalchemy[asyncio]>=2.0` to the `[project.dependencies]` array. Run `uv sync` after.

#### 2. Add auth configuration settings

**File**: `app/config.py`

**Intent**: Add JWT secret and token lifetime settings so they're configurable via environment variables, following the existing `pydantic-settings` pattern.

**Contract**: Add fields to the `Settings` class: `jwt_secret: str` (required, no default — must be set in `.env`), `jwt_lifetime_seconds: int = 2592000` (30 days). Update `.env.example` with a placeholder `MEVO_JWT_SECRET=change-me-in-production`.

#### 3. Create SQLAlchemy async engine module

**File**: `app/auth/db.py` (new)

**Intent**: Set up the SQLAlchemy async engine and session factory for fastapi-users, separate from the raw asyncpg pool used by data operations.

**Contract**: Exports `engine` (AsyncEngine), `async_session_maker` (async_sessionmaker), and `get_async_session` (FastAPI dependency yielding AsyncSession). Uses `settings.database_url` with the `postgresql+asyncpg://` scheme. Engine configured with `pool_size=3, max_overflow=2, expire_on_commit=False` on the session maker.

#### 4. Define User model

**File**: `app/auth/models.py` (new)

**Intent**: Define the SQLAlchemy User model that fastapi-users requires, and the Pydantic schemas for request/response serialization.

**Contract**: 
- `Base(DeclarativeBase)` — shared base for all SQLAlchemy models
- `User(SQLAlchemyBaseUserTableUUID, Base)` — inherits id (UUID), email, hashed_password, is_active, is_superuser, is_verified columns. Table name: `users`
- `UserRead(schemas.BaseUser[uuid.UUID])` — response schema
- `UserCreate(schemas.BaseUserCreate)` — registration request schema
- `UserUpdate(schemas.BaseUserUpdate)` — update request schema

#### 5. Create users table migration

**File**: `alembic/versions/004_create_users.py` (new, or 005 if data-pipeline-performance migration lands first)

**Intent**: Create the `users` table matching the SQLAlchemy model definition.

**Contract**: Revision chain continues from the latest existing migration. Table `users` with columns: `id` UUID PRIMARY KEY DEFAULT gen_random_uuid(), `email` VARCHAR(320) NOT NULL UNIQUE, `hashed_password` VARCHAR(1024) NOT NULL, `is_active` BOOLEAN NOT NULL DEFAULT TRUE, `is_superuser` BOOLEAN NOT NULL DEFAULT FALSE, `is_verified` BOOLEAN NOT NULL DEFAULT FALSE. Index on `email`. Use raw SQL via `op.execute()` to match existing migration style.

#### 6. Create UserManager

**File**: `app/auth/manager.py` (new)

**Intent**: Configure password validation and user lifecycle hooks. This is where fastapi-users customization lives.

**Contract**: `UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID])` with:
- `validate_password` enforcing minimum 8 characters
- `on_after_register` logging the event via structlog (matches existing observability pattern)
- `get_user_manager` FastAPI dependency yielding UserManager
- `get_user_db` FastAPI dependency yielding `SQLAlchemyUserDatabase(session, User)`

#### 7. Configure auth backend and FastAPIUsers instance

**File**: `app/auth/config.py` (new)

**Intent**: Wire together cookie transport, JWT strategy, and the FastAPIUsers instance that produces the routers and dependencies.

**Contract**: 
- `CookieTransport` with `cookie_max_age=settings.jwt_lifetime_seconds`, `cookie_httponly=True`, `cookie_samesite="lax"`, `cookie_secure` based on `settings.environment != "development"`
- `JWTStrategy` with `secret=settings.jwt_secret`, `lifetime_seconds=settings.jwt_lifetime_seconds`
- `AuthenticationBackend(name="cookie", transport=cookie_transport, get_strategy=get_jwt_strategy)`
- `fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])`
- Export `current_active_user` dependency for use in future protected endpoints (S-03)

#### 8. Create auth router module

**File**: `app/auth/__init__.py` (new)

**Intent**: Export an APIRouter that bundles all fastapi-users sub-routers for clean inclusion in main.py.

**Contract**: Single `auth_router` (APIRouter) that includes:
- `fastapi_users.get_auth_router(auth_backend)` at prefix `/auth/cookie` (login + logout)
- `fastapi_users.get_register_router(UserRead, UserCreate)` at prefix `/auth` (register)
- `fastapi_users.get_users_router(UserRead, UserUpdate)` at prefix `/users` (/me + user management)
- All tagged `["auth"]`

#### 9. Wire auth into the FastAPI app

**File**: `app/main.py`

**Intent**: Include the auth router in the app and add CORS middleware for development.

**Contract**: 
- `app.include_router(auth_router, prefix="/api/v1")` — auth endpoints live under `/api/v1/auth/*` and `/api/v1/users/*`
- Add `CORSMiddleware` with `allow_origins=["http://localhost:5173"]` (Vite dev server), `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`. In production (same-origin serving via SPA fallback), CORS is a no-op but harmless to leave.
- Import and register `auth_router` from `app.auth`

#### 10. Update .env.example

**File**: `.env.example`

**Intent**: Document the new JWT_SECRET environment variable.

**Contract**: Add `MEVO_JWT_SECRET=change-me-in-production` with a comment explaining it must be a strong random string in production.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `uv run alembic upgrade head`
- Linting passes: `uv run ruff check .`
- Type checking passes: `uv run mypy .`
- Existing tests pass: `uv run pytest`
- Dependencies install cleanly: `uv sync`

#### Manual Verification:

- `POST /api/v1/auth/register` with `{"email": "test@example.com", "password": "testtest"}` returns 201 with user data
- `POST /api/v1/auth/cookie/login` with form data `username=test@example.com&password=testtest` returns 200 and sets httpOnly cookie
- `GET /api/v1/users/me` with the cookie returns the user object
- `POST /api/v1/auth/cookie/logout` clears the cookie
- `GET /api/v1/users/me` without cookie returns 401
- Existing station endpoints still work without auth
- Duplicate email registration returns explicit error message

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Frontend Auth UI

### Overview

Add auth support to the frontend: extend the API client, add auth hooks, build Login and Register pages, and add auth controls to the site header.

### Changes Required:

#### 1. Extend API client

**File**: `frontend/src/api/client.ts`

**Intent**: Add support for POST requests, form-encoded bodies, and cookie credentials so the frontend can call auth endpoints.

**Contract**: 
- All `fetch` calls include `credentials: 'include'` to send/receive cookies
- New exported function for POST JSON (register)
- New exported function for POST form-encoded (login — fastapi-users expects `application/x-www-form-urlencoded`)
- Existing `apiFetch` (GET) also gains `credentials: 'include'`

#### 2. Add auth API functions

**File**: `frontend/src/api/auth.ts` (new)

**Intent**: Type-safe functions for register, login, logout, and fetching current user.

**Contract**: Exports:
- `register(email: string, password: string)` → POST `/api/v1/auth/register` (JSON body)
- `login(email: string, password: string)` → POST `/api/v1/auth/cookie/login` (form-encoded: `username` field = email)
- `logout()` → POST `/api/v1/auth/cookie/logout`
- `fetchCurrentUser()` → GET `/api/v1/users/me`
- TypeScript interface `User` with fields: `id`, `email`, `is_active`, `is_superuser`, `is_verified`

#### 3. Add useAuth hook

**File**: `frontend/src/hooks/useAuth.ts` (new)

**Intent**: React Query-based hook that manages auth state. Components call this to get current user, login, register, and logout functions.

**Contract**: Exports `useAuth()` returning:
- `user: User | null` — current user from React Query cache (fetched via `/users/me`)
- `isLoading: boolean` — true during initial /me fetch
- `isAuthenticated: boolean` — derived from user !== null
- `loginMutation` — React Query mutation wrapping the login API call, invalidates the /me query on success
- `registerMutation` — React Query mutation wrapping register, invalidates /me on success
- `logoutMutation` — React Query mutation wrapping logout, invalidates /me on success

The /me query uses `retry: false` so a 401 doesn't trigger retries — it just means "not logged in".

#### 4. Build Login page

**File**: `frontend/src/pages/LoginPage.tsx` (new)

**Intent**: Email + password login form with error display and redirect to home on success.

**Contract**: Form with email and password fields, submit button, error message area. Uses `useAuth().loginMutation`. On success, navigates to `/` (or to the page the user came from, if tracked). Link to `/register` for new users. Follows existing Tailwind styling patterns from other pages.

#### 5. Build Register page

**File**: `frontend/src/pages/RegisterPage.tsx` (new)

**Intent**: Email + password registration form with validation feedback and redirect on success.

**Contract**: Form with email and password fields (minimum 8 chars client-side validation), submit button, error message area. Uses `useAuth().registerMutation`. On success, automatically logs in (or navigates to `/login` with a success message). Link to `/login` for existing users. Follows existing Tailwind styling patterns.

#### 6. Add auth controls to header

**File**: `frontend/src/components/Layout.tsx`

**Intent**: Show login/register links when logged out, user email + logout button when logged in.

**Contract**: Uses `useAuth()` hook. When `isAuthenticated`: display user email and a logout button. When not authenticated: display "Zaloguj się" (login) and "Zarejestruj się" (register) links pointing to `/login` and `/register`. Positioned in the header alongside existing title/tagline. Use Polish labels consistent with `frontend/src/polish.ts`.

#### 7. Add routes

**File**: `frontend/src/router.tsx`

**Intent**: Add `/login` and `/register` routes to the React Router configuration.

**Contract**: Two new routes inside the Layout wrapper: `/login` → LoginPage, `/register` → RegisterPage. No auth guards — logged-in users visiting these pages can be gently redirected to `/` or simply shown the form (redirect is preferred but not required).

### Success Criteria:

#### Automated Verification:

- Frontend builds without errors: `cd frontend && npm run build`
- TypeScript compiles: `cd frontend && npx tsc --noEmit`
- Linting passes: `cd frontend && npx eslint .` (if configured)

#### Manual Verification:

- Navigate to `/register`, create a new account — form submits, redirects to home, header shows user email
- Navigate to `/login`, log in with existing account — cookie set, header updates
- Refresh the page — still logged in (cookie persists)
- Click logout — cookie cleared, header shows login/register links
- Enter wrong password on login — error message displayed
- Enter duplicate email on register — "email already registered" error displayed
- Enter password under 8 chars — validation error displayed
- Visit `/stations/{id}` without logging in — still works (public)
- Dev server (Vite) correctly proxies or CORS-handles requests to backend

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Endpoint Tests

### Overview

Add automated endpoint tests for the auth flow using FastAPI TestClient, covering the happy path and key error cases.

### Changes Required:

#### 1. Add test fixtures for auth

**File**: `tests/conftest.py`

**Intent**: Add fixtures for a FastAPI TestClient and test database session so auth endpoints can be tested.

**Contract**: 
- Fixture providing a `TestClient` (or `httpx.AsyncClient`) wired to the FastAPI app
- The test setup needs a database connection. If testing against a real DB is feasible (test database), use it. If not, document the limitation and test what's possible with the TestClient alone.
- Fixture for registering a test user and returning credentials for reuse across tests

#### 2. Add auth endpoint tests

**File**: `tests/test_auth.py` (new)

**Intent**: Test the register → login → /me → logout flow and key error cases.

**Contract**: Test cases:
- Register a new user → 201, response contains email
- Register with duplicate email → 400, error message mentions email already registered
- Register with short password (< 8 chars) → 400/422
- Login with correct credentials → 200, response sets cookie
- Login with wrong password → 400
- Login with non-existent email → 400
- GET /me with valid cookie → 200, returns user
- GET /me without cookie → 401
- Logout → 200, clears cookie
- GET /me after logout → 401

### Success Criteria:

#### Automated Verification:

- All tests pass: `uv run pytest`
- Linting passes: `uv run ruff check .`
- Type checking passes: `uv run mypy .`

#### Manual Verification:

- Review test output to confirm all auth flows are covered
- Verify no existing tests broke

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- Not added separately — endpoint tests cover the auth logic through the API layer

### Integration Tests:

- Register → login → /me → logout full flow
- Duplicate email rejection
- Invalid password rejection (too short)
- Wrong credentials rejection
- Unauthenticated access to /me

### Manual Testing Steps:

1. Register a new account via the UI
2. Log in and verify header shows user email
3. Refresh the page — verify still logged in
4. Log out and verify header shows login/register links
5. Try registering with the same email — verify error message
6. Try logging in with wrong password — verify error message
7. Visit station pages without auth — verify they still work
8. Check browser dev tools — verify cookie is httpOnly and SameSite=Lax

## Performance Considerations

- SQLAlchemy async engine uses a small pool (`pool_size=3, max_overflow=2`) to stay within 768MB Mikr.us budget
- Auth endpoints are low-traffic (registration is one-time, login is rare with 30-day cookie)
- The /me check on every page load adds one lightweight DB query — cached by React Query on the frontend
- Existing raw asyncpg pool for data operations is unaffected

## Migration Notes

- Migration creates the `users` table. No existing data is affected.
- The migration revision number depends on whether data-pipeline-performance (004) lands first. Use the latest revision as `down_revision`.
- JWT_SECRET must be set in production `.env` before deploying. Without it, the app will fail to start (required field, no default).
- Cookie `secure` flag is environment-dependent: `False` in development, `True` in production.

## References

- PRD auth requirements: `context/foundation/prd.md:94-100` (FR-008, FR-009)
- PRD access control: `context/foundation/prd.md:133-139`
- Tech stack auth decision: `context/foundation/tech-stack-v2.md:29`
- Roadmap S-02: `context/foundation/roadmap.md:133-143`
- Existing API router: `app/api/__init__.py:1-8`
- Existing middleware: `app/middleware.py:13-36`
- Existing config: `app/config.py:1-21`
- Frontend router: `frontend/src/router.tsx:1-17`
- Frontend API client: `frontend/src/api/client.ts:1-9`
- Frontend layout: `frontend/src/components/Layout.tsx:1-26`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend Auth Setup

#### Automated

- [x] 1.1 Dependencies install cleanly: `uv sync` — 2401447
- [x] 1.2 Migration applies cleanly: `uv run alembic upgrade head` — 2401447
- [x] 1.3 Linting passes: `uv run ruff check .` — 2401447
- [x] 1.4 Type checking passes: `uv run mypy .` — 2401447
- [x] 1.5 Existing tests pass: `uv run pytest` — 2401447

#### Manual

- [x] 1.6 POST /api/v1/auth/register returns 201 with user data — 2401447
- [x] 1.7 POST /api/v1/auth/cookie/login returns 200 and sets httpOnly cookie — 2401447
- [x] 1.8 GET /api/v1/users/me with cookie returns user object — 2401447
- [x] 1.9 POST /api/v1/auth/cookie/logout clears the cookie — 2401447
- [x] 1.10 GET /api/v1/users/me without cookie returns 401 — 2401447
- [x] 1.11 Existing station endpoints still work without auth — 2401447
- [x] 1.12 Duplicate email registration returns explicit error — 2401447

### Phase 2: Frontend Auth UI

#### Automated

- [x] 2.1 Frontend builds without errors: `cd frontend && npm run build` — afe9901
- [x] 2.2 TypeScript compiles: `cd frontend && npx tsc --noEmit` — afe9901

#### Manual

- [x] 2.3 Register new account via UI — form submits, header shows user email — afe9901
- [x] 2.4 Login with existing account — cookie set, header updates — afe9901
- [x] 2.5 Page refresh — still logged in — afe9901
- [x] 2.6 Logout — header shows login/register links — afe9901
- [x] 2.7 Wrong password on login — error message displayed — afe9901
- [x] 2.8 Duplicate email on register — error displayed — afe9901
- [x] 2.9 Short password on register — validation error displayed — afe9901
- [x] 2.10 Station pages work without auth — afe9901

### Phase 3: Endpoint Tests

#### Automated

- [x] 3.1 All tests pass: `uv run pytest` — 2dabd8b
- [x] 3.2 Linting passes: `uv run ruff check .` — 2dabd8b
- [x] 3.3 Type checking passes: `uv run mypy .` — 2dabd8b

#### Manual

- [x] 3.4 Review test output confirms all auth flows covered — 2dabd8b
- [x] 3.5 No existing tests broke — 2dabd8b
