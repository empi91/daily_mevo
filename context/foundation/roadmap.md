---
project: MevoStats
version: 1
status: draft
created: 2026-06-04
updated: 2026-06-04
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
| F-03 | cicd-pipeline             | (foundation) GitHub Actions auto-deploy on merge                | —             | tech-stack §CI                                    | ready    |
| S-01 | station-availability-page | Visitor sees station availability chart by day-of-week          | F-01, F-02    | US-01, FR-001, FR-002, FR-003, FR-004, FR-006, FR-007 | ready    |
| S-02 | user-auth                 | Visitor can register, log in, and log out                       | S-01, F-03    | FR-008, FR-009                                    | proposed |
| S-03 | favourites-dashboard      | Registered user manages favourites on a personal dashboard      | S-01, S-02    | US-02, FR-010, FR-011, FR-012                     | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme         | Chain                            | Note                                                                        |
| ------ | ------------- | -------------------------------- | --------------------------------------------------------------------------- |
| A      | Core product  | `F-01` → `S-01` → `S-02` → `S-03` | Must-have path to the north star (S-01) and beyond; speed-biased ordering |
| B      | Observability | `F-02`                           | Joins Stream A at `S-01` — production monitoring before stats ship          |
| C      | Deployment    | `F-03`                           | Joins Stream A at `S-02` — automated deploy before auth ships               |

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
- **Status:** ready

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
- **Status:** ready

### S-02: User registration and login

- **Outcome:** visitor can register an account with email and password, log in, and log out
- **Change ID:** user-auth
- **PRD refs:** FR-008, FR-009
- **Prerequisites:** S-01, F-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Auth implementation can expand unboundedly (email verification, password reset, rate limiting); must be kept to the minimum viable for v1 — registration, login, logout, token-based sessions.
- **Status:** proposed

### S-03: Favourites and personal dashboard

- **Outcome:** registered user can add a station to favourites, remove it, and view all favourited stations on a personal dashboard with quick-view availability and direct links to station detail pages
- **Change ID:** favourites-dashboard
- **PRD refs:** US-02, FR-010, FR-011, FR-012
- **Prerequisites:** S-01, S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Dashboard scope can creep beyond a favourites list; must stay minimal — list of favourited stations with links to detail pages and a remove button.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                 | Suggested issue title                                | Ready for `/10x-plan` | Notes                                          |
| ---------- | ------------------------- | ---------------------------------------------------- | --------------------- | ---------------------------------------------- |
| F-01       | data-collection-pipeline  | Set up Mevo station schema and 5-min data collector  | —                     | ✅ Implemented 2026-06-05                       |
| F-02       | basic-observability       | Add structured logging and error tracking            | —                     | ✅ Implemented 2026-06-05                       |
| F-03       | cicd-pipeline             | Set up GitHub Actions auto-deploy on merge           | yes                   | Planned for ~2026-06-09 per user               |
| S-01       | station-availability-page | Station search and availability chart page           | yes                   | All prerequisites met, run `/10x-plan station-availability-page` |
| S-02       | user-auth                 | User registration and login                          | no                    | Depends on S-01, F-03                          |
| S-03       | favourites-dashboard      | Favourites and personal dashboard                    | no                    | Depends on S-01, S-02                          |

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
