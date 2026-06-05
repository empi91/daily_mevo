# Station Availability Page — Implementation Plan

## Overview

Build the north star feature (S-01): a full-stack station availability page where visitors can search for a Mevo station (by station number or address), open its detail page, and see a heatmap of average bike availability by 15-minute timeslot across all days of the week. This is the feature that validates the product hypothesis — that historical availability patterns are genuinely useful for commuter planning.

## Current State Analysis

- **Backend**: FastAPI app with asyncpg pool, APScheduler running 5-min snapshot collection, 827 active stations, `/health` endpoint only
- **Database**: `stations` (station_id TEXT PK, name, address, lat, lon, capacity, is_virtual, is_active) and `snapshots` (station_id FK, collected_at, bikes_available, ebikes_available, docks_available, is_installed, is_renting, is_returning) tables with indices on `(station_id, collected_at)` and `(collected_at)`
- **Frontend**: completely absent — no React, no Vite, no package.json, no UI code
- **Aggregation**: no pre-computed stats, no views, no aggregation queries
- **Deployment**: Docker on Mikr.us, 768MB RAM limit, single container via docker-compose

### Key Discoveries:

- Stations table already has lat/lon — spatial distance calculation for address search is possible without schema changes
- APScheduler already runs two jobs (station_sync every 24h, snapshot_collection every 5min) — adding an hourly aggregation job follows the established pattern
- `app/collector/` module pattern (models, client, sync, collector) provides a template for structuring new backend modules
- Data collection started 2026-06-05 — initial data will be sparse; robust empty-state handling is required from day one
- Mikr.us has 768MB RAM — frontend build happens in Docker multi-stage, not at runtime; Node.js is build-only

## Desired End State

A visitor opens the MevoStats site and sees a search-first homepage with two search modes: station number (real-time client-side filtering as they type) and address (geocoded via Nominatim to find 3-5 nearest stations). They select a station and land on its detail page, which shows a color-coded heatmap grid (7 rows for Mon–Sun × timeslots from 5:00–23:00) with reliability labels (green = ≥6 bikes reliable, yellow = 2-5 uncertain, red = ≤1 empty). Below the heatmap, day-part sections (Morning 6–12, Afternoon 12–18, Evening 18–22, Night 22–6) can be expanded to see 15-min slot detail for a selected day. Stations with insufficient data show an explanatory "data still collecting" notice. The entire frontend is served by FastAPI from a built `frontend/dist/` directory inside the same Docker container.

### Verification:

- Visit the homepage, search by station number (e.g., "GD") — see matching stations in real-time
- Search by address (e.g., "Grunwaldzka 100 Gdańsk") — see 3-5 nearest stations with distances
- Open a station detail page — see heatmap with color-coded cells
- Switch between days via tab row — heatmap row highlights, detail view updates
- Expand a day-part section — see 15-min slot breakdown
- Visit a station with no data — see "data still collecting" notice
- `GET /api/v1/stations` returns all active stations as JSON
- `GET /api/v1/stations/{station_id}/stats` returns aggregated availability
- `GET /api/v1/geocode?q=address` returns lat/lon from Nominatim
- `GET /api/v1/stations/nearby?lat=X&lon=Y` returns 3-5 nearest stations

## What We're NOT Doing

- No user accounts, auth, or favourites (S-02 and S-03 — separate slices)
- No interactive map view (FR-005 — parked, nice-to-have)
- No real-time availability display (this is historical patterns only)
- No SSR/Next.js — React SPA served as static files
- No CI/CD pipeline setup (F-03 — separate slice, parallel work)
- No mobile app — responsive web only
- No custom domain or TLS setup beyond existing Mikr.us `*.wykr.es`

## Implementation Approach

Six phases building bottom-up: database aggregation → API endpoints → frontend scaffold → homepage/search → station detail page → deployment integration. Each phase is independently testable. The frontend scaffold (Phase 3) can start in parallel with Phases 1-2 since it has no backend dependency.

## Critical Implementation Details

### Timing & lifecycle

The hourly aggregation job must be added to APScheduler in `app/main.py` lifespan, following the exact pattern of the existing `run_station_sync` and `run_snapshot_collection` jobs. It should NOT run at startup (unlike station sync) — the first run triggers after 1 hour. This avoids a heavy aggregation query during app startup on a memory-constrained VPS.

### Performance constraints

The aggregation query processes all historical snapshots (growing by ~240K rows/day at 827 stations × 288 snapshots). The pre-aggregated table must be the only source for the stats API endpoint — never run the raw aggregation at request time. The hourly job uses `INSERT ... ON CONFLICT UPDATE` to be idempotent and restartable.

---

## Phase 1: Database — Aggregation Table & Hourly Job

### Overview

Create the `station_availability` pre-aggregated table and an hourly APScheduler job that computes average bike counts per station per 15-minute timeslot per day-of-week from raw snapshots.

### Changes Required:

#### 1. Aggregation table migration

**File**: `alembic/versions/003_create_station_availability.py`

**Intent**: Create a table to store pre-computed averages that the stats API reads directly. This replaces expensive on-the-fly GROUP BY queries on the growing snapshots table.

**Contract**: Migration `003`, revises `002`. Table `station_availability` with columns: `station_id TEXT NOT NULL REFERENCES stations(station_id)`, `day_of_week SMALLINT NOT NULL` (0=Monday … 6=Sunday, ISO convention), `time_slot TIME NOT NULL` (e.g., '07:15:00'), `avg_bikes DOUBLE PRECISION NOT NULL DEFAULT 0`, `avg_ebikes DOUBLE PRECISION NOT NULL DEFAULT 0`, `sample_count INTEGER NOT NULL DEFAULT 0`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Primary key: `(station_id, day_of_week, time_slot)`. Index on `(station_id)` for station detail queries.

#### 2. Aggregation module

**File**: `app/aggregation.py`

**Intent**: Async function that queries all snapshots grouped by station_id, day-of-week, and 15-minute timeslot, then upserts the results into `station_availability`. Called by the hourly APScheduler job.

**Contract**: `async def aggregate_availability(pool: asyncpg.Pool) -> int` — returns number of rows upserted. Uses a single SQL query with `date_trunc` for 15-min bucketing and `EXTRACT(ISODOW ...)` for day-of-week. Upserts via `INSERT INTO station_availability ... SELECT ... FROM snapshots GROUP BY ... ON CONFLICT (station_id, day_of_week, time_slot) DO UPDATE SET avg_bikes = EXCLUDED.avg_bikes, ...`.

#### 3. Scheduler integration

**File**: `app/main.py`

**Intent**: Add an hourly APScheduler job that calls `aggregate_availability`, following the same pattern as the existing `run_station_sync` and `run_snapshot_collection` jobs.

**Contract**: New job `aggregation` with `"interval", hours=1` schedule. Wraps call in structlog context + logfire span, same as existing jobs. Does NOT run at startup — first run after 1 hour.

#### 4. Config: reliability thresholds

**File**: `app/config.py`

**Intent**: Add configurable thresholds for reliability labels so they can be tuned without code changes.

**Contract**: Three new settings on `Settings`: `reliability_threshold_reliable: int = 6`, `reliability_threshold_uncertain: int = 2`, `min_sample_count: int = 8` (minimum samples before showing data — ~2 weeks at 4 snapshots per slot per week). All prefixed with `MEVO_`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `uv run alembic upgrade head`
- Aggregation function runs without error on existing data: manual call in test
- Type checking passes: `uv run mypy .`
- Linting passes: `uv run ruff check .`

#### Manual Verification:

- Query `station_availability` after aggregation runs — rows exist with plausible avg_bikes values
- Scheduler logs show aggregation job completing hourly
- Config thresholds are respected (change env var, verify behavior)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Backend — API Endpoints

### Overview

Create FastAPI router with endpoints for station list, station detail, availability stats, geocoding proxy, and nearby station search. All endpoints under `/api/v1/`.

### Changes Required:

#### 1. Station API router

**File**: `app/api/__init__.py`, `app/api/stations.py`

**Intent**: Create a FastAPI APIRouter with station endpoints. Follows the `app/collector/` module pattern — dedicated directory for API concerns.

**Contract**:
- `GET /api/v1/stations` — returns all active stations (id, name, address, lat, lon, capacity). Response model: `list[StationResponse]`. No pagination (827 rows, client-side filtering).
- `GET /api/v1/stations/{station_id}` — returns single station detail + availability stats. Response model: `StationDetailResponse` containing station metadata + `availability: list[AvailabilitySlot]` (day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count, reliability_label). Returns 404 if station_id not found.
- Pydantic response models in `app/api/models.py`.

#### 2. Geocoding proxy endpoint

**File**: `app/api/geocode.py`

**Intent**: Proxy Nominatim geocoding requests to avoid CORS issues and control rate limiting. The frontend calls our backend, which calls Nominatim.

**Contract**:
- `GET /api/v1/geocode?q=address_string` — forwards to Nominatim `search` endpoint with `format=json&limit=1&countrycodes=pl`, returns `{lat, lon, display_name}` or 404. Uses existing `httpx` dependency (already in pyproject.toml for GBFS client).
- Rate limit: one Nominatim request per API call; frontend should debounce (not a backend concern).

#### 3. Nearby stations endpoint

**File**: `app/api/stations.py` (same router)

**Intent**: Find the N nearest stations to a given lat/lon coordinate, for the address search flow.

**Contract**:
- `GET /api/v1/stations/nearby?lat=54.38&lon=18.59&limit=5` — returns up to `limit` nearest active stations sorted by distance. Distance computed using the Haversine formula in SQL or a simpler Euclidean approximation on lat/lon (sufficient accuracy at city scale). Response includes `distance_m: int` (approximate meters).

#### 4. Router registration

**File**: `app/main.py`

**Intent**: Mount the API router on the FastAPI app.

**Contract**: `app.include_router(router, prefix="/api/v1")` after middleware setup. Import from `app.api`.

### Success Criteria:

#### Automated Verification:

- `GET /api/v1/stations` returns JSON array of stations
- `GET /api/v1/stations/{valid_id}` returns station with availability array
- `GET /api/v1/stations/{invalid_id}` returns 404
- `GET /api/v1/geocode?q=Gdańsk` returns lat/lon
- `GET /api/v1/stations/nearby?lat=54.38&lon=18.59` returns nearest stations
- Type checking passes: `uv run mypy .`
- Linting passes: `uv run ruff check .`

#### Manual Verification:

- Station list returns all active stations with correct fields
- Availability data matches what's in the `station_availability` table
- Geocoding returns plausible coordinates for Tricity addresses
- Nearby search returns sensible stations sorted by distance

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Frontend — Scaffold React/Vite

### Overview

Initialize the React/Vite frontend project in `frontend/` with TypeScript, Tailwind CSS, React Router, and TanStack Query. This is pure scaffolding — no application code yet.

### Changes Required:

#### 1. Vite project initialization

**File**: `frontend/` directory

**Intent**: Create a new Vite + React + TypeScript project. This is the foundation all frontend code builds on.

**Contract**: Standard `npm create vite@latest` output with React + TypeScript template. Key files: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`. Vite dev server proxy config: `/api` → `http://localhost:8000` for local development.

#### 2. Tailwind CSS setup

**File**: `frontend/tailwind.config.js`, `frontend/src/index.css`

**Intent**: Configure Tailwind CSS for utility-first styling.

**Contract**: Tailwind v4 (or v3 if v4 is unstable) with content paths pointing to `./src/**/*.{ts,tsx}`. Base styles in `index.css` with `@tailwind` directives.

#### 3. React Router setup

**File**: `frontend/src/router.tsx`

**Intent**: Define the SPA route structure.

**Contract**: Two routes: `/` (homepage with search) and `/stations/:stationId` (station detail page). Wrapped in `BrowserRouter`. Placeholder components for each route.

#### 4. TanStack Query setup

**File**: `frontend/src/main.tsx`

**Intent**: Configure the data-fetching layer.

**Contract**: `QueryClientProvider` wrapping the app in `main.tsx`. Default query client with sensible stale time (5 minutes for station list, 1 minute for availability stats).

#### 5. API client module

**File**: `frontend/src/api/client.ts`, `frontend/src/api/stations.ts`

**Intent**: Typed API client functions that TanStack Query hooks will call.

**Contract**: Base fetch wrapper in `client.ts` (handles `/api/v1/` prefix, JSON parsing, error handling). Station-specific functions in `stations.ts`: `fetchStations()`, `fetchStationDetail(stationId)`, `geocodeAddress(query)`, `fetchNearbyStations(lat, lon)`. TypeScript interfaces matching the Pydantic response models from Phase 2.

### Success Criteria:

#### Automated Verification:

- `cd frontend && npm install` succeeds
- `cd frontend && npm run build` produces `dist/` with index.html
- `cd frontend && npm run dev` starts dev server
- TypeScript compiles without errors: `npm run typecheck` (add script to package.json)

#### Manual Verification:

- Dev server shows placeholder page at `http://localhost:5173`
- Navigation between `/` and `/stations/test` works (placeholder content)
- Tailwind classes render correctly (e.g., a test `bg-blue-500` div shows blue)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Frontend — Homepage & Search

### Overview

Build the homepage with dual-mode search: station number search (real-time client-side filtering) and address search (Nominatim geocoding → nearby stations). Plus popular stations quick links.

### Changes Required:

#### 1. Homepage component

**File**: `frontend/src/pages/HomePage.tsx`

**Intent**: Main landing page with MevoStats branding, search interface, and popular stations grid.

**Contract**: Layout per the approved mockup: title/tagline at top, tabbed search bar (Station Number | Address tabs), results dropdown below search, popular stations card grid below. Uses TanStack Query to fetch all stations on mount (for client-side filtering).

#### 2. Station number search

**File**: `frontend/src/components/StationNumberSearch.tsx`

**Intent**: Real-time filtering of stations as the user types a station number or name. All filtering happens client-side against the pre-loaded station list.

**Contract**: Text input that filters the station list by `station_id` or `name` (case-insensitive contains match). Shows matching stations in a dropdown as the user types. Each result is a link to `/stations/{station_id}`. Renders station_id, name, and address for each match. Shows up to 10 results.

#### 3. Address search

**File**: `frontend/src/components/AddressSearch.tsx`

**Intent**: Geocode a user-typed address via the backend proxy, then show the 3-5 nearest stations.

**Contract**: Text input with debounced submission (300ms after typing stops, or on Enter). Calls `GET /api/v1/geocode?q=...` then `GET /api/v1/stations/nearby?lat=...&lon=...&limit=5`. Shows nearest stations with approximate distance. Loading and error states for geocoding.

#### 4. Popular stations section

**File**: `frontend/src/components/PopularStations.tsx`

**Intent**: Show a set of featured stations for quick access, reducing friction for first-time visitors.

**Contract**: Grid of station cards linking to detail pages. For MVP, hardcode 6-8 well-known Tricity stations (e.g., main train stations, central squares). Each card shows station_id, name, and address. Can be replaced later with a "most viewed" heuristic.

#### 5. Shared layout

**File**: `frontend/src/components/Layout.tsx`

**Intent**: Shared page layout with header (logo, nav) and footer.

**Contract**: Simple header with "MevoStats" branding and a link back to homepage. Footer with "Data from Mevo Open Data API" attribution. Wraps all routes.

### Success Criteria:

#### Automated Verification:

- Frontend builds without errors: `npm run build`
- TypeScript compiles: `npm run typecheck`

#### Manual Verification:

- Homepage loads with search bar and popular stations
- Typing "GD" in station number search shows matching stations in real-time
- Typing "Grunwaldzka Gdańsk" in address search shows nearest stations with distances
- Clicking a station result navigates to `/stations/{id}`
- Popular station cards link to correct detail pages
- Layout looks reasonable on mobile viewport (375px width)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Frontend — Station Detail Page

### Overview

Build the station detail page with a heatmap chart (7 days × active-hours timeslots), day-of-week tab row, collapsible day-part sections with 15-min slot detail, reliability labels, and empty state handling.

### Changes Required:

#### 1. Station detail page

**File**: `frontend/src/pages/StationDetailPage.tsx`

**Intent**: Main station page showing metadata and availability patterns.

**Contract**: Fetches station detail + availability via `GET /api/v1/stations/{stationId}`. Shows station name, address, station_id, capacity. Below metadata: heatmap chart, then day-part detail sections. Handles loading state, 404 (station not found), and empty data ("data still collecting" notice when sample_count below threshold).

#### 2. Availability heatmap

**File**: `frontend/src/components/AvailabilityHeatmap.tsx`

**Intent**: Color-coded heatmap grid showing availability patterns across the entire week at a glance.

**Contract**: Recharts-based heatmap (or custom grid with colored cells). 7 rows (Mon–Sun), columns for timeslots 5:00–23:00 (72 slots). Cell color: green (≥6 bikes, reliable), yellow (2-5, uncertain), red (≤1, empty), gray (insufficient data). Row labels on the left. Time labels on top (show every hour, not every 15 min). Clicking a row selects that day for the detail view below. Active row is highlighted.

#### 3. Day-of-week tabs

**File**: `frontend/src/components/DayOfWeekTabs.tsx`

**Intent**: Tab row for selecting a specific day to view detailed 15-min breakdown.

**Contract**: Horizontal tabs Mon–Sun. Selected tab is visually distinct. Clicking a tab updates the day-part detail sections below AND highlights the corresponding heatmap row. Default selection: current day of week.

#### 4. Day-part detail sections

**File**: `frontend/src/components/DayPartDetail.tsx`

**Intent**: Collapsible sections showing 15-min slot detail for the selected day, grouped by day-part.

**Contract**: Four sections: Morning (6:00–11:45), Afternoon (12:00–17:45), Evening (18:00–21:45), Night (22:00–5:45). Each section shows a header with the day-part name + summary (e.g., "Morning 6–12 · avg 4.2 bikes"). Expandable to reveal a bar chart or table of 15-min slots within that period. Each slot shows: time, avg bikes, avg ebikes, reliability label (color-coded chip). Morning section expanded by default; others collapsed.

#### 5. Empty state component

**File**: `frontend/src/components/EmptyState.tsx`

**Intent**: Informative notice when a station has insufficient data to show meaningful patterns.

**Contract**: Shown when the station exists but `sample_count` for most slots is below the minimum threshold (8 samples, ~2 weeks). Message explains that data is being collected and will be available soon. Shows how long the station has been tracked (if knowable) or a generic "data collection is in progress" message. Does NOT show a broken chart or misleading averages.

### Success Criteria:

#### Automated Verification:

- Frontend builds without errors: `npm run build`
- TypeScript compiles: `npm run typecheck`

#### Manual Verification:

- Station detail page loads for a valid station_id
- Heatmap renders with color-coded cells (even if sparse — gray cells for insufficient data)
- Clicking a heatmap row selects that day; tab updates to match
- Clicking a day tab highlights the corresponding heatmap row
- Day-part sections expand/collapse correctly
- Expanded section shows 15-min slot detail with reliability labels
- Station with no data shows "data still collecting" notice
- Invalid station_id shows a 404 / "station not found" page
- Page is usable on mobile viewport (375px width)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Deployment Integration

### Overview

Update the Docker build to include frontend compilation and configure FastAPI to serve the built frontend as static files. Ensure the single-container deployment works on Mikr.us.

### Changes Required:

#### 1. Dockerfile update

**File**: `Dockerfile`

**Intent**: Add a Node.js build stage that compiles the React frontend, then copies the output into the final image.

**Contract**: Three-stage build: (1) existing Python builder stage, (2) new Node.js stage (`node:20-slim`) that runs `npm ci && npm run build` in `frontend/`, (3) final runtime stage copies both `.venv` and `frontend/dist/` into the image. No Node.js in the final image — build-only.

#### 2. FastAPI static file serving

**File**: `app/main.py`

**Intent**: Serve the built React frontend from FastAPI, with SPA fallback for client-side routing.

**Contract**: Mount `StaticFiles` at `/` pointing to `frontend/dist/`. SPA fallback: any route not matching `/api/` or `/health` serves `index.html` so React Router handles it. Order matters: API routes registered first, static files mounted last. Conditional: only mount if `frontend/dist/` directory exists (allows running backend without frontend in development).

#### 3. Docker ignore and build optimization

**File**: `.dockerignore`

**Intent**: Exclude unnecessary files from Docker build context to keep image small and builds fast.

**Contract**: Add `frontend/node_modules/`, `frontend/.vite/`, `.venv/`, `.mypy_cache/`, `context/`, `*.md` (except README if needed).

#### 4. Dev workflow documentation

**File**: `frontend/README.md`

**Intent**: Document how to run frontend in development (Vite dev server with API proxy) vs production (built and served by FastAPI).

**Contract**: Brief instructions: dev mode (`npm run dev` in `frontend/`, backend on port 8000, Vite proxies `/api` requests), production mode (Docker build handles everything).

### Success Criteria:

#### Automated Verification:

- `docker compose build` succeeds (builds both Python and frontend)
- Container starts and `/health` returns 200
- `curl http://localhost:PORT/` returns index.html
- `curl http://localhost:PORT/api/v1/stations` returns JSON
- `curl http://localhost:PORT/stations/GD045` returns index.html (SPA fallback)

#### Manual Verification:

- Full app works in Docker: homepage, search, station detail page
- No CORS errors in browser console
- Frontend assets load correctly (CSS, JS bundles)
- App stays within 768MB memory limit on Mikr.us

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Aggregation function: verify correct GROUP BY logic, day-of-week extraction, 15-min bucketing
- API response models: verify Pydantic serialization of station and availability data
- Haversine/distance calculation: verify nearby stations sorting with known coordinates

### Integration Tests:

- API endpoints against test database with seeded stations and snapshots
- Aggregation job produces expected output from known snapshot data

### Manual Testing Steps:

1. Search for station by number — verify real-time filtering
2. Search by address in Tricity — verify geocoding and nearest stations
3. Open station with data — verify heatmap renders correctly
4. Open station with no data — verify empty state
5. Switch days of week — verify heatmap and detail update
6. Expand/collapse day-parts — verify interaction
7. Test on mobile viewport — verify responsive layout
8. Full Docker build and run — verify end-to-end

## Performance Considerations

- Pre-aggregated table eliminates expensive on-the-fly queries; API reads are simple lookups
- All 827 stations loaded client-side (~50-80KB) — enables instant search filtering
- Nominatim geocoding is rate-limited (1 req/sec) — frontend debounce at 300ms prevents excessive calls
- Hourly aggregation job processes all snapshots once — amortized cost across all API requests
- Frontend build is static — no SSR overhead, served as plain files
- Heatmap renders 72 × 7 = 504 cells — lightweight for Recharts

## Migration Notes

- Migration 003 adds `station_availability` table — non-breaking, additive schema change
- First aggregation run produces data from whatever snapshots exist — no backfill needed
- Frontend is new — no migration from existing UI
- Dockerfile change adds a build stage — existing deploy.sh workflow unchanged

## References

- PRD: `context/foundation/prd.md` (US-01, FR-001–007)
- Roadmap: `context/foundation/roadmap.md` (S-01)
- Existing collector pattern: `app/collector/` (module structure to follow)
- Existing scheduler jobs: `app/main.py:67-80` (pattern for new aggregation job)
- Station schema: `alembic/versions/001_create_stations.py`
- Snapshot schema: `alembic/versions/002_create_snapshots.py`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — Aggregation Table & Hourly Job

#### Automated

- [x] 1.1 Migration applies cleanly: `uv run alembic upgrade head` — d805010
- [x] 1.2 Aggregation function runs without error on existing data — d805010
- [x] 1.3 Type checking passes: `uv run mypy .` — d805010
- [x] 1.4 Linting passes: `uv run ruff check .` — d805010

#### Manual

- [x] 1.5 Query `station_availability` after aggregation — rows with plausible values — d805010
- [x] 1.6 Scheduler logs show aggregation job completing hourly — d805010
- [x] 1.7 Config thresholds are respected via env vars — d805010

### Phase 2: Backend — API Endpoints

#### Automated

- [x] 2.1 `GET /api/v1/stations` returns JSON array — 8f2a316
- [x] 2.2 `GET /api/v1/stations/{valid_id}` returns station with availability — 8f2a316
- [x] 2.3 `GET /api/v1/stations/{invalid_id}` returns 404 — 8f2a316
- [x] 2.4 `GET /api/v1/geocode?q=Gdańsk` returns lat/lon — 8f2a316
- [x] 2.5 `GET /api/v1/stations/nearby?lat=54.38&lon=18.59` returns nearest stations — 8f2a316
- [x] 2.6 Type checking passes: `uv run mypy .` — 8f2a316
- [x] 2.7 Linting passes: `uv run ruff check .` — 8f2a316

#### Manual

- [x] 2.8 Station list returns all active stations with correct fields — 8f2a316
- [x] 2.9 Availability data matches `station_availability` table — 8f2a316
- [x] 2.10 Geocoding returns plausible coordinates for Tricity addresses — 8f2a316
- [x] 2.11 Nearby search returns sensible stations sorted by distance — 8f2a316

### Phase 3: Frontend — Scaffold React/Vite

#### Automated

- [x] 3.1 `npm install` succeeds — 597748a
- [x] 3.2 `npm run build` produces `dist/` with index.html — 597748a
- [x] 3.3 `npm run dev` starts dev server — 597748a
- [x] 3.4 TypeScript compiles without errors — 597748a

#### Manual

- [x] 3.5 Dev server shows placeholder page at localhost:5173 — 597748a
- [x] 3.6 Navigation between routes works — 597748a
- [x] 3.7 Tailwind classes render correctly — 597748a

### Phase 4: Frontend — Homepage & Search

#### Automated

- [x] 4.1 Frontend builds without errors: `npm run build`
- [x] 4.2 TypeScript compiles: `npm run typecheck`

#### Manual

- [x] 4.3 Homepage loads with search bar and popular stations
- [x] 4.4 Station number search shows matching stations in real-time
- [x] 4.5 Address search shows nearest stations with distances
- [x] 4.6 Clicking a station navigates to detail page
- [x] 4.7 Layout is usable on mobile viewport (375px)

### Phase 5: Frontend — Station Detail Page

#### Automated

- [ ] 5.1 Frontend builds without errors: `npm run build`
- [ ] 5.2 TypeScript compiles: `npm run typecheck`

#### Manual

- [ ] 5.3 Station detail page loads for valid station_id
- [ ] 5.4 Heatmap renders with color-coded cells
- [ ] 5.5 Day-of-week tabs and heatmap row selection work together
- [ ] 5.6 Day-part sections expand/collapse correctly
- [ ] 5.7 Station with no data shows "data still collecting" notice
- [ ] 5.8 Invalid station_id shows 404 page
- [ ] 5.9 Page is usable on mobile viewport (375px)

### Phase 6: Deployment Integration

#### Automated

- [ ] 6.1 `docker compose build` succeeds
- [ ] 6.2 Container starts and `/health` returns 200
- [ ] 6.3 `curl /` returns index.html
- [ ] 6.4 `curl /api/v1/stations` returns JSON
- [ ] 6.5 `curl /stations/GD045` returns index.html (SPA fallback)

#### Manual

- [ ] 6.6 Full app works in Docker: homepage, search, station detail
- [ ] 6.7 No CORS errors in browser console
- [ ] 6.8 Frontend assets load correctly
- [ ] 6.9 App stays within 768MB memory limit
