# User Registration and Login — Plan Brief

> Full plan: `context/changes/user-auth/plan.md`

## What & Why

Add user authentication (registration, login, logout) to MevoStats. This is the v1 auth foundation required by FR-008/FR-009 and a prerequisite for S-03 (favourites/dashboard). Accounts exist to support the v2 personal ride data feature — favourites are the minimum working feature that justifies accounts in MVP.

## Starting Point

Zero auth infrastructure exists. The backend is FastAPI with raw asyncpg (no ORM). The frontend is React + React Router + React Query with a GET-only API client. No user tables, no auth endpoints, no CORS middleware. SQLAlchemy is a transitive dependency via Alembic but not used in application code.

## Desired End State

A visitor can register with email/password, log in, and log out. Auth state persists across page refreshes via a 30-day httpOnly cookie. The header shows user email + logout when authenticated, login/register links when not. All station browsing remains public.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Auth library | fastapi-users with SQLAlchemy async | Battle-tested, provides register/login/logout/me out of the box; worth the SQLAlchemy dependency |
| Token storage | httpOnly cookie (backend-set) | XSS-proof; browser sends automatically; fastapi-users has built-in cookie transport |
| Token TTL | 30 days | Commuter app checked daily — long session avoids re-login friction |
| Connection pools | Two separate (asyncpg for data, SQLAlchemy for auth) | Can't share pools; auth pool is small (3 connections), data path unaffected |
| Frontend auth state | React Query + /me endpoint | Matches existing data-fetching pattern; no new state library needed |
| Duplicate email handling | Explicit "email already registered" error | Better UX; email enumeration is acceptable risk for a low-stakes commuter app |
| Password rules | Minimum 8 characters, no complexity | NIST-aligned; low friction for a bike-sharing app |
| Frontend pages | Separate /login and /register pages + header controls | Clean UX, standard pattern, easy to navigate |
| CORS | Middleware with credentials for dev, SameSite=Lax for prod | Dev workflow needs it (Vite port 5173 → backend 8000); production is same-origin |
| Testing | Endpoint tests via TestClient | Tests the API contract; matches existing test style |

## Scope

**In scope:**
- fastapi-users setup with SQLAlchemy async backend
- Users table migration
- Cookie-based JWT auth (register, login, logout, /me)
- CORS middleware
- Login and Register frontend pages
- Header auth controls (user email, logout, login/register links)
- Endpoint tests for auth flows

**Out of scope:**
- Email verification, password reset, rate limiting
- OAuth / social login
- Admin/superuser functionality
- Favourites or dashboard (S-03)
- Migrating existing code to SQLAlchemy

## Architecture / Approach

New `app/auth/` package contains SQLAlchemy engine, User model, UserManager, and auth config — cleanly separated from existing raw asyncpg code. fastapi-users routers are bundled into a single `auth_router` and mounted under `/api/v1`. The SQLAlchemy async engine maintains its own small connection pool (3+2) alongside the existing asyncpg pool. Frontend adds a `useAuth` hook (React Query-based) that checks `/users/me` on load and exposes login/register/logout mutations.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend Auth Setup | Users table, fastapi-users config, auth endpoints, CORS | Two connection pools must coexist without exceeding 768MB memory |
| 2. Frontend Auth UI | Login/Register pages, auth hook, header controls | Login endpoint expects form-encoded data, not JSON — easy to miss |
| 3. Endpoint Tests | Automated tests for register/login/logout/me flows | Test DB setup may need configuration |

**Prerequisites:** S-01 done, database access, `MEVO_JWT_SECRET` env var set
**Estimated effort:** ~2-3 sessions across 3 phases

## Open Risks & Assumptions

- Two SQLAlchemy + asyncpg pools on 768MB Mikr.us — pool sizes are conservative (5+3) but untested under load
- Migration revision number depends on whether data-pipeline-performance lands first
- fastapi-users login expects form-encoded `username` field (which is the email) — non-obvious convention that frontend must match
- No email verification means anyone can register with any email — acceptable for v1

## Success Criteria (Summary)

- User can register, log in, refresh (stays logged in), and log out — full cycle works end-to-end
- All existing station browsing works without authentication
- Auth endpoint tests pass covering happy path and error cases
