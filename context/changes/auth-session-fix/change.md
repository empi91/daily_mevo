---
change_id: auth-session-fix
title: Fix auth session not persisting on dailymevo.pl (issue #24)
status: planned
created: 2026-06-19
updated: 2026-06-19
archived_at: null
---

## Notes

Issue #24: after login on `dailymevo.pl`, the `fastapiusersauth` cookie is set
but the session does not survive a page reload — the user appears logged out.
Works fine locally (localhost). This is a production-only bug caused by a
difference in cookie/CORS/proxy configuration between dev and production.

## Diagnostic approach

The `testing-deployment-parity` change (now archived) laid the quality gates
for this fix. Before writing any code, run the E2E tests against production to
confirm the bug is reproducible and to identify the exact failing attribute:

```bash
# 1. Reproduce the bug — session test should fail if #24 is active
E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts --headed

# 2. Inspect the cookie attributes the browser actually receives
#    The cookie attribute test prints: httpOnly, sameSite, secure, domain, path
E2E_BASE_URL=https://dailymevo.pl npx playwright test \
  "e2e/auth-session.spec.ts" --grep "cookie has correct attributes" --headed
```

`context.cookies()` in the Playwright test reveals exactly what the browser
stored — compare against the expected values:

| Attribute  | Expected locally | Expected in production |
|------------|-----------------|----------------------|
| `httpOnly` | `true`          | `true`               |
| `sameSite` | `Lax`           | `Lax`                |
| `secure`   | `false`         | `true`               |
| `path`     | `/`             | `/`                  |
| `domain`   | `localhost`     | `dailymevo.pl` (or blank = host-only) |

## Known candidate causes

1. **`cookie_domain` not set** — `CookieTransport` in `app/auth/config.py` has
   `cookie_domain=None`. With `Secure=True`, some browsers/proxies require the
   domain to be explicit. Candidate fix: `cookie_domain="dailymevo.pl"`.

2. **Mikr.us reverse proxy stripping `Set-Cookie`** — if the proxy doesn't
   forward `Set-Cookie` headers correctly, the browser never receives the cookie.
   Check: inspect the raw `Set-Cookie` response header via `curl -v` against the
   production URL.

3. **HTTPS redirect eating the cookie** — if the first request is HTTP and gets
   redirected to HTTPS, the cookie set on the redirect response may be dropped.
   Check: `curl -v http://dailymevo.pl/api/v1/auth/cookie/login` to see if a
   redirect is in play.

4. **SameSite=Lax blocking cross-origin requests** — if the frontend and API are
   served from different origins in production, `SameSite=Lax` would block the
   cookie on cross-origin POST. Check the actual serving setup (FastAPI
   StaticFiles vs separate Vite build).

## Acceptance test

Once a fix is applied, verify with:

```bash
E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts
```

All 3 tests must pass against production:
- `register → auto-login → session persists on reload → logout`
- `login with credentials → session → logout`
- `fastapiusersauth cookie has correct attributes after login`

Also run the smoke tests as a second gate:

```bash
MEVO_SMOKE_BASE_URL="https://dailymevo.pl" uv run pytest tests/test_smoke.py -m smoke -v
```

## References

- `app/auth/config.py:14-19` — CookieTransport configuration
- `e2e/auth-session.spec.ts` — acceptance tests (3 tests)
- `tests/test_smoke.py` — HTTP-level auth smoke tests
- `tests/test_deployment_parity.py` — cookie attribute unit test (production settings)
- GitHub issue #24
