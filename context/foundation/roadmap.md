---
project: MevoStats
version: 1
status: draft
created: 2026-06-04
updated: 2026-06-20
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: MevoStats

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Mevo bike commuters in Tricity (Gdańsk / Gdynia / Sopot) have no way to see historical availability patterns for their stations — the Mevo app shows only real-time state. MevoStats collects station snapshots every 5 minutes via the public Mevo Open Data API and surfaces average availability by day-of-week and 15-minute timeslot, turning a free, untapped data stream into a commuter planning tool. The product hypothesis is that this historical view is genuinely useful — that commuters will check it before leaving home.

## North star

**S-01: Visitor sees station availability patterns** — the smallest end-to-end flow that proves the product works. A visitor searches for a station and sees a chart of average bike availability by day-of-week, built from real collected data. If this doesn't help commuters plan, accounts and favourites don't matter.

> "North star" here means: the single slice whose successful delivery proves the core product hypothesis. It is placed as early as Prerequisites allow because everything downstream only matters if this works.

## At a glance

| ID   | Change ID                 | Outcome (user can …)                                            | Prerequisites | PRD refs                                          | Status   |
| ---- | ------------------------- | --------------------------------------------------------------- | ------------- | ------------------------------------------------- | -------- |
| F-01 | data-collection-pipeline  | (foundation) Schema + 5-min collector accumulating station data | —             | FR-001, FR-002                                    | done     |
| F-02 | basic-observability       | (foundation) Structured logging + error tracking active         | —             | NFR §data-freshness, NFR §page-load               | done     |
| F-03 | cicd-pipeline             | (foundation) GitHub Actions auto-deploy on merge                | —             | tech-stack §CI                                    | done     |
| S-01 | station-availability-page | Visitor sees station availability chart by day-of-week          | F-01, F-02    | US-01, FR-001, FR-002, FR-003, FR-004, FR-006, FR-007 | done     |
| E-01 | data-pipeline-performance | Station sync <10s, aggregation optimized for table growth       | F-01          | FR-001, FR-002, NFR §data-freshness               | done     |
| S-02 | user-auth                 | Visitor can register, log in, and log out                       | S-01, F-03    | FR-008, FR-009                                    | done     |
| B-01 | auth-session-fix          | Auth session persists after login on production domain          | S-02          | FR-008, FR-009                                    | done     |
| B-02 | db-storage-fix            | Supabase DB back under 0.5GB free plan limit                    | F-01          | NFR §data-freshness                               | done     |
| S-03 | favourites-dashboard      | Registered user manages favourites on a personal dashboard      | S-01, S-02    | US-02, FR-010, FR-011, FR-012                     | done     |
| B-06 | fav-cards-polish-ui       | Favourite cards have uniform height and correct Polish bike labels | S-03        | FR-010, FR-011                                    | done     |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme         | Chain                            | Note                                                                        |
| ------ | ------------- | -------------------------------- | --------------------------------------------------------------------------- |
| A      | Core product  | `F-01` → `S-01` → `S-02` → `S-03` | Must-have path to the north star (S-01) and beyond; speed-biased ordering |
| B      | Observability | `F-02`                           | Joins Stream A at `S-01` — production monitoring before stats ship          |
| C      | Deployment    | `F-03`                           | Joins Stream A at `S-02` — automated deploy before auth ships               |
| D      | Performance   | `E-01`                           | Branches from `F-01` — pipeline perf before data volume becomes a problem   |

## Baseline

What's already in place in the codebase as of 2026-06-04 (auto-researched + user-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** absent — no UI framework, no build tooling, no component files
- **Backend / API:** partial — FastAPI stub with single `/health` endpoint (`main.py:42`)
- **Data:** partial — asyncpg pool created (`main.py:26-28`), no schema or migrations, no seeded data
- **Auth:** absent — Supabase credentials configured but no auth code
- **Deploy / infra:** partial — `Dockerfile` + `docker-compose.yml` + `deploy.sh` present, no CI/CD workflows
- **Observability:** absent — no logging, error tracking, metrics, or middleware

## Foundations

### F-01: Data collection pipeline

- **Outcome:** (foundation) Mevo station and snapshot tables created in PostgreSQL; automated 5-min collector deployed, fetching and storing real availability data from the Mevo Open Data API
- **Change ID:** data-collection-pipeline
- **PRD refs:** FR-001, FR-002
- **Unlocks:** S-01 (station availability page — north star)
- **Prerequisites:** —
- **Parallel with:** F-02, F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mevo API format is undocumented beyond the endpoint URL; collector must handle transient API failures and format changes. Sequenced first because the collector needs wall-clock time to accumulate meaningful historical data.
- **Status:** done

### F-02: Basic observability

- **Outcome:** (foundation) Structured logging and error tracking active across FastAPI app and data collector; production issues surface in logs without manual debugging
- **Change ID:** basic-observability
- **PRD refs:** NFR §data-freshness ("most recent snapshot no older than 1 hour"), NFR §page-load ("under 3 seconds on 4G")
- **Unlocks:** S-01 (verifies collector health and data freshness in production)
- **Prerequisites:** —
- **Parallel with:** F-01, F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Over-engineering observability delays the must-have path; must stay minimal — structured logging + basic error reporting, not a full monitoring stack.
- **Status:** done

### F-03: CI/CD pipeline

- **Outcome:** (foundation) GitHub Actions workflow triggers build, deploy, and health-check on merge to main; deployment is automated and repeatable
- **Change ID:** cicd-pipeline
- **PRD refs:** tech-stack §CI (github-actions, auto-deploy-on-merge)
- **Unlocks:** S-02 (automated deployment before auth ships — manual deploy errors with user account state are costly to roll back)
- **Prerequisites:** —
- **Parallel with:** F-01, F-02, S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mikr.us deployment via SSH/API is non-standard; CI/CD must work with the `/exec` API or SSH-based deploy script from `deploy.sh`.
- **Status:** done

## Slices

### S-01: Station availability page

- **Outcome:** visitor can search for a Mevo station by name, open its detail page, and see a chart of average bike availability by 15-minute timeslot for any day of the week, with reliability labels and day-part grouping
- **Change ID:** station-availability-page
- **PRD refs:** US-01, FR-001, FR-002, FR-003, FR-004, FR-006, FR-007
- **Prerequisites:** F-01, F-02
- **Parallel with:** F-03
- **Blockers:** —
- **Unknowns:**
  - Reliability label thresholds (avg ≥ 2 = reliable, avg 1–2 = uncertain, avg < 1 = typically empty — or different?) — Owner: user. Block: no.
  - Minimum snapshot threshold before showing a chart vs. "data still collecting" — Owner: user. Block: no.
  - Day-part hour boundaries (6–12 / 12–18 / 18–22 / 22–6 or different?) — Owner: user. Block: no.
- **Risk:** Largest slice in the roadmap — includes frontend scaffold (React/Vite), API endpoints, aggregation logic, and chart rendering. Frontend is the unfamiliar layer for this developer. Sequenced as the north star because the product hypothesis lives or dies here.
- **Status:** done

### E-01: Data pipeline performance

- **Outcome:** station sync completes in under 10 seconds consistently (down from 46–200s); aggregation query is optimized for growing snapshots table to prevent degradation over months of data accumulation
- **Change ID:** data-pipeline-performance
- **PRD refs:** FR-001, FR-002, NFR §data-freshness
- **Prerequisites:** F-01
- **Parallel with:** F-03, S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** E-03 (sync optimization) is medium priority and affects every 5-min cycle; E-04 (aggregation optimization) is low priority — monitor query duration via Logfire first. Both must preserve data correctness and idempotency. Memory budget: 768MB total container on Mikr.us.
- **GitHub issues:** #14 (E-03), #15 (E-04)
- **Status:** done

### S-02: User registration and login

- **Outcome:** visitor can register an account with email and password, log in, and log out
- **Change ID:** user-auth
- **PRD refs:** FR-008, FR-009
- **Prerequisites:** S-01, F-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Auth implementation can expand unboundedly (email verification, password reset, rate limiting); must be kept to the minimum viable for v1 — registration, login, logout, token-based sessions.
- **Status:** done

### B-02: Supabase DB storage fix

- **Outcome:** Production DB storage back under Supabase 0.5GB free plan limit with a sustainable retention policy
- **Change ID:** db-storage-fix
- **PRD refs:** NFR §data-freshness
- **Prerequisites:** F-01
- **Blockers:** —
- **Unknowns:**
  - Which table/index is the biggest consumer (likely `snapshots`)
  - Whether Supabase counts WAL/system catalogs toward the limit
- **Risk:** Deleting old snapshots could break aggregation if the watermark references purged rows. Retention policy must coordinate with the aggregation window.
- **GitHub issue:** #25
- **Related:** Issue #11 (snapshot retention policy review)
- **Status:** done

### B-01: Auth session persistence fix

- **Outcome:** Logged-in user stays logged in across page navigations on the production domain (dailymevo.pl)
- **Change ID:** auth-session-fix
- **PRD refs:** FR-008, FR-009
- **Prerequisites:** S-02
- **Blockers:** S-03 (favourites require working auth sessions)
- **Root cause:** Cloudflare "Always Use HTTPS" was OFF. Users arriving via `http://dailymevo.pl` stayed on HTTP. The `Secure` cookie was set but Chrome refused to send it on HTTP requests → 401 on `/api/v1/users/me`. Fix: toggled "Always Use HTTPS" ON in Cloudflare Dashboard.
- **Acceptance test:** `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts` — all 3 tests pass against production.
- **GitHub issue:** #24
- **Status:** done (2026-06-20)

### S-03: Favourites and personal dashboard

- **Outcome:** registered user can add a station to favourites, remove it, and view all favourited stations on a personal dashboard with quick-view availability and direct links to station detail pages
- **Change ID:** favourites-dashboard
- **PRD refs:** US-02, FR-010, FR-011, FR-012
- **Prerequisites:** S-01, S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Dashboard scope can creep beyond a favourites list; must stay minimal — list of favourited stations with links to detail pages and a remove button.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                 | Suggested issue title                                | Ready for `/10x-plan` | Notes                                          |
| ---------- | ------------------------- | ---------------------------------------------------- | --------------------- | ---------------------------------------------- |
| F-01       | data-collection-pipeline  | Set up Mevo station schema and 5-min data collector  | —                     | ✅ Implemented 2026-06-05                       |
| F-02       | basic-observability       | Add structured logging and error tracking            | —                     | ✅ Implemented 2026-06-05                       |
| F-03       | cicd-pipeline             | Set up GitHub Actions auto-deploy on merge           | —                     | ✅ Implemented 2026-06-19                       |
| S-01       | station-availability-page | Station search and availability chart page           | —                     | ✅ Implemented 2026-06-05                       |
| E-01       | data-pipeline-performance | Optimize station sync and aggregation query          | —                     | ✅ Implemented 2026-06-13                       |
| S-02       | user-auth                 | User registration and login                          | —                     | ✅ Implemented 2026-06-13                       |
| B-01       | auth-session-fix          | Auth session not persisting after login on production | —                     | ✅ Fixed 2026-06-20 (Cloudflare HTTPS redirect) |
| B-02       | db-storage-fix            | Supabase DB exceeding 0.5GB free plan limit           | —                     | ✅ Implemented 2026-06-19                       |
| S-03       | favourites-dashboard      | Favourites and personal dashboard                    | —                     | ✅ Implemented 2026-06-20                       |
| B-06       | fav-cards-polish-ui       | Favourite cards — uniform height, Polish bike labels | —                     | ✅ Implemented 2026-06-21                       |

## Open Roadmap Questions

1. **Admin panel delivery mechanism:** Should operational access (sync status, data health, DB state) be a web admin role in the app itself, or handled via direct backend tooling (Supabase dashboard + server logs)? Owner: user. Block: roadmap-wide (deferred — can decide before auth is built).
2. **Reliability label thresholds:** What average bike counts map to reliable / uncertain / typically empty? E.g., avg ≥ 2 = reliable, avg 1–2 = uncertain, avg < 1 = typically empty. Owner: user. Block: S-01 (non-blocking — sensible defaults can be chosen at build time and tuned after first data).
3. **Minimum snapshot threshold for display:** How many snapshots must exist for a given station × slot before showing a chart (vs. "data still collecting")? Owner: user. Block: S-01 (non-blocking — default can be chosen at build time).
4. **Day-part definitions:** Morning / afternoon / evening / night — what are the exact hour boundaries? Owner: user. Block: S-01 (non-blocking — 6–12 / 12–18 / 18–22 / 22–6 is a reasonable default).

## Parked

- **Interactive map view (FR-005)** — Why parked: nice-to-have per PRD; list + search is the must-have discovery path.
- **Personal ride data (FR-013–016)** — Why parked: explicitly deferred to v2 per PRD.
- **Mobile app** — Why parked: PRD §Non-Goals; responsive web is the mobile experience for v1.
- **Real-time notifications / alerts** — Why parked: PRD §Non-Goals; historical pattern analysis only.
- **Social / sharing features** — Why parked: PRD §Non-Goals; single-user value first.
- **Multi-city support** — Why parked: PRD §Non-Goals; Mevo / Tricity only until single-city case is validated.
- **Offline-first guarantee** — Why parked: PRD §Non-Goals; standard web app, not a priority for a data-display product.

## Done

- **F-01: Data collection pipeline** — Schema + 5-min collector deployed 2026-06-05. 827 stations synced, snapshots collecting every 5 min. Commits: `fbb6edc`..`02c9726`.
- **F-02: Basic observability** — Structured logging (structlog) and tracing (Logfire) deployed 2026-06-05. JSON logs in production, request correlation IDs, collector span tracing, health endpoint with data freshness monitoring. Commits: `b46230b`..`6cc54ae`.
- **S-01: Station availability page** — North star feature deployed 2026-06-05. Full-stack: aggregation table + hourly job, REST API (stations, geocode, nearby), React/Vite frontend with heatmap, search (station number + address), station detail with day-part breakdown. Commits: `d805010`..`960efc3`.
- **E-01: Data pipeline performance** — Deployed 2026-06-13. Station sync replaced per-row INSERT with unnest-based bulk upsert (one SQL round-trip). Aggregation rewritten to incremental processing with watermark and weighted average merges. Commits: `481ecdc`..`dfd21bf`.
- **S-02: User registration and login** — Merged 2026-06-13. Backend auth with fastapi-users (JWT bearer tokens), Alembic user migration, frontend login/register pages with auth header controls. Includes auth endpoint tests. Commits: `2401447`..`3da66fe`.
- **F-03: CI/CD pipeline** — Deployed 2026-06-19. GitHub Actions CI with parallel backend (ruff, mypy, pytest + Postgres 16) and frontend (eslint, tsc, vitest, build) jobs. Auto-deploy to Mikr.us on merge to main with health check and post-deploy smoke tests. Pre-commit hooks (ruff + related-tests). Claude Code post-edit lint hooks. Commits: `bfc7be0`..`295b202`.
- **B-02: Supabase DB storage fix** — Deployed 2026-06-19. 7-day snapshot retention via daily APScheduler job (batch DELETE bounded by aggregation watermark), DB size monitoring every 6h with ntfy.sh alerts (400 MB warning, 450 MB critical), `db_size_log` tracking table. Initial purge: 1.8M rows deleted, VACUUM FULL reclaimed 263 MB (624→361 MB). Commits: `74abe75`..`691a283`.
- **B-01: Auth session persists after login on production domain** — Archived 2026-06-20 → `context/archive/2026-06-19-auth-session-fix/`. Lesson: —.
- **S-03: Favourites and personal dashboard** — Implemented 2026-06-20. Favourite toggle on station detail, favourites card grid on homepage with current-slot availability, fallback to popular stations. Backend: migration + 3 API endpoints + integration tests. Frontend: API client, hook, components, unit tests. E2E: Playwright lifecycle tests. Commits: `55cade0`..`db42b44`.
- **B-05: Favourite card availability mismatch** — Fixed 2026-06-20. `_current_slot()` was computing slot in UTC; aggregation stores slots in Warsaw time. Fixed by replacing `datetime.now(timezone.utc)` with `datetime.now(ZoneInfo(WARSAW_TZ))`. Also: extracted `WARSAW_TZ` constant to `app/config.py` as shared source of truth. Commits: `6603c84`..`419cebc`.
- **B-06: Favourite cards polish UI** — Implemented 2026-06-21. Removed broken `formatAvailability` helper; imported `bikesLabel`/`ebikesLabel` from `polish.ts` for correct Polish noun declension; two-row layout (e-bikes first, bikes second); dropped `≈` prefix and reliability label; added `h-full flex flex-col` to Link for uniform card height. Commit: `af9be40`.
