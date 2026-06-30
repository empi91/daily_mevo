# Station Availability Page — Plan Brief

> Full plan: `context/changes/station-availability-page/plan.md`

## What & Why

Build the north star feature (S-01): a full-stack station availability page where visitors can search for a Mevo station (by station number or address), open its detail page, and see a heatmap of average bike availability by 15-minute timeslot across all days of the week. This is the feature that validates the product hypothesis — that historical availability patterns are genuinely useful for Tricity commuters planning their departure.

## Starting Point

Backend is operational: FastAPI app with asyncpg, 827 stations synced, snapshots collecting every 5 minutes since 2026-06-05. Database has `stations` and `snapshots` tables. Only one endpoint exists (`/health`). No aggregation logic, no API endpoints, no frontend code whatsoever — React/Vite needs to be scaffolded from scratch.

## Desired End State

A visitor opens the site, searches by station number (real-time client-side filtering) or address (Nominatim geocoding → 3-5 nearest stations), opens a station detail page, and sees a color-coded heatmap (Mon–Sun × 5:00–23:00) with reliability labels (green ≥6 bikes, yellow 2-5, red ≤1). They can drill into day-parts (Morning/Afternoon/Evening/Night) for 15-min detail. Stations with insufficient data show an explanatory notice. Everything served from a single Docker container on Mikr.us.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Frontend location | `frontend/` subdirectory | Simplest for solo dev — one repo, one deploy script |
| Language | TypeScript | Catches API contract mismatches at build time, matches typed backend philosophy |
| Styling | Tailwind CSS | Fast to build, consistent look, small bundle |
| Routing | React Router (SPA) | Standard approach, 2-3 routes don't justify SSR complexity |
| Data fetching | TanStack Query | De facto standard; handles caching, loading/error states out of the box |
| Chart library | Recharts | Simple API, good docs, most popular React chart lib |
| Chart type | Heatmap grid (7 days × timeslots) | Shows entire week at a glance — user spots patterns instantly |
| Day-parts | Collapsible sections (6–12 / 12–18 / 18–22 / 22–6) | Clean default with drill-down; matches PRD day-part bucketing spec |
| Aggregation | Pre-aggregated table, hourly job | Avoids expensive on-the-fly queries on growing snapshots data |
| Search (station number) | All stations loaded client-side | Instant filtering on every keystroke, 827 stations ≈ 50-80KB |
| Search (address) | Nominatim geocoding → nearby stations | Free, no API key, sufficient accuracy for Tricity |
| API structure | RESTful under `/api/v1/` | Clean separation from frontend routes, versioned |
| Reliability thresholds | ≥6 reliable, 2-5 uncertain, ≤1 empty | Higher bar than PRD default — avg 2 bikes can mean 0 on arrival due to variance |
| Min data threshold | ~2 weeks (8 samples), graceful empty state from day one | Data collection just started; proper handling for sparse data is essential |
| Serving | FastAPI serves built frontend (StaticFiles) | Single container, no proxy config, simplest Mikr.us deployment |
| Time range | Active hours only (5:00–23:00) | Cleaner heatmap — 72 slots vs 96; overnight is near-zero usage |

## Scope

**In scope:** Pre-aggregated availability table, hourly aggregation job, station list/detail/geocode/nearby API endpoints, React/Vite frontend scaffold, homepage with dual-mode search (station number + address), station detail page with heatmap + day-part detail, reliability labels, empty state handling, Docker deployment integration

**Out of scope:** User accounts/auth/favourites (S-02, S-03), interactive map (FR-005), real-time availability, CI/CD pipeline (F-03), SSR/Next.js, custom domain/TLS, mobile app

## Architecture / Approach

Bottom-up build: database aggregation → API endpoints → frontend scaffold → homepage/search → station detail page → deployment integration. The backend adds a `station_availability` table populated hourly by APScheduler, and exposes RESTful endpoints under `/api/v1/`. The frontend is a React SPA (Vite + TypeScript + Tailwind) that fetches all stations on load for instant search, uses Nominatim via a backend proxy for address geocoding, and renders availability as a Recharts heatmap. In production, FastAPI serves the built frontend as static files from a single Docker container.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DB: Aggregation table & job | Pre-computed availability stats, hourly refresh | Aggregation query performance on growing data |
| 2. Backend: API endpoints | Station list, detail, geocode, nearby search | Nominatim reliability / rate limiting |
| 3. Frontend: Scaffold | React/Vite/TS/Tailwind/Router/Query foundation | First-time React/TS setup for this project |
| 4. Frontend: Homepage & search | Dual-mode search, popular stations | Address geocoding UX (latency, accuracy) |
| 5. Frontend: Station detail | Heatmap, day-parts, reliability labels, empty state | Heatmap rendering with sparse initial data |
| 6. Deployment integration | Docker multi-stage build, FastAPI static serving | Memory limit (768MB) with Node.js build stage |

**Prerequisites:** F-01 (data collection) ✅ done, F-02 (observability) ✅ done
**Estimated effort:** ~4-5 sessions across 6 phases

## Open Risks & Assumptions

- Data collection started 2026-06-05 — initial heatmaps will be mostly gray (insufficient data); the empty state UX must be solid from day one
- Nominatim free tier is rate-limited to 1 req/sec — frontend debouncing at 300ms should suffice, but heavy concurrent usage could hit limits
- Recharts heatmap may require custom cell rendering (not a built-in chart type) — may need a custom grid component instead
- 768MB Docker memory limit must accommodate Node.js build stage (build-only, not in final image) and Python runtime
- Popular stations are hardcoded for MVP — needs a heuristic or admin control later

## Success Criteria (Summary)

- A visitor can search for any station by number (real-time) or address (nearest stations) and reach its detail page
- The station detail page shows a color-coded heatmap of average bike availability across the week, with reliability labels and day-part drill-down
- Stations with insufficient data show an explanatory notice, not broken charts
