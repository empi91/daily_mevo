# Auth Session Fix — Diagnostic Findings

## Step 0 — Verify `MEVO_ENVIRONMENT` on VPS

**Command**: `ssh mikrus 'cd /app && grep MEVO_ENVIRONMENT .env'`
**Output**: `MEVO_ENVIRONMENT=production`
**Interpretation**: Correctly set. Cookie `Secure` flag is being derived properly. Ruled out as root cause.

## Step 1 — Raw HTTP login via curl

**Command**: `curl -v -X POST https://dailymevo.pl/api/v1/auth/cookie/login -H "Content-Type: application/x-www-form-urlencoded" -d "username=diag-step1@example.com&password=TestPass123!"`
**Output** (Set-Cookie line):
```
set-cookie: fastapiusersauth=<jwt>; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax; Secure
```
**Interpretation**: All attributes match the locked parity contract exactly: HttpOnly, SameSite=Lax, Secure, Path=/, no Domain= attribute. Server-side config is correct.

## Step 1b — Cloudflare bypass A/B

**Not run.** Step 1's Set-Cookie matched the contract — no discrepancy to isolate.

## Step 2 — Browser-level cookie introspection (Playwright)

**Command**: `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts --grep "cookie has correct attributes"`
**Output**: 1 passed (2.4s)
**Interpretation**: Browser stores the cookie with correct attributes when accessed over HTTPS. No attribute mismatch.

## Step 3 — Full Playwright suite reproduction

**Command**: `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts`
**Output**: 3 passed (4.6s)
**Interpretation**: All three tests pass, including the issue #24 reproducer ("register → reload → still logged in"). The bug does not reproduce when the site is accessed over HTTPS. Playwright always uses HTTPS (from `E2E_BASE_URL`).

## Step 4 — HTTP-level smoke suite

**Command**: `MEVO_SMOKE_BASE_URL="https://dailymevo.pl" uv run pytest tests/test_smoke.py -m smoke -v`
**Output**: 9 passed (7.66s)
**Interpretation**: Full HTTP-level auth lifecycle works correctly against prod over HTTPS.

## Identified Root Cause

**(a) What holds the wrong value**: Cloudflare "Always Use HTTPS" setting for `dailymevo.pl` was **OFF**.

**(b) What the correct value is**: **ON** — Cloudflare must redirect all `http://` requests to `https://` via 301.

**(c) Which diagnostic step proved it**: Manual browser debugging between Steps 3 and 4. Chrome DevTools Network tab showed the `/api/v1/users/me` request was sent over `http://dailymevo.pl` (not `https://`). The `fastapiusersauth` cookie has `Secure` flag, so Chrome correctly refused to attach it to an HTTP request → 401. The page was loading over HTTP because Cloudflare was not forcing the redirect.

**Evidence chain**:
1. Server emits `Secure` cookie (Step 1 curl confirmed).
2. User's Chrome had `http://dailymevo.pl` as the URL (DevTools Request URL and Referer both showed `http://`).
3. Chrome stores the `Secure` cookie but does not send it on HTTP requests (per spec).
4. `/api/v1/users/me` returns 401 → frontend shows unauthenticated state.
5. Safari worked because it followed HTTPS. Incognito worked because it didn't have a cached HTTP URL.
6. Toggling "Always Use HTTPS" ON in Cloudflare fixed the issue immediately.

## Applied Fix & Undo Path

**What was changed**: Cloudflare Dashboard → dailymevo.pl → SSL/TLS → Edge Certificates → "Always Use HTTPS" → toggled **ON**.

**Old value**: OFF
**New value**: ON

**To revert**: Toggle the same setting back to OFF in Cloudflare Dashboard. Takes effect immediately (< 30 seconds).
