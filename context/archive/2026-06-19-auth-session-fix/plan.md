# Auth Session Fix (Issue #24) Implementation Plan

## Overview

Diagnose why the `fastapiusersauth` cookie is set on login at `https://dailymevo.pl` but doesn't survive a page reload, then ship the smallest possible config or code change that turns the locked test contract green against production — without regressing the in-process or smoke tiers. The user explicitly directed: tests first, no code touches until diagnostics name the cause.

## Current State Analysis

- **The bug is production-only.** Local dev (http://localhost:5173) passes every auth test; `https://dailymevo.pl` exhibits issue #24 (cookie set on login, gone on reload).
- **The test contract is locked.** Three layers exist and must all stay green: parity unit + integration (`tests/test_deployment_parity.py:117-180`), smoke (`tests/test_smoke.py`), and Playwright (`e2e/auth-session.spec.ts`). The contract asserts `httpOnly=true`, `SameSite=Lax`, `Secure=(env != development)`, `path=/`, and **host-only** (no `Domain=` attribute). No test asserts a `Domain=` value.
- **The only config knob that drives cookie behavior is `MEVO_ENVIRONMENT`** (`app/auth/config.py:18` → `cookie_secure=settings.environment != "development"`). No `MEVO_COOKIE_*` env vars exist.
- **Production topology is single-origin via Cloudflare Tunnel.** FastAPI serves the SPA via `StaticFiles` (`app/main.py:316-324`); frontend uses relative `/api/v1` (`frontend/src/api/client.ts:1`). Browser → Cloudflare edge (TLS termination) → Cloudflare Tunnel → `localhost:20312` → Docker → uvicorn. No nginx/Caddy in repo. No `HTTPSRedirectMiddleware` / `TrustedHostMiddleware`.
- **Mikr.us platform proxy** (`srv66-20312.wykr.es`) is a parallel path to the same container, useful for isolating Cloudflare from a diagnostic.
- **Frontend uses `credentials: 'include'` on every fetch** (`frontend/src/api/client.ts:5,29,40,49`) and a relative base URL, so cross-origin SameSite blocking is structurally ruled out.
- **`MEVO_ENVIRONMENT` on the VPS is unverifiable from the repo.** The parity archive `research.md:194-202` flagged this as an open question at archive time.

### Key Discoveries:

- The single most likely root cause — `MEVO_ENVIRONMENT` not being `production` on the VPS — is verifiable with one SSH command and zero side effects (`app/config.py:5`, `app/auth/config.py:18`).
- `change.md` candidate #1 (set `cookie_domain="dailymevo.pl"`) contradicts the parity archive decision (`context/archive/2026-06-19-testing-deployment-parity/plan.md:44`): "same-origin serving makes `cookie_domain=None` correct; adding a configurable override is out of scope." It is excluded from this plan's solution space.
- `change.md` candidate #4 (SameSite=Lax blocking cross-origin) is structurally ruled out by single-origin serving. Also excluded.
- The Playwright cookie introspection test (`e2e/auth-session.spec.ts:53-74`) is the only test that surfaces what the browser actually stored, including a `domain` attribute no other test asserts. It is the single most informative diagnostic instrument.
- Running tests against prod leaves 1–5 permanent `e2e-*@example.com` / `smoke-*@example.com` / `parity-cookie-*@example.com` users per execution; no automated teardown exists.

## Desired End State

- All 3 tests in `e2e/auth-session.spec.ts` pass when run with `E2E_BASE_URL=https://dailymevo.pl`.
- All smoke tests pass with `MEVO_SMOKE_BASE_URL="https://dailymevo.pl"`.
- All in-process parity tests (`tests/test_deployment_parity.py`) still pass under `uv run pytest`.
- All in-process auth tests (`tests/test_auth.py`) still pass under `uv run pytest`.
- The change that landed in production is documented with an atomic undo path (one .env edit or one revert of a small code change).
- The prod `users` table has zero `e2e-*@example.com`, `smoke-*@example.com`, or `parity-cookie-*@example.com` rows after close-out.

How to verify: run the four test commands above; query the prod DB for the cleanup pattern.

## What We're NOT Doing

- **Not setting `cookie_domain="dailymevo.pl"`.** Contradicts the locked parity contract (`context/archive/2026-06-19-testing-deployment-parity/plan.md:44`). Host-only is the intended design. If diagnostics somehow indicate a Domain= attribute is required, that triggers a STOP-and-replan with the parity decision reopened — not a silent flip in this plan.
- **Not introducing `MEVO_COOKIE_DOMAIN` / `MEVO_COOKIE_SECURE` / `MEVO_COOKIE_SAMESITE` env vars.** Out of scope; the current design intentionally derives all cookie attributes from `MEVO_ENVIRONMENT`.
- **Not modifying Cloudflare Tunnel config, the Dockerfile, docker-compose, the frontend, or middleware ordering.** If diagnostics point at any of these, that triggers STOP-and-replan, not in-scope changes.
- **Not modifying any of the auth tests** to make them "pass" against prod. The tests are the contract. If a test is wrong, that's its own change.
- **Not adding a nightly CI guard** that runs E2E against prod. Out of scope; separate change.
- **Not adding automated test-user teardown infrastructure.** Cleanup is a documented one-shot SQL command in Phase 4. A reusable teardown fixture is a separate change.
- **Not reproducing the bug locally.** Localhost is `http://`, so `Secure=True` is rejected by the browser; the cookie path is structurally different. Diagnostics happen against prod or not at all.

## Implementation Approach

Four phases in increasing blast-radius order. The plan deliberately defers the "what to change" specification in Phase 2 until Phase 1's evidence narrows it — the change.md candidate list has 4–5 entries and pre-specifying the fix would be speculation.

- Phase 1 is a fixed five-step diagnostic with conditional branches. Each step has an explicit "stop and decide" gate. Findings land in a short evidence log so Phase 2 has documented inputs.
- Phase 2's `Changes Required` is intentionally written as "fill in from Phase 1 findings" with a fixed scope boundary: env var on VPS, or small change in `app/config.py` / `app/auth/config.py`. Anything else triggers STOP-and-replan.
- Phase 3 is the verification gate — the same five test commands that close the change.
- Phase 4 cleans up the prod DB and archives the diagnostic log.

## Critical Implementation Details

- **Stop after each diagnostic step.** The plan's value is the gating, not the running. The implementer (you) MUST pause and discuss findings before continuing past Phase 1 sub-steps that produce surprising output. The diagnostic-findings.md is the working log.
- **The Playwright cookie attribute test title is a substring match.** `change.md` uses `--grep "cookie has correct attributes"` but the actual test title is `'fastapiusersauth cookie has correct attributes after login'` (`e2e/auth-session.spec.ts:53`). The substring match works.
- **The diagnostic step that creates the fewest users is the `--grep`-scoped Playwright run** (1 user). The full Playwright suite creates 3; the smoke suite creates 2.
- **Cloudflare bypass via `srv66-20312.wykr.es` reaches the same container and same DB.** It only changes which proxy the browser sees, useful purely for isolating Cloudflare-specific behavior; it doesn't reduce DB pollution.
- **`MEVO_ENVIRONMENT` is the only env var the codebase has for cookie attributes.** If the fix is "set it to production", that's the entire fix. Don't introduce new env vars.

## Phase 1: Diagnostic sequence

### Overview

Run five bounded diagnostic steps in increasing blast-radius order, gating on output between each. Capture findings to `context/changes/auth-session-fix/diagnostic-findings.md` so Phase 2 has documented inputs.

### Changes Required:

#### 1. Diagnostic evidence log

**File**: `context/changes/auth-session-fix/diagnostic-findings.md`

**Intent**: Create a short working document the implementer fills in as each diagnostic step runs. Phase 2 reads it to decide the fix; Phase 4 archives it.

**Contract**: Plain markdown with one section per diagnostic step. Each section captures the command run, the output (or relevant excerpt), and a one-line interpretation. No fixed schema beyond that.

#### 2. Step 0 — Verify `MEVO_ENVIRONMENT` on VPS

**File**: (no repo change; one SSH command + evidence log update)

**Intent**: Check whether `MEVO_ENVIRONMENT=production` is actually set on the Mikr.us VPS. This is the single highest-probability root cause; verifiable with zero side effects. Per the parity archive, this couldn't be verified remotely at archive time.

**Contract**: SSH to mikrus, read the env from the running container or compose `.env`, paste the relevant `MEVO_*` env vars into the findings log. Concrete command pattern: `ssh mikrus 'docker compose -f /path/to/docker-compose.yml exec app printenv | grep MEVO_'` (path to be confirmed by reading `deploy.sh` first). If `MEVO_ENVIRONMENT` is absent or != `production`, **Phase 2's fix is determined** — proceed directly to Phase 2 after a brief confirmation pass through Step 1.

#### 3. Step 1 — Raw HTTP login via curl

**File**: (no repo change; ad-hoc curl + evidence log update)

**Intent**: Inspect the exact `Set-Cookie` header the server emits in response to a login POST against production. Compare attribute-by-attribute against the locked parity contract.

**Contract**: Use an existing test account (do not register a new one here — that pollutes the DB without test framework benefits). Issue `curl -v -X POST https://dailymevo.pl/api/v1/auth/cookie/login -H "Content-Type: application/x-www-form-urlencoded" -d "username=<email>&password=<pw>"`. Capture the `Set-Cookie:` line and any redirect chain in the findings log. The contract requires the line to contain `HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`, and NO `Domain=` attribute. Note any discrepancy.

#### 4. Step 1b (conditional) — Cloudflare bypass A/B

**File**: (no repo change; ad-hoc curl + evidence log update)

**Intent**: Run only if Step 1's `Set-Cookie` line differs from the parity contract, to isolate whether Cloudflare Tunnel is altering the response. Bypass Cloudflare by hitting the Mikr.us platform proxy directly.

**Contract**: Repeat Step 1's curl against `https://srv66-20312.wykr.es/api/v1/auth/cookie/login` with the same credentials. Diff the two `Set-Cookie` lines in the findings log. If they're identical, Cloudflare is innocent; the bug is in FastAPI's response. If they differ, Cloudflare is altering the cookie; the fix may need Cloudflare tunnel config (triggers STOP-and-replan per scope).

#### 5. Step 2 — Browser-level cookie introspection

**File**: (no repo change; Playwright command + evidence log update)

**Intent**: Run the single Playwright test that uses `context.cookies()` to report what the browser actually stored, including the `domain` attribute no other test asserts. Creates 1 test user in prod DB.

**Contract**: Run `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts --grep "cookie has correct attributes" --headed`. Paste the test output and (if failing) the actual cookie object the test logs into the findings log. If the test passes, the server emits correct attributes AND the browser stored them correctly — the bug is in how the cookie is sent back on subsequent requests (suggests SPA routing, fetch credentials, or a per-route issue). If it fails, the assertion that fails names the wrong attribute.

#### 6. Step 3 — Full Playwright suite reproduction

**File**: (no repo change; Playwright command + evidence log update)

**Intent**: Run the full 3-test Playwright suite against prod to capture the literal issue #24 reproducer (`e2e/auth-session.spec.ts:22` — the post-reload `toBeVisible()` assertion). Creates 3 test users in prod DB. Skip if Step 0 already pinpointed the root cause AND Step 1/2 confirmed the contract.

**Contract**: Run `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts --headed`. Paste pass/fail breakdown into the findings log. The exact assertion that fails tells you which lifecycle stage the cookie loses.

#### 7. Step 4 — HTTP-level smoke suite

**File**: (no repo change; pytest command + evidence log update)

**Intent**: Run the smoke suite against prod to confirm the bug is/isn't visible at the HTTP layer (no browser cookie jar involved). Creates 2 test users in prod DB. Skip if previous steps fully diagnosed the cause.

**Contract**: Run `MEVO_SMOKE_BASE_URL="https://dailymevo.pl" uv run pytest tests/test_smoke.py -m smoke -v`. Paste pass/fail breakdown into the findings log. If Playwright Test 1 fails but smoke passes, the bug is browser-jar-specific (cookie attribute the browser rejects); if smoke also fails, the bug is server-side.

#### 8. Phase 1 close-out — synthesize findings

**File**: `context/changes/auth-session-fix/diagnostic-findings.md` (final section)

**Intent**: Write a one-paragraph "Identified Root Cause" section at the bottom of the findings log naming the cause and the proposed fix surface (env var on VPS, or specific code change). This is Phase 2's input contract.

**Contract**: Section heading `## Identified Root Cause`. Body names: (a) which env var or file holds the wrong value, (b) what the correct value is, (c) which diagnostic step proved it. If the root cause is outside the scope boundary (Cloudflare config, Dockerfile, frontend), instead write `## STOP — Out of Scope` with the same three pieces of evidence, and the implementer STOPs and discusses with the user.

### Success Criteria:

#### Automated Verification:

- `context/changes/auth-session-fix/diagnostic-findings.md` exists with all 5 step sections (Step 1b may be marked "not run, Step 1 matched contract").
- `## Identified Root Cause` OR `## STOP — Out of Scope` section is present at the bottom of the findings log.

#### Manual Verification:

- Step 0's SSH output is in the findings log and the value of `MEVO_ENVIRONMENT` (or its absence) is recorded.
- Step 1's curl output includes the full `Set-Cookie:` line and the user has eyeballed it against the locked contract.
- Step 2's Playwright run completed (pass or fail captured) — the user has read the cookie object the test reports.
- The implementer has paused after each step where the output is unexpected and discussed with the user before proceeding to the next.
- The root cause / scope-stop decision has been explicitly confirmed with the user before moving to Phase 2.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Apply identified fix

### Overview

Make the single smallest change that turns the test contract green against production. Scope is bounded to env var on VPS, or small change in `app/config.py` / `app/auth/config.py`. Anything else triggers STOP-and-replan.

### Changes Required:

#### 1. Apply fix per Phase 1 findings

**File**: TBD — determined by Phase 1's `## Identified Root Cause` section. Expected candidates (in descending probability):

  - **Most likely**: VPS-side `.env` file (the one used by `docker-compose.yml`) — add or correct `MEVO_ENVIRONMENT=production`. No repo change.
  - **Possible**: `app/config.py:5` — change the default of `environment` (only if there's evidence the env var is set correctly but not being read). Repo change.
  - **Possible**: `app/auth/config.py:14-19` — adjust how a specific cookie attribute is derived (only if Phase 1 shows a specific attribute is wrong server-side). Repo change.

**Intent**: Make exactly one change that addresses the named root cause. No "while I'm here" cleanups, no preemptive hardening, no new env vars.

**Contract**: Whatever change is made, document in the commit message or .env note: (a) the file/env var changed, (b) the old value, (c) the new value, (d) the diagnostic step that named the cause. This is the atomic-undo manifest — restoring (b) reverts the change in 30 seconds.

**Scope boundary**: If the named root cause points outside `{VPS .env, app/config.py, app/auth/config.py}`, do NOT make the change. Write the proposed change to `diagnostic-findings.md` and STOP. Discuss with the user before any of: Cloudflare Tunnel config changes, Dockerfile edits, docker-compose edits, frontend changes, middleware changes, new env vars, or changes to tests/contract.

#### 2. Restart the prod app (if VPS .env was the change)

**File**: (no repo change; operational step)

**Intent**: Make the new env var actually take effect inside the running container.

**Contract**: `ssh mikrus 'cd /path/to/app && docker compose up -d'` (or equivalent restart command per `deploy.sh`). Confirm the container is healthy via `curl https://dailymevo.pl/health`. Skip this entry if the fix was a code change (which goes through the normal deploy via merge to `main`).

### Success Criteria:

#### Automated Verification:

- For env var change: `curl https://dailymevo.pl/health` returns 200 after restart.
- For code change: `uv run ruff check .` passes; `uv run mypy .` passes (per CLAUDE.md commands); the diff is one logical change.

#### Manual Verification:

- The change made is the one the findings log names — nothing else was modified opportunistically.
- The atomic-undo path is recorded (one line: "to revert, set X back to Y") in `diagnostic-findings.md`.
- The user has acknowledged the change and the undo path before Phase 3 verification runs.

**Implementation Note**: After completing this phase, pause for manual confirmation before running Phase 3's verification.

---

## Phase 3: Verify against the full test contract

### Overview

Run the locked test contract — Playwright + smoke against prod, parity + in-process auth in CI — and confirm every layer is green. If any layer regresses, STOP and discuss before any further changes.

### Changes Required:

#### 1. Run Playwright against prod (issue #24 acceptance)

**File**: (no repo change; test command)

**Intent**: Confirm the literal acceptance test from `change.md` and `roadmap.md:172` passes. Adds 3 test users to prod DB (cleaned up in Phase 4).

**Contract**: `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts`. All 3 tests must pass.

#### 2. Run smoke against prod

**File**: (no repo change; test command)

**Intent**: Confirm the HTTP-level lifecycle is green end-to-end on prod. Adds 2 test users to prod DB (cleaned up in Phase 4).

**Contract**: `MEVO_SMOKE_BASE_URL="https://dailymevo.pl" uv run pytest tests/test_smoke.py -m smoke -v`. All tests must pass.

#### 3. Run parity suite (in-process)

**File**: (no repo change; test command)

**Intent**: Confirm the in-process cookie attribute contract still holds — guard against a Phase 2 change that accidentally regresses the parity tests.

**Contract**: `uv run pytest tests/test_deployment_parity.py -v` (with `MEVO_TEST_DATABASE_URL` set per `CLAUDE.md`). All tests must pass, including the production-mode cookie test (`test_cookie_attributes_in_production_response`).

#### 4. Run in-process auth suite

**File**: (no repo change; test command)

**Intent**: Confirm no regression in the broader in-process auth coverage.

**Contract**: `uv run pytest tests/test_auth.py -v`. All tests must pass.

#### 5. Record the atomic undo path

**File**: `context/changes/auth-session-fix/diagnostic-findings.md`

**Intent**: Append a final `## Applied Fix & Undo Path` section so anyone reading the change later knows exactly what was changed and how to revert in 30 seconds.

**Contract**: One short section. Names: file or env var changed, old value, new value, command to revert. This is purely documentation; the change itself was made in Phase 2.

### Success Criteria:

#### Automated Verification:

- `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts` exits 0 with 3 passes.
- `MEVO_SMOKE_BASE_URL="https://dailymevo.pl" uv run pytest tests/test_smoke.py -m smoke -v` exits 0.
- `uv run pytest tests/test_deployment_parity.py -v` exits 0.
- `uv run pytest tests/test_auth.py -v` exits 0.
- `diagnostic-findings.md` contains an `## Applied Fix & Undo Path` section.

#### Manual Verification:

- The user has visually confirmed the Playwright test 1 ("register → reload → still logged in") passes against prod — this is the literal issue #24 fix moment.
- The user has logged in via the browser on `https://dailymevo.pl` and reloaded the page, confirming the session survives in a real (non-test) flow.

**Implementation Note**: After completing this phase, pause for manual confirmation before running Phase 4's cleanup.

---

## Phase 4: Cleanup & close-out

### Overview

Remove test-user pollution from the prod DB, archive the diagnostic findings, and update `change.md`. This phase is purely housekeeping; nothing in it can revert the fix.

### Changes Required:

#### 1. Identify test-user rows in prod DB

**File**: (no repo change; one SQL query via SSH tunnel)

**Intent**: Count the rows that will be deleted before deleting them, per the "never guess" rule. Confirms the cleanup pattern matches only test data.

**Contract**: Open SSH tunnel to the prod DB (port per `RUNNING_TESTS.md:53-55` and the friendly-domain archive), then `SELECT count(*), email FROM users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'smoke-%@example.com' OR email LIKE 'parity-cookie-%@example.com' GROUP BY email;`. Verify every row is a test artifact (timestamp-suffixed `@example.com`) — no real users should match. Capture the count for the implementer to compare against the DELETE result.

#### 2. Delete test-user rows in prod DB

**File**: (no repo change; one SQL command via SSH tunnel)

**Intent**: Remove the test users so future admin views and reports are clean.

**Contract**: `DELETE FROM users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'smoke-%@example.com' OR email LIKE 'parity-cookie-%@example.com';` — affected row count must equal the count from the SELECT in step 1. If foreign-key constraints exist on `users` (e.g., favorites tied to user_id), the delete may need a CASCADE clause or a pre-delete of dependent rows — discuss with the user before forcing.

#### 3. Update change.md to complete

**File**: `context/changes/auth-session-fix/change.md`

**Intent**: Move the change out of `planned` and into `complete` (or whatever the project's terminal status is) so it's ready for archive on the next `/10x-archive` run. Today's date in `updated:`.

**Contract**: Frontmatter only — `status: complete`, `updated: <today>`. No body changes; the change.md narrative stays as the historical record.

#### 4. Note diagnostic-findings.md for archive

**File**: `context/changes/auth-session-fix/diagnostic-findings.md`

**Intent**: The findings log is the working evidence trail. It travels into the archive alongside `change.md`, `plan.md`, `plan-brief.md`, and `research.md` when this change is archived. No edit needed — just confirm it's complete.

**Contract**: File exists, has all 5 step sections, has `## Identified Root Cause`, and has `## Applied Fix & Undo Path`. No further action.

### Success Criteria:

#### Automated Verification:

- `SELECT count(*) FROM users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'smoke-%@example.com' OR email LIKE 'parity-cookie-%@example.com';` returns 0.
- `context/changes/auth-session-fix/change.md` frontmatter has `status: complete` and `updated: <today>`.
- `diagnostic-findings.md` contains both `## Identified Root Cause` and `## Applied Fix & Undo Path` sections.

#### Manual Verification:

- The user has seen the SELECT count before the DELETE and confirmed the delete is safe (no real users match).
- The DELETE row count equals the SELECT count.
- The user has run `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts` one final time after the cleanup, confirming the fix still holds end-to-end with a clean DB.

**Implementation Note**: After this phase, the change is ready for `/10x-archive auth-session-fix`.

---

## Testing Strategy

### Unit Tests:

- No new unit tests. The existing parity unit tests in `tests/test_deployment_parity.py:117-135` already enforce the cookie attribute contract. If Phase 2 doesn't touch cookie attribute derivation, these can't regress.

### Integration Tests:

- No new integration tests. `tests/test_deployment_parity.py:143-180` (`test_cookie_attributes_in_production_response`) is already the in-process integration guard for the production cookie shape. `tests/test_auth.py` covers full register/login/logout/persistence.

### Manual Testing Steps:

1. After Phase 2, log in manually on `https://dailymevo.pl` with any account, reload the page, and confirm the email is still visible — this is the literal user-facing experience of issue #24 being fixed.
2. Log out manually and confirm "Zaloguj się" reappears.
3. Repeat in a private/incognito window to confirm a fresh session also works.
4. After Phase 4's cleanup, run the Playwright suite against prod one final time to confirm the fix survives a DB with zero leftover test users.

## Performance Considerations

None expected. The fix is either a one-line config change or a one-line code change; cookie attribute derivation has no perf implications.

## Migration Notes

No data migration. The change does not alter the `users` table schema. Existing sessions issued before the fix may have different cookie attributes — they will continue to work until they expire (30 days per `jwt_lifetime_seconds`); new sessions issued after the fix get the corrected attributes. Users who hit issue #24 mid-session will simply log in again and get a working session.

## References

- Research: `context/changes/auth-session-fix/research.md`
- Change brief: `context/changes/auth-session-fix/change.md`
- Roadmap row: `context/foundation/roadmap.md:38,162-174` (B-01)
- Prior parity decisions: `context/archive/2026-06-19-testing-deployment-parity/plan.md:44` (cookie_domain=None is correct), `context/archive/2026-06-19-testing-deployment-parity/research.md:194-202` (open questions at archive time)
- Cloudflare topology: `context/archive/2026-06-13-friendly-domain/plan.md:5,9-10,49-53`
- Test contract sources: `tests/test_deployment_parity.py:117-180`, `e2e/auth-session.spec.ts:53-74`, `tests/test_smoke.py:56-71`
- Configuration sources: `app/auth/config.py:14-19`, `app/config.py:5,27`, `app/main.py:200-207`
- Documented test commands: `context/RUNNING_TESTS.md:53-55,78-85,148-149`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Diagnostic sequence

#### Automated

- [x] 1.1 diagnostic-findings.md exists with all 5 step sections
- [x] 1.2 `## Identified Root Cause` OR `## STOP — Out of Scope` section is present at the bottom of the findings log

#### Manual

- [x] 1.3 Step 0's SSH output is in the findings log and `MEVO_ENVIRONMENT`'s value (or absence) is recorded
- [x] 1.4 Step 1's curl output includes the full `Set-Cookie:` line and the user has eyeballed it against the locked contract
- [x] 1.5 Step 2's Playwright run completed (pass or fail captured) — the user has read the cookie object the test reports
- [x] 1.6 The implementer paused after each step where the output was unexpected and discussed with the user before proceeding
- [x] 1.7 The root cause / scope-stop decision has been explicitly confirmed with the user before moving to Phase 2

### Phase 2: Apply identified fix

#### Automated

- [x] 2.1 For env var change: `curl https://dailymevo.pl/health` returns 200 after restart
- [ ] 2.2 For code change: `uv run ruff check .` passes; `uv run mypy .` passes; the diff is one logical change — N/A (Cloudflare setting, not code change)

#### Manual

- [x] 2.3 The change made is the one the findings log names — nothing else was modified opportunistically
- [x] 2.4 The atomic-undo path is recorded in `diagnostic-findings.md`
- [x] 2.5 The user has acknowledged the change and the undo path before Phase 3 verification runs

### Phase 3: Verify against the full test contract

#### Automated

- [x] 3.1 `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts` exits 0 with 3 passes
- [x] 3.2 `MEVO_SMOKE_BASE_URL="https://dailymevo.pl" uv run pytest tests/test_smoke.py -m smoke -v` exits 0
- [x] 3.3 `uv run pytest tests/test_deployment_parity.py -v` exits 0
- [x] 3.4 `uv run pytest tests/test_auth.py -v` exits 0
- [x] 3.5 `diagnostic-findings.md` contains an `## Applied Fix & Undo Path` section

#### Manual

- [x] 3.6 The user has visually confirmed Playwright test 1 ("register → reload → still logged in") passes against prod
- [x] 3.7 The user has logged in via the browser on `https://dailymevo.pl` and reloaded the page, confirming the session survives in a real flow

### Phase 4: Cleanup & close-out

#### Automated

- [x] 4.1 `SELECT count(*) FROM users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'smoke-%@example.com' OR email LIKE 'parity-cookie-%@example.com';` returns 0
- [x] 4.2 `context/changes/auth-session-fix/change.md` frontmatter has `status: complete` and `updated: <today>`
- [x] 4.3 `diagnostic-findings.md` contains both `## Identified Root Cause` and `## Applied Fix & Undo Path` sections

#### Manual

- [x] 4.4 The user has seen the SELECT count before the DELETE and confirmed the delete is safe (no real users match)
- [x] 4.5 The DELETE row count equals the SELECT count
- [x] 4.6 The user has run `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts` one final time after cleanup, confirming the fix holds with a clean DB
