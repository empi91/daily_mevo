---
project: "MevoStats"
version: 1
status: draft
created: 2026-05-20
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

A regular Mevo bike commuter in Tricity (Gdańsk / Gdynia / Sopot) has no way to know whether their home station will have a bike on a typical Wednesday morning at 7:45. The Mevo app shows real-time state but offers no historical patterns, averages, or trend data. The capability is simply absent — not hidden, not behind a paywall — it does not exist.

The public Mevo Open Data API emits a live snapshot of all station states every few minutes. Nobody has collected and aggregated this stream over time. Mevo has no incentive to surface retrospective patterns: their product optimises for the rental transaction, not commuter planning confidence. The insight is that a persistent collector + a simple presentation layer turns a free, untapped data stream into a genuinely useful commuter tool.

## User & Persona

**Primary persona — The Tricity Mevo Commuter**

A regular Mevo user in Tricity (Gdańsk / Gdynia / Sopot) who bikes to work daily. They have a fixed home station and a fixed work station; their commute window is narrow (e.g. must leave between 7:30 and 8:00). They currently open the Mevo app as they're putting on shoes — discovering too late that the nearby station is empty. They want to plan the day before, not improvise in the hallway.

## Success Criteria

### Primary
- A visitor can search for any Mevo station in Tricity, open its page, and see a chart of average bike availability by 15-minute timeslot for any day of the week — based on real collected data, with a reliability label (reliable / uncertain / typically empty) per time slot.
- A registered user can mark stations as favourites and see them listed on a personal dashboard without re-searching.

### Secondary
- The data collector runs automatically (no manual trigger), fetching Mevo API state every ~5 minutes and updating aggregated averages.
- The station page shows at least weekday vs. weekend patterns at a glance.

### Guardrails
- Station stats page loads for a first-time visitor with no account and no cookies.
- The data collector never stores personal user data from the Mevo API — only aggregate availability counts per station per timestamp.
- A station with no collected data yet shows an explanatory empty state, not a broken page.

## User Stories

### US-01: Commuter checks station patterns before leaving home

- **Given** a visitor opens the website (no account required)
- **When** they search for or select their home Mevo station on the map
- **Then** they see a chart of average bike availability at that station by hour for their chosen day of the week (e.g. Tuesday mornings)

#### Acceptance Criteria
- Chart data is based on real collected snapshots, not synthetic placeholders
- Visitor can switch between days of the week without leaving the station page
- A station with fewer than N days of data shows a "data still collecting" notice rather than a potentially misleading chart

### US-02: Registered user opens their favourite stations on return visit

- **Given** a registered user who has favourited at least one station
- **When** they log in and open the dashboard
- **Then** they see their favourited stations listed with a quick-view of current / recent availability — no re-searching needed

#### Acceptance Criteria
- Dashboard is the default landing page after login
- Each favourite card links directly to the station detail page
- Removing a station from favourites is available from the dashboard card

## Functional Requirements

### Data Collection
- FR-001: System fetches Mevo API station state automatically every ~5 minutes. Priority: must-have
  > Socrates: Counter-argument considered: "5 min is too coarse for rush-hour patterns."
  > Resolution: kept at 5 min — granular enough for 15-min slot averages over time; not abusive to the public API.

- FR-002: System stores raw availability snapshot per station per timestamp. Priority: must-have

- FR-003: System calculates average bike count per station per 15-minute timeslot per day-of-week, grouped into day-parts (morning / afternoon / evening / night). Priority: must-have
  > Socrates: Counter-argument considered: "1-hour buckets are enough for commuter planning."
  > Resolution: changed to 15-minute slots to match departure windows precisely. Day-part grouping
  > reduces UI noise from 96 raw slots. Early data will be noisy — accepted; station pages will show
  > a "data still collecting" notice until a minimum threshold is met.

### Station Discovery
- FR-004: Visitor can search stations by name or browse a list of all stations. Priority: must-have
- FR-005: Visitor can view all stations on an interactive map. Priority: nice-to-have
  > Socrates: Demoted to nice-to-have. List + search is the must-have path; map is additive.

- FR-006: Visitor can open a station detail page with historical availability patterns. Priority: must-have
- FR-007: Visitor can view availability by 15-min timeslot × day-of-week, presented in day-part buckets (morning / afternoon / evening / night) to reduce visual noise. Priority: must-have
  > Socrates: Counter-argument considered: "96 slots is overwhelming."
  > Resolution: day-part bucketing collapses the view; user can drill into a part to see 15-min slots.

### User Accounts
- FR-008: Visitor can register an account with email and password. Priority: must-have
  > Socrates: Counter-argument considered: "friction — most visitors won't register just for favourites."
  > Resolution: kept. Accounts are the v1 foundation for the v2 personal ride data feature. Favourites
  > are the minimum working feature that justifies accounts existing in MVP.

- FR-009: Registered user can log in and log out. Priority: must-have
- FR-010: Registered user can add a station to their favourites. Priority: must-have
  > Socrates: Counter-argument considered: "browser bookmarks do the same job."
  > Resolution: kept. Favourites are the v1 placeholder; the real account value arrives with personal
  > ride data in v2. Building the auth layer now avoids a disruptive retrofit later.

- FR-011: Registered user can remove a station from their favourites. Priority: must-have
- FR-012: Registered user can view a personal dashboard listing favourite stations. Priority: must-have
  > Socrates: Counter-argument considered: "a filtered list is cheaper than a full dashboard."
  > Resolution: kept as a dedicated dashboard — it sets the pattern for the v2 personal data landing page.

### Personal Ride Data (v2 — explicitly deferred)
- FR-013: User can authenticate with their Mevo account to authorise ride data access. Priority: nice-to-have
- FR-014: System fetches user's personal ride history from the Mevo user portal. Priority: nice-to-have
- FR-015: User can view their ride stats (count, distance, stations used, dates). Priority: nice-to-have
- FR-016: User can view a visual breakdown or heatmap of their ride history. Priority: nice-to-have

## Non-Functional Requirements

- Station availability data shown on any page reflects the full history of collected snapshots, with the most recent snapshot no older than 1 hour.
- A station detail page is usable (loads and renders meaningful content) in under 3 seconds on a mobile browser on a standard 4G connection.
- No personal user data obtained via the Mevo public API (trip records, user identifiers, location traces) is stored, logged, or exposed at any level of the system. The collector captures only aggregate availability counts per station per timestamp.
- The product is usable on the two most recent major versions of Chrome, Firefox, and Safari.
- The service handles concurrent traffic of up to several hundred simultaneous visitors without requiring architectural changes — initial scale is personal/small, but the system must not require a structural rebuild to grow to hundreds of users.

## Business Logic

For a given station and time slot (day-of-week × 15-minute window), the system computes the average number of available bikes across all historical snapshots matching that slot, and classifies the result as reliable / uncertain / typically empty — so a commuter can plan their departure with confidence.

The inputs are: (1) all raw availability snapshots ever collected for a station at a given day-of-week + 15-minute window, and (2) a minimum snapshot threshold below which the system declares "data still collecting" rather than showing a potentially misleading average. The outputs are: an average bike count and a reliability label (e.g. avg ≥ 2 = reliable, avg 1–2 = uncertain, avg < 1 = typically empty). The user encounters this on the station detail page, where the chart displays both the number and a colour-coded label per time slot.

The rule is applied over cumulative historical data: statistics reflect all snapshots collected since the service launched, recalculated to incorporate any snapshot up to 1 hour old. This is not a "last hour's snapshot" view — it is a growing historical average that improves in accuracy over time as more data is collected.

## Access Control

**Public (no auth):** Station statistics pages are fully accessible to any visitor. No registration required to view historical availability patterns.

**Registered user:** Can create an account (email + password or similar) to save favourite stations for quick access. Flat role — no capability difference between registered users.

**Admin:** Operational access to inspect data collection status, sync health, and database state. Delivery mechanism (web admin role vs. direct backend tooling) is deferred — see Open Questions.

## Non-Goals

- **No mobile app:** Web-only for v1. Responsive design is the mobile experience. Rationale: native app doubles the build surface before the core product is proven.
- **No real-time notifications or alerts:** Historical pattern analysis only. No push notifications, no email alerts ("your station is low on bikes"). Rationale: adds infrastructure complexity before the data layer is established.
- **No social or sharing features:** No public user profiles, no chart-sharing to social media, no community features. Rationale: single-user value comes first; community features require a critical mass that doesn't exist yet.
- **No multi-city support:** Mevo / Tricity only. Not a generic city-bike platform. Rationale: generalising before the single-city case is validated is premature.
- **No offline-first guarantee:** Standard web app. Rationale: not a priority for a data-display product used while at a desk or on WiFi.

## Open Questions

1. **Admin panel delivery mechanism:** Should operational access (sync status, data health, database state) be a web admin role in the app itself, or handled via direct backend tooling (database dashboard + server logs)? Owner: user. Block: no (can decide at implementation time, before auth is built).

2. **Reliability label thresholds:** What average bike counts map to reliable / uncertain / typically empty? E.g., avg ≥ 2 = reliable, avg 1–2 = uncertain, avg < 1 = typically empty. Owner: user. Block: no (can be tuned after first data).

3. **Minimum snapshot threshold for display:** How many snapshots must exist for a given station × slot before showing a chart (vs. "data still collecting")? Owner: user. Block: no (default can be chosen at build time and adjusted later).

4. **Day-part definitions:** Morning / afternoon / evening / night — what are the exact hour boundaries? Owner: user. Block: no (can be defined during implementation; a sensible default like 6–12 / 12–18 / 18–22 / 22–6 is likely fine to start).
