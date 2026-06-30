---
date: 2026-06-20
researcher: Claude (Opus 4.6)
git_commit: 85e7113e6499a09f644a3f1ace0317fdcdba4dd8
branch: main
repository: empi91/daily_mevo
topic: "Auth session not persisting on dailymevo.pl (issue #24) — test-first diagnostic plan"
tags: [research, auth, cookies, session, production, e2e, fastapi-users, issue-24]
status: complete
last_updated: 2026-06-20
last_updated_by: Claude (Opus 4.6)
---

# Research: Auth session not persisting on dailymevo.pl (issue #24)

**Date**: 2026-06-20
**Researcher**: Claude (Opus 4.6)
**Git Commit**: 85e7113e6499a09f644a3f1ace0317fdcdba4dd8
**Branch**: main
**Repository**: empi91/daily_mevo

## Research Question

User: "auth-session-fix — extended analysis BUT base the fixing purely on existing tests for now. Do not start with reading the code and modifying it; first discuss / run tests on the actual production and see what we got from there. But research first."

Translation: before touching any code, map the entire test surface that exercises the auth/session/cookie flow, confirm the diagnostic commands in `change.md` will actually work against `https://dailymevo.pl`, and identify any side effects of running them. The tests are the contract — whatever the fix ends up being, it must turn green Playwright tests against prod plus the smoke tests, without making the in-process parity tests regress.

## Summary

- **The tests are well-aligned with the bug.** Three Playwright tests in `e2e/auth-session.spec.ts` directly reproduce issue #24 (register → reload-must-still-show-email → logout, and a cookie-attribute introspection) and explicitly branch on `E2E_BASE_URL` for the `secure` flag. They are the right diagnostic instrument.
- **The cookie attribute contract is locked**: `httpOnly=true`, `SameSite=Lax`, `path=/`, `secure=(env != development)`. Both the in-process parity unit + integration tests (`tests/test_deployment_parity.py:117-180`) and the Playwright cookie test (`e2e/auth-session.spec.ts:53-74`) assert the same shape. **No test asserts a `Domain=` attribute** — meaning `cookie_domain=None` (host-only) is the intended contract, not a defect. The archived `testing-deployment-parity` change made this explicit: same-origin serving makes `cookie_domain=None` correct.
- **Topology is single-origin.** FastAPI serves the SPA via `StaticFiles` (`app/main.py:316-324`), so in prod the browser fetches `/api/v1/...` against the same host that returned `index.html`. The frontend client always uses `credentials: 'include'` and a relative `'/api/v1'` base URL (`frontend/src/api/client.ts:1,5`). This rules out the cross-origin `SameSite=Lax` hypothesis from `change.md` cause #4 — there is no cross-origin POST.
- **The only environment knob that affects cookies is `MEVO_ENVIRONMENT`.** It gates `cookie_secure` (`app/auth/config.py:18`). There are no `MEVO_COOKIE_DOMAIN`, `MEVO_COOKIE_SECURE`, `MEVO_COOKIE_SAMESITE`, or `MEVO_COOKIE_NAME` env vars in the codebase. If prod has `MEVO_ENVIRONMENT=production` set, `cookie_secure=True` is in effect.
- **Diagnostic commands as written are runnable**, with one caveat: they leave permanent `e2e-*@example.com` and `smoke-*@example.com` users in the prod database (no teardown). See "Production side effects" below.
- **The most informative single command** is the cookie-attribute Playwright test against prod. It will print the full `context.cookies()` record — including `domain`, which no other test asserts — and is the closest thing to a non-invasive diagnostic. It still creates one test user.

## Detailed Findings

### The acceptance tests (`e2e/auth-session.spec.ts`)

File: `e2e/auth-session.spec.ts`. Describe block `auth cookie round-trip` at L9. Fresh email per test via `uniqueEmail(label)` at L5-7: `` `e2e-${label}-${Date.now()}@example.com` `` — millisecond timestamps + label, no collision risk.

**Test 1 — "register → auto-login → session persists on reload → logout" (L10)**
- L18 `page.waitForURL('/')` after register.
- L19 `expect(page.getByText(email)).toBeVisible()` — confirms login state post-register.
- L22 `expect(page.getByText(email)).toBeVisible()` after `page.reload()` — **this is the exact issue #24 guard**: if the cookie is not stored or not sent on reload, this assertion fails.
- L25-26 post-logout: "Zaloguj się" link visible, email no longer visible.

**Test 2 — "login with credentials → session → logout" (L29)** — register, logout, then login with the credentials. Same logout assertions.

**Test 3 — "fastapiusersauth cookie has correct attributes after login" (L53)**
- L64 selects the `fastapiusersauth` cookie from `context.cookies()`.
- L66 `toBeDefined()`.
- L67 `httpOnly === true`.
- L68 `sameSite === 'Lax'`.
- L69 `path === '/'`.
- L71-73 `secure === isProduction`, where `isProduction = process.env.E2E_BASE_URL.startsWith('https://')`.
- **No `domain` assertion.** The actual stored domain attribute is whatever this test logs — making it the only test that can reveal a `Domain=` mismatch.

Playwright config (`playwright.config.ts:3,13`): `BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'`, fed to `use.baseURL`. `webServer` only spawns when localhost (L22) — safely a no-op against prod.

### Smoke tests (`tests/test_smoke.py`)

Module-level: `pytestmark = [pytest.mark.smoke, pytest.mark.asyncio(loop_scope="session")]` (L9). `BASE_URL = os.environ.get("MEVO_SMOKE_BASE_URL", "http://localhost:8000")` (L11). Skips when `/health` unreachable (L26-29).

Auth-relevant tests:
- `test_smoke_register` (L44) — `POST /api/v1/auth/register` → 201.
- `test_smoke_login` (L56) — `POST /api/v1/auth/cookie/login` → **204** + asserts `"fastapiusersauth" in resp.headers["set-cookie"]` (L69-71). Stores cookie line for downstream tests.
- `test_smoke_authenticated_access` (L78) — `GET /api/v1/users/me` with cookie → 200 + email matches.
- `test_smoke_logout` (L93) — `POST /api/v1/auth/cookie/logout` → 204.
- `test_smoke_protected_after_logout` (L103) — `GET /users/me` without cookie → 401.
- `test_smoke_cors_preflight` (L134) — `OPTIONS /api/v1/stations` with `Origin: https://dailymevo.pl`; asserts `"dailymevo.pl" in access-control-allow-origin` and `access-control-allow-credentials == "true"` (L144, L147).

This whole sequence is exactly the issue #24 lifecycle, but at the HTTP level (no browser cookie jar). If it passes against prod and Playwright fails, the bug is in the browser-side `Set-Cookie` interpretation (a missing/wrong attribute), not in server behavior.

### Parity tests (`tests/test_deployment_parity.py`)

Unit (no DB):
- `test_cookie_transport_httponly` (L117-120) — `cookie_httponly is True`.
- `test_cookie_transport_samesite_lax` (L123-126) — `cookie_samesite == "lax"`.
- `test_cookie_transport_secure_logic` (L129-135) — `cookie_secure is (settings.environment != "development")`.

Integration (`@pytest.mark.integration`):
- `test_cookie_attributes_in_production_response` (L143-180) — monkey-patches `cookie_transport.cookie_secure = True` (L153), registers a unique `parity-cookie-*` user, `POST /api/v1/auth/cookie/login`, asserts on `set-cookie` (lowercased): `"httponly"`, `"samesite=lax"`, `"secure"`, `"path=/"`. Restores in `finally`.

CORS production fixture (L188-209): `allow_origins=["https://dailymevo.pl"]`, `allow_credentials=True`. Drives `test_cors_production_origin_allowed` (L212) and `test_cors_unauthorized_origin_rejected` (L226).

**Crucially, no parity test asserts a `Domain=` attribute** — confirming the "host-only cookie is correct" decision.

### Cookie / auth backend config (current state)

`app/auth/config.py:14-19`:
```python
cookie_transport = CookieTransport(
    cookie_max_age=settings.jwt_lifetime_seconds,
    cookie_httponly=True,
    cookie_samesite="lax",
    cookie_secure=settings.environment != "development",
)
```
Not passed (fastapi-users defaults apply): `cookie_domain=None` (host-only — no `Domain=` attribute on `Set-Cookie`), `cookie_path="/"`, `cookie_name="fastapiusersauth"` (confirmed by every test that grabs it by that name).

`app/config.py`:
- L5 `environment: str = "development"` — sole gate on `cookie_secure`.
- L17 `cors_origins: list[str] = ["http://localhost:5173"]`.
- L19 `jwt_secret: str` (required), L20 `jwt_lifetime_seconds: int = 2592000` (30 days).
- L27 `env_prefix="MEVO_"`.

No dedicated cookie env vars exist anywhere.

`.env.example` (commented): `MEVO_CORS_ORIGINS=["https://srv66-20312.wykr.es","https://dailymevo.pl","https://www.dailymevo.pl"]`.

### Production topology

- `Dockerfile` multi-stage builds the SPA and copies `frontend/dist` into the image; container runs `uvicorn ... 0.0.0.0:8000`.
- `docker-compose.yml:5` maps `${MIKRUS_APP_PORT:-20000}:8000`; local `.env` uses `20312`.
- **No nginx/Caddy/Traefik config in repo.** Per `context/archive/2026-06-13-friendly-domain/plan.md:5,9-10,49-53`: Browser → Cloudflare edge (TLS termination, `Full` mode) → Cloudflare Tunnel (`cloudflared` systemd service on VPS) → `localhost:20312` → Docker → uvicorn `:8000`. Also reachable via Mikr.us platform proxy at `https://srv66-20312.wykr.es`.
- `app/main.py:200-207` middleware: `RequestContextMiddleware` + `CORSMiddleware(allow_origins=settings.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])`. **No `HTTPSRedirectMiddleware`, no `TrustedHostMiddleware`, no `SessionMiddleware`.** TLS termination happens at Cloudflare; FastAPI never sees a redirect chain.
- Auth router: `prefix="/api/v1"` (main) + `prefix="/auth/cookie"` (auth_router) → `POST /api/v1/auth/cookie/login`.
- SPA serving: `app/main.py:316-324` — same-origin in prod.

**Implications for `change.md`'s candidate causes:**
1. *"`cookie_domain` not set"* — Likely-correct per the parity decision; still worth checking what the browser stored (Test 3 reveals it).
2. *"Mikr.us reverse proxy stripping `Set-Cookie`"* — Cloudflare Tunnel is the actual path; verifiable via `curl -v https://dailymevo.pl/api/v1/auth/cookie/login`.
3. *"HTTPS redirect eating the cookie"* — No FastAPI redirect, but Cloudflare may enforce Always-HTTPS. Worth a `curl -v http://dailymevo.pl/...` to confirm no redirect-on-POST.
4. *"`SameSite=Lax` blocking cross-origin"* — Ruled out by single-origin topology; the SPA fetches `/api/v1/...` from `dailymevo.pl` itself.

A fifth hypothesis the change.md didn't list, surfaced by the topology: **`MEVO_ENVIRONMENT` may not be set to `production` on the VPS.** If the prod container runs with default `MEVO_ENVIRONMENT=development`, `cookie_secure=False` is emitted. A browser receiving a non-Secure cookie *over* HTTPS does accept it, but some Cloudflare/proxy behaviors and browser session-cookie heuristics differ subtly with `Secure` vs not. The cookie-attribute Playwright test will diagnose this in one step.

### Frontend HTTP client

`frontend/src/api/client.ts:1`: `const BASE_URL = '/api/v1'` (relative — works identically local and prod).
Every fetch passes `credentials: 'include'` (L5, L29, L40, L49). `apiPostForm` is used for `POST /auth/cookie/login` (`frontend/src/api/auth.ts:16`). Vite dev proxy: `vite.config.ts:7-10` proxies `/api` → `http://localhost:8000`. No `VITE_*` env vars switching URLs.

### Production diagnostic commands — verification

| Command | Status | Evidence |
|---------|--------|----------|
| `playwright.config.ts` reads `E2E_BASE_URL` | **PASS** | `playwright.config.ts:3,13` |
| Test title for `--grep "cookie has correct attributes"` | **PASS (substring match)** | Actual title at `e2e/auth-session.spec.ts:53` is `'fastapiusersauth cookie has correct attributes after login'`. `change.md` quotes a slightly different title; the grep still matches. |
| Fresh email per run, no real-user collision | **PASS** | `uniqueEmail(label)` at L5-7 produces `e2e-${label}-${Date.now()}@example.com` |
| `MEVO_SMOKE_BASE_URL` env read | **PASS** | `tests/test_smoke.py:11` |
| `-m smoke` marker registered | **PASS** | `pyproject.toml:42-45` |
| `npx playwright` invokable | **PASS** | `node_modules/.bin/playwright` exists; `package.json:5-7` has scripts. Project-preferred: `npm run test:e2e:headed -- e2e/auth-session.spec.ts`. |
| Chromium browser installed | **PASS** | `~/Library/Caches/ms-playwright/chromium-1228` present |
| **Cleanup against prod DB** | **FAIL — no cleanup** | See "Production side effects" |

### Production side effects (must read before running)

Each Playwright run of `e2e/auth-session.spec.ts` (3 tests, default) creates **3 fresh test users** in prod: `e2e-reg-<ts>@example.com`, `e2e-login-<ts>@example.com`, `e2e-cookie-<ts>@example.com`. Each smoke run adds **2 more**: `smoke-<ts>@example.com`, `smoke-login-<ts>@example.com`. No teardown fixtures, no DELETE endpoint called.

If only the cookie-attribute test is run via `--grep`, that's **1 user per run**. Still no cleanup.

This is a real consideration:
- The prod DB will accumulate test users (one row each in `users`).
- Email uniqueness won't collide thanks to timestamps.
- There is no admin-delete-user endpoint exposed.

Mitigation options to discuss before running:
- (a) Accept the noise — cheapest, simplest. Run the cookie-attribute test only (`--grep`) to minimize to 1 user per attempt.
- (b) Add a one-off SQL cleanup pattern (e.g., `DELETE FROM users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'smoke-%@example.com';`) to run manually after diagnostic sessions, executed via the SSH tunnel.
- (c) Point diagnostics at the Mikr.us platform URL (`https://srv66-20312.wykr.es`) instead of `https://dailymevo.pl` — but this reaches the same container/DB, so it doesn't reduce DB pollution; it only changes the host the browser sees. Useful only for ruling out Cloudflare specifically.

### Other auth/cookie tests for context

`tests/test_auth.py` (in-process integration, `@pytest.mark.integration`): full register/login/logout coverage, `_register_and_login` helper returns the `fastapiusersauth` cookie value (L32), `test_cookie_persists_across_requests` (L144), `test_expired_jwt_returns_401` (L163 — forges JWT with `settings.jwt_secret`, audience `"fastapi-users:auth"`), `test_cors_preflight_allows_configured_origin` (L178). These all pass in CI and are the in-process baseline that any fix must keep green.

## Code References

- `e2e/auth-session.spec.ts:5-7` — `uniqueEmail(label)` timestamp pattern
- `e2e/auth-session.spec.ts:10-27` — Test 1: persistence-on-reload guard (the literal issue #24 reproducer)
- `e2e/auth-session.spec.ts:29-51` — Test 2: login-with-credentials lifecycle
- `e2e/auth-session.spec.ts:53-74` — Test 3: cookie attribute introspection via `context.cookies()`
- `playwright.config.ts:3,13,22` — `E2E_BASE_URL` plumbing + `webServer` localhost gate
- `tests/test_smoke.py:11` — `MEVO_SMOKE_BASE_URL` default
- `tests/test_smoke.py:56-71` — `test_smoke_login` HTTP-level Set-Cookie assertion
- `tests/test_smoke.py:134-147` — `test_smoke_cors_preflight` for `dailymevo.pl`
- `tests/test_deployment_parity.py:117-135` — cookie attribute unit tests
- `tests/test_deployment_parity.py:143-180` — `test_cookie_attributes_in_production_response`
- `tests/test_deployment_parity.py:188-209` — `cors_production_client` fixture
- `tests/test_auth.py:32-200` — full in-process auth coverage
- `app/auth/config.py:14-19` — `CookieTransport` kwargs (the implicit `cookie_domain=None`)
- `app/auth/config.py:22-33` — `JWTStrategy` + `AuthenticationBackend`
- `app/config.py:5,17,19-20,27` — Settings (`environment`, `cors_origins`, `jwt_secret`, `env_prefix`)
- `app/main.py:200-207` — middleware stack (no HTTPSRedirect, no TrustedHost)
- `app/main.py:316-324` — SPA same-origin serving via `StaticFiles`
- `app/auth/__init__.py:8-24` — `/api/v1/auth/cookie/{login,logout}`, `/api/v1/auth/register`, `/api/v1/users/me`
- `frontend/src/api/client.ts:1,5,29,40,49` — relative `BASE_URL`, `credentials: 'include'` everywhere
- `frontend/src/api/auth.ts:16,20,24` — login/logout/me callers
- `frontend/vite.config.ts:7-10` — dev `/api` → `localhost:8000` proxy
- `pyproject.toml:40-45` — pytest markers (`smoke`, `integration`)
- `package.json:5-7` — `test:e2e`, `test:e2e:headed`, `test:e2e:ui` scripts
- `context/RUNNING_TESTS.md:53-55,78-85,148-149` — documented prod diagnostic commands
- `Dockerfile`, `docker-compose.yml:5`, `scripts/entrypoint.sh:6` — container topology

## Architecture Insights

- **Single-origin serving is the design intent**, not an accident. The SPA is baked into the FastAPI image and served via `StaticFiles`. Every browser request — page load, fetch — goes to the same host. This collapses an entire class of cookie/CORS problems and is why `cookie_domain=None` (host-only) is the correct contract.
- **Cloudflare Tunnel is the only thing in front of FastAPI.** No nginx/Caddy in the repo. The TLS terminator is Cloudflare; the tunnel forwards to `localhost:20312` → Docker → uvicorn. This is the actual subject of `change.md`'s "Mikr.us reverse proxy" hypothesis — it's really Cloudflare Tunnel behavior, not Mikr.us.
- **The cookie contract is defended by two layers**: the in-process `tests/test_deployment_parity.py` integration test that monkey-patches `cookie_secure=True` and verifies the HTTP-level `Set-Cookie`, plus the Playwright Test 3 that asserts what the *browser* actually stored. Together they let us narrow whether the server emits the right header (smoke + parity) and whether the browser interpreted it correctly (Playwright).
- **The one config knob that matters is `MEVO_ENVIRONMENT`.** Everything cookie-related derives from it. If it's wrong on the VPS, every Secure-flag assumption breaks.
- **Cleanup is a gap in the test framework**, not a bug per se. The tests were designed for ephemeral test DBs (CI's containerized Postgres) where teardown is implicit. Pointed at prod, they have no teardown.

## Historical Context (from prior changes)

From `context/archive/2026-06-19-testing-deployment-parity/`:

- `change.md:18-25` — the parity change was motivated by three prod failures that escaped the in-process test suite (PgBouncer 500, missing-users-table, **issue #24**). All shared the same root cause: tests ran against `ASGITransport` with localhost defaults; production uses HTTPS + real domain + PgBouncer.
- `plan.md:152` — explicit: "This is the test that would have caught issue #24 (auth session not persisting) and the PgBouncer 500 on auth endpoints." Refers to the smoke auth lifecycle.
- `plan.md:303-308` — explicit rationale for Playwright: "This goes beyond what httpx can test — the browser's cookie jar applies `SameSite`, `Secure`, and `Domain` rules that httpx doesn't."
- `plan.md:44` — "same-origin serving makes `cookie_domain=None` correct; adding a configurable override is out of scope." This is the **prior team decision** that the fix must respect — proposals to set `cookie_domain="dailymevo.pl"` go against this decision and need a separate discussion.
- `plan.md:373-382` — three-layer defense rationale: parity (CI) + smoke (HTTP) + Playwright (browser).
- `plan.md:392` — "Auth smoke tests will block deploys if issue #24 is still present... This means issue #24 must be fixed either before or alongside deploying Phase 2's smoke tests to production."
- `research.md:71` — "if `dailymevo.pl` proxies to `srv66-20312.wykr.es` and the proxy doesn't set the correct `Host` header, the cookie domain mismatch breaks auth." Note: per the friendly-domain archive, the path is actually `dailymevo.pl` → Cloudflare Tunnel → `localhost:20312` directly, *not* via the wykr.es proxy.
- `research.md:194-202` — open questions left at archive time: (1) reverse proxy `Host` header preservation on Mikr.us, (2) production `.env` contents — neither was remotely verifiable.

From `context/foundation/roadmap.md:38,162-174`:
- B-01 `auth-session-fix`, status `ready`.
- Lists same four candidate causes as `change.md`.
- Acceptance: `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts` — all 3 tests pass against prod.

The PRD does not reference issue #24 directly.

## Related Research

- `context/archive/2026-06-19-testing-deployment-parity/research.md` — the precursor research that named issue #24 as a motivating failure
- `context/archive/2026-06-19-testing-deployment-parity/plan.md` — the plan that locked the cookie attribute contract this fix must satisfy
- `context/archive/2026-06-13-friendly-domain/plan.md` — Cloudflare Tunnel topology

## Recommended diagnostic sequence (test-first, no code changes)

Each step is a test invocation. After each, you decide whether to continue. **Stop and discuss before touching code.**

**Step 0 — confirm `MEVO_ENVIRONMENT` on the VPS.** Before running anything that mutates prod DB:
```bash
ssh mikrus 'cat /path/to/.env | grep MEVO_ENVIRONMENT'
```
(Or `docker compose exec app printenv | grep MEVO_`.) This is a zero-side-effect check that may resolve the bug immediately if the value is unset/wrong.

**Step 1 — raw HTTP, no DB pollution.** Use `curl` to see what the server actually sends on login. This requires registering a user first, so it does pollute (1 row), but no test framework. Alternatively, reuse an existing test user if you have one. Single command pattern:
```bash
curl -v -X POST https://dailymevo.pl/api/v1/auth/cookie/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=<existing-user>&password=<password>"
```
Inspect the `Set-Cookie:` line. Compare to the parity test contract: must contain `HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`, **no `Domain=`**. Note exactly what Cloudflare adds/strips.

**Step 2 — single Playwright cookie-attribute test against prod.** One user created. Reveals the browser-side view including `domain`:
```bash
E2E_BASE_URL=https://dailymevo.pl \
  npx playwright test e2e/auth-session.spec.ts --grep "cookie has correct attributes" --headed
```
If this passes, the cookie is being delivered with the right attributes. The bug is then on the *client* side (frontend not sending it back, or `credentials: 'include'` not effective) or in a follow-up request. If this fails, the server-emitted attributes are wrong and Step 1's `curl` output tells you which.

**Step 3 — full Playwright suite against prod.** Three users created. This is the acceptance gate and the literal reproducer for issue #24:
```bash
E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts --headed
```
Test 1's `expect(...).toBeVisible()` after `page.reload()` is the bug.

**Step 4 — smoke suite against prod.** Two more users created. Confirms HTTP-level behavior end-to-end:
```bash
MEVO_SMOKE_BASE_URL="https://dailymevo.pl" uv run pytest tests/test_smoke.py -m smoke -v
```
If Playwright Test 1 fails but every smoke test passes, the bug is browser-jar-specific (cookie attribute the browser refuses) — consistent with `SameSite`/`Secure`/`Domain` interpretation, not server logic.

**Step 5 — cleanup (decision point).** After diagnostics, run one cleanup query via SSH tunnel:
```sql
DELETE FROM users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'smoke-%@example.com' OR email LIKE 'parity-cookie-%@example.com';
```
Confirm count first with `SELECT count(*) FROM users WHERE email LIKE ...`.

## Open Questions

1. **Is `MEVO_ENVIRONMENT=production` actually set on the VPS?** This is the single most likely root cause and is verifiable with a one-line SSH check before any test pollutes prod data. (Per parity archive research.md:200, this couldn't be verified remotely at archive time.)
2. **Does Cloudflare Tunnel rewrite or drop the `Set-Cookie` header?** Step 1's `curl -v` against `dailymevo.pl` vs the same against `srv66-20312.wykr.es` (bypassing Cloudflare) would isolate this.
3. **Is the `domain` attribute the browser actually stores blank (host-only) or set to something?** No existing test checks this. Step 2 will print it.
4. **Cleanup strategy for prod-targeted tests** — accept the noise, do manual cleanup after diagnostic sessions, or add an opt-in teardown that uses a dedicated admin endpoint (out of scope for the immediate fix but worth a follow-up note).
5. **Should `change.md` cause #1's fix proposal (`cookie_domain="dailymevo.pl"`) be retained at all?** The parity archive locked `cookie_domain=None` as correct, and no test asserts a `Domain=` attribute. If Step 2's diagnostic confirms the cookie is host-only as designed, this proposed fix should be struck from the candidate list before planning begins.
