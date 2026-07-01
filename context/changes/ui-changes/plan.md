# UI Redesign — "3c Friendly" Implementation Plan

## Overview

Visual redesign of MevoStats to the "3c Friendly" direction: Nunito + DM Mono typography, warm brown/orange palette, OS-aware dark/light theming with manual toggle, and updated component layouts (station cards, heatmap, slot tiles). Includes a new backend endpoint (`/stations/popular`) to provide availability data for popular station cards.

## Current State Analysis

The frontend uses stock Tailwind v4 with zero customization — `index.css` contains only `@import "tailwindcss"`. No custom fonts, no CSS properties, no dark mode, no theming. The palette is Tailwind's default cool gray + blue. All components use hardcoded Tailwind utility classes.

### Key Discoveries:

- `index.css:1` — single `@import "tailwindcss"` line, no `tailwind.config.js` exists (Tailwind v4 CSS-first)
- `Layout.tsx:8` — `bg-gray-50` page background, `max-w-5xl` content width, blue accent color throughout
- `PopularStations.tsx:27-28` — shows only `station.name` + `station.address`, no availability data
- `FavouriteStations.tsx:29-42` — already shows availability with Polish pluralization, uses `avg_bikes`/`avg_ebikes` from `/favourites` endpoint
- `AvailabilityHeatmap.tsx:16-23` — uses Tailwind utility classes for 6-tier color scale (includes separate `bg-gray-200` for no-data)
- `DayPartDetail.tsx:104` — `grid-cols-1 sm:grid-cols-2` layout, horizontal text rows, colored badge pills for reliability
- `app/api/favourites.py:34-50` — query pattern for joining `station_availability` with current time slot, reusable for `/stations/popular`
- `app/aggregation.py:44` — `avg_bikes` = regular bikes only (from `bikes_available`), NOT total. Total = `avg_bikes + avg_ebikes`
- `polish.ts` — pluralization functions return full labels ("rowery elektryczne"), slot tile redesign splits number from label text

## Desired End State

The app renders with Nunito/DM Mono typography, a warm brown/orange palette, and OS-aware dark/light theming with a manual sun/moon toggle in the header. Station cards (both popular and favourite) show current-slot availability in a unified card component. The heatmap uses the 5-tier hex color scale with 5px rounded cells and 3-hour tick labels. Slot tiles are vertical 132px cards in a 6-column grid with softened tier-color backgrounds and numbers-forward layout. Login/Register pages match the new palette.

**Verification**: visually compare each view against `DESIGN_BASELINE_2026-07-03.md`, confirm dark/light toggle works, confirm availability data appears on popular station cards, confirm Polish pluralization remains correct.

## What We're NOT Doing

- Custom heatmap hover tooltip (keep native `title` attribute)
- Accent color picker UI (ship with default `#ff8f66`, CSS variable supports future picker)
- `showReliability` user toggle (code-level constant, default `true`)
- Mobile-specific layout changes beyond what Tailwind responsive utilities provide
- Any backend changes beyond the new `/stations/popular` endpoint

## Implementation Approach

4-phase incremental approach, ordered by dependency:

1. **Design system first** — establish fonts, palette tokens, theme infrastructure. After this phase, the whole app has the new visual foundation and working dark/light mode.
2. **Home page** — hero, search, shared StationCard, backend `/stations/popular` endpoint, wire up both card grids.
3. **Station detail (header + heatmap + tabs)** — update the detail page header, heatmap visuals, and day-of-week tabs.
4. **Slot tiles + auth pages** — the largest single component redesign (slot tiles) plus auth page restyling.

Each phase produces a testable, visually coherent intermediate state.

## Critical Implementation Details

### Timing & lifecycle

The theme toggle must read `prefers-color-scheme` on mount AND listen for live OS changes via `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)`. Manual override stored in `localStorage` takes precedence — removing the stored value reverts to OS detection.

### State sequencing

The `useTheme` hook must be available in `Layout.tsx` before any component renders, because the `dark` class on `<html>` affects every component's palette tokens. Wrap the app in a `ThemeProvider` at the router level (in `main.tsx` or `router.tsx`), not inside `Layout`.

---

## Phase 1: Design System Foundation

### Overview

Establish the visual foundation: Google Fonts, CSS custom properties for the warm palette with dark/light variants, Tailwind v4 `@theme` configuration, theme context/hook, toggle button in the header, and Layout.tsx updates (max-width, page background, header/footer restyling).

### Changes Required:

#### 1. Google Fonts

**File**: `frontend/index.html`

**Intent**: Load Nunito (400/600/700/800) and DM Mono (400/500) via Google Fonts `<link>` tags in `<head>`.

**Contract**: Two `<link>` elements (preconnect + stylesheet) before the existing `<script>` tag. Font display: `swap`.

#### 2. CSS Design Tokens

**File**: `frontend/src/index.css`

**Intent**: Replace the bare `@import "tailwindcss"` with a complete design system: CSS custom properties for all 8 semantic palette tokens (bg, surface, text, muted, border, accent, accentSoft, accentText) on `:root` (light) and `.dark` (dark), font-family declarations, and Tailwind v4 `@theme` block mapping the custom properties to Tailwind utilities.

**Contract**: 
- `:root` gets light palette values from DESIGN_BASELINE_2026-07-03.md §1
- `.dark` selector overrides with dark palette values
- `--color-accent: #ef7a52` (light) / `#ff8f66` (dark) — easily changeable for future picker
- `@theme` block maps `--font-sans: 'Nunito', sans-serif` and `--font-mono: 'DM Mono', monospace`
- Heatmap tier colors as CSS variables: `--tier-0` through `--tier-4` (and softened variants `--tier-0-soft` through `--tier-4-soft`)

#### 3. Theme Context & Hook

**File**: `frontend/src/hooks/useTheme.tsx` (new)

**Intent**: React context + hook providing `theme` state (`'system' | 'light' | 'dark'`), `resolvedTheme` (`'light' | 'dark'`), and `setTheme()`. On mount, reads `localStorage` for manual override, falls back to OS `prefers-color-scheme`. Listens for live OS theme changes. Toggles `class="dark"` on `document.documentElement`.

**Contract**: Exports `ThemeProvider` (context provider component) and `useTheme()` hook. `ThemeProvider` wraps the app at router level.

#### 4. Theme Toggle Button

**File**: `frontend/src/components/ThemeToggle.tsx` (new)

**Intent**: Sun/moon icon button that cycles through theme states. Clicking toggles between light and dark (sets localStorage override).

**Contract**: Uses `useTheme()` hook. Renders a `<button>` with `aria-label`. Sun icon when dark, moon icon when light. Styled with palette tokens (muted color, hover accent).

#### 5. Layout Updates

**File**: `frontend/src/components/Layout.tsx`

**Intent**: Apply new palette tokens to the shell (page bg, header, footer), update max-width from `max-w-5xl` to ~`max-w-[920px]`, add ThemeToggle to the header (right side, before auth links), update typography to use Nunito, replace blue accent colors with palette tokens.

**Contract**: 
- `<div className="min-h-screen flex flex-col bg-gray-50">` → uses `bg` token
- Header/footer: `surface` bg, `border` token borders
- `max-w-5xl` → `max-w-[920px]` in header, footer, and content areas
- ThemeToggle rendered between the subtitle span and the auth links block
- All `text-blue-600` / `text-gray-*` replaced with semantic token classes

#### 6. ThemeProvider Wiring

**File**: `frontend/src/router.tsx` or `frontend/src/main.tsx`

**Intent**: Wrap the app in `<ThemeProvider>` so `useTheme()` is available to all components including Layout.

**Contract**: `ThemeProvider` wraps `<BrowserRouter>` (or the outermost component inside `QueryClientProvider`).

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `cd frontend && npx tsc --noEmit`
- Linting passes: `cd frontend && npx eslint src/`
- Existing tests pass: `cd frontend && npm test`

#### Manual Verification:

- App loads with Nunito font on all text, DM Mono on station codes in search results
- Dark/light toggle in header works — clicking toggles between themes
- OS theme detection works — changing OS theme auto-updates the app (when no manual override)
- All palette tokens apply correctly in both dark and light modes
- Header shows: MevoStats title | subtitle | theme toggle | auth links

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Home Page

### Overview

Redesign the home page hero, search bar, and station cards. Create a shared `StationCard` component used by both `PopularStations` and `FavouriteStations`. Add the backend `/stations/popular` endpoint to provide availability data for popular station cards.

### Changes Required:

#### 1. Backend: Popular Stations Endpoint

**File**: `app/api/stations.py`

**Intent**: New `GET /stations/popular` endpoint returning the 6 featured stations with current-slot availability data (avg_bikes, avg_ebikes, reliability_label). Mirrors the `/favourites` query pattern.

**Contract**: Returns `list[FavouriteStationResponse]` (reuse existing model — same shape). Uses `_current_slot()` from `app/api/favourites.py` (move to shared location or import). Hardcodes the same `FEATURED_IDS` as the frontend (`['4076', '3839', '4192', '4345', '4353', '3829']`) or accepts them as config. Joins `stations` with `station_availability` for current day/time slot.

#### 2. Frontend API: fetchPopularStations

**File**: `frontend/src/api/stations.ts`

**Intent**: Add `fetchPopularStations()` function that calls `GET /stations/popular` and returns typed station data with availability.

**Contract**: Returns `Promise<FavouriteStation[]>` (reuse the type from `favourites.ts` since the response shape is identical). Import `FavouriteStation` from `../api/favourites`.

#### 3. Shared StationCard Component

**File**: `frontend/src/components/StationCard.tsx` (new)

**Intent**: Unified station card matching DESIGN_BASELINE spec: fixed ~138px height, 14px border-radius, surface bg + border. Shows station name (DM Mono, accent) ←→ heart icon, address (700, 14px), caption "Statystycznie o tej godzinie:", electric line then regular line (800, 13.5px), zero lines hidden, fallbacks "Brak rowerów"/"Brak danych".

**Contract**: Props: `station` (with station_id, name, address, avg_bikes, avg_ebikes nullable), `showHeart` (boolean — whether to render FavouriteToggleButton), `isFavourite` (optional). Wraps content in a `<Link>` to `/stations/{station_id}`. Uses `ebikesLabel()`/`plainBikesLabel()` from `polish.ts` — splits the number (big, 800) from the label text (700, small).

#### 4. Hero Section Redesign

**File**: `frontend/src/pages/HomePage.tsx`

**Intent**: Replace the plain h1+subtitle with the design spec hero: accent circle "M" avatar (44px) + `MevoStats` h1 (800, 38px) + muted subtitle (max-width ~440px, centered).

**Contract**: New `<div>` containing a 44px accent circle with "M" letter, h1 with font-extrabold, and subtitle paragraph with `max-w-[440px] mx-auto`. Update outer container max-width from `max-w-3xl` to `max-w-[920px]`.

#### 5. Search Bar Redesign

**File**: `frontend/src/components/StationSearch.tsx`

**Intent**: Change input from rectangular to pill shape, add search icon inside, update max-width to ~560px centered, change placeholder to "Wpisz nazwę lub adres stacji", apply surface bg + border token.

**Contract**: Input gets `rounded-full`, `max-w-[560px] mx-auto`, surface background. Search icon (SVG magnifying glass) positioned absolutely inside the input with left padding. Dropdown results also updated to use palette tokens.

#### 6. PopularStations Refactor

**File**: `frontend/src/components/PopularStations.tsx`

**Intent**: Replace inline card rendering with shared `StationCard`. Switch data source from `fetchStations` (no availability) to `fetchPopularStations` (with availability). Update section heading to 800 weight, 16px.

**Contract**: Uses `useQuery` with `['popularStations']` query key and `fetchPopularStations`. Renders `StationCard` for each station with `showHeart={true}`. Grid: 3 columns (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`).

#### 7. FavouriteStations Refactor

**File**: `frontend/src/components/FavouriteStations.tsx`

**Intent**: Replace inline card rendering with shared `StationCard`. Remove the "✕" close button — heart icon in StationCard handles unfavouriting. Update section heading.

**Contract**: Renders `StationCard` for each favourite with `showHeart={true}`. Remove the absolute-positioned "✕" button and its removal logic (StationCard's heart handles it via FavouriteToggleButton).

### Success Criteria:

#### Automated Verification:

- Backend tests pass: `uv run pytest tests/`
- TypeScript compiles: `cd frontend && npx tsc --noEmit`
- Linting passes: `cd frontend && npx eslint src/`
- Frontend tests pass: `cd frontend && npm test`
- Backend linting: `uv run ruff check .`
- Backend types: `uv run mypy .`

#### Manual Verification:

- Popular stations show availability data ("Statystycznie o tej godzinie: X rowerów elektrycznych...")
- Favourite stations use the same card layout as popular stations
- Heart icon toggles favourite state on both card types
- Zero bike lines are hidden, fallbacks display correctly
- Hero section matches design baseline (accent M circle, correct typography)
- Search bar is pill-shaped with search icon
- All elements use warm palette tokens, correct in both dark/light modes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Station Detail — Header, Heatmap & Tabs

### Overview

Update the station detail page header typography, redesign the heatmap visual styling (colors, radii, gaps, tick labels, legend), and restyle the day-of-week tabs to accent pill chips.

### Changes Required:

#### 1. Station Detail Header

**File**: `frontend/src/pages/StationDetailPage.tsx`

**Intent**: Update header typography: station name as h1 (800, 26px) + favourite heart on same line. Sub-line format: `ID: {station_id} · {address} · Pojemność: {capacity}` in 600 weight, muted color. Update back link and loading/error states to use palette tokens. Update content max-width to `max-w-[920px]`.

**Contract**: h1 changes from `text-3xl font-bold` to `text-[26px] font-extrabold`. Sub-line gets `font-semibold` + muted text color. Replace all `text-blue-*` and `text-gray-*` with palette tokens. Section headings (h2) become `text-base font-extrabold`.

#### 2. Heatmap Color Scale

**File**: `frontend/src/components/AvailabilityHeatmap.tsx`

**Intent**: Replace Tailwind utility color classes with the 5-tier hex scale from the design baseline. Remove the separate 6th tier (`bg-gray-200` for no-data) — keep no-data as a distinct muted style.

**Contract**: `cellColor()` function returns inline style objects (or CSS variable references) instead of Tailwind classes:
- Tier 4 (≥10): `#4caf6e`
- Tier 3 (7–9): `#9fcf5a`
- Tier 2 (4–6): `#e8c44a`
- Tier 1 (2–3): `#e8924a`
- Tier 0 (0–1): `#dc4a4a`
- No data: muted/border token color

#### 3. Heatmap Cell Styling

**File**: `frontend/src/components/AvailabilityHeatmap.tsx`

**Intent**: Update cell dimensions and spacing: height 24px→26px, border-radius 2px→5px, gaps 1px→3px. Update row label width from 40px→44px.

**Contract**: Cell: `h-[26px]`, `rounded-[5px]`. Row gap: `gap-[3px]`. Row label: `w-11` (44px), font-weight 700, muted color.

#### 4. Heatmap Hour Ticks

**File**: `frontend/src/components/AvailabilityHeatmap.tsx`

**Intent**: Change hour label display from every-hour to every-3-hours. Use DM Mono font, muted color. Center each label within its column span.

**Contract**: Only render labels at hours 5, 8, 11, 14, 17, 20. Each label spans 3 hours worth of columns and is centered. Apply `font-mono` (mapped to DM Mono) + muted text token. Offset by 44px label column.

#### 5. Heatmap Legend

**File**: `frontend/src/components/AvailabilityHeatmap.tsx`

**Intent**: Update legend to 5 swatches using the tier hex colors. Remove the 6th "brak danych" swatch. Update swatch border-radius to 5px.

**Contract**: 5 legend items: `≥10 rowerów łącznie`, `7–9`, `4–6`, `2–3`, `0–1`. Each with a colored swatch matching the tier colors. Muted text. Aligned to the grid (44px left offset).

#### 6. Heatmap Row Selection Styling

**File**: `frontend/src/components/AvailabilityHeatmap.tsx`

**Intent**: Replace blue selection highlight with palette-based styling.

**Contract**: Selected row: `accentSoft` background, accent ring. Hover: subtle surface highlight. Replace `bg-blue-50 ring-1 ring-blue-300` and `hover:bg-gray-50`.

#### 7. Day-of-Week Tabs

**File**: `frontend/src/components/DayOfWeekTabs.tsx`

**Intent**: Restyle tabs from blue/gray rectangles to accent pill chips matching design baseline.

**Contract**: Active tab: accent bg + accentText color. Inactive: accentSoft bg + muted text. Shape: `rounded-full` (pill). Remove `bg-blue-600 text-white` and `bg-gray-100 text-gray-700`.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `cd frontend && npx tsc --noEmit`
- Frontend tests pass: `cd frontend && npm test`
- Linting passes: `cd frontend && npx eslint src/`

#### Manual Verification:

- Heatmap cells use correct 5-tier hex colors, 5px radius, 3px gaps
- Hour ticks show every 3 hours (5, 8, 11, 14, 17, 20), centered, in DM Mono
- Legend shows 5 swatches with correct labels
- Day-of-week tabs are accent-colored pills
- Station detail header shows correct typography (800, 26px) with heart
- Sub-line format matches spec: `ID: {id} · {address} · Pojemność: {capacity}`
- All elements correct in both dark and light modes
- Clicking a heatmap row still selects the day and scrolls to detail

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Slot Tiles & Auth Pages

### Overview

Complete redesign of the day-detail slot tiles to variant 2a (vertical cards, numbers-forward, softened tier backgrounds, fixed 132px height, 6-column grid). Update collapsible section headers. Restyle Login and Register pages.

### Changes Required:

#### 1. Slot Tile Redesign

**File**: `frontend/src/components/DayPartDetail.tsx`

**Intent**: Replace horizontal text rows with vertical card tiles matching variant 2a spec. Each tile: 132px height, 11px border-radius, 10px 11px padding, softened tier-color background, dark-on-color text. Layout: time (DM Mono 12px) → electric row (big number 800 20px + label 700 11px) → regular row (same) → thin divider → average row (total number 800 20px + "średnio" 700 11px). If low-confidence and `SHOW_RELIABILITY` constant is true, append " · niepewne".

**Contract**: 
- Grid changes from `grid-cols-1 sm:grid-cols-2` to `grid-cols-6` (always 6 columns)
- Softened tier background colors from CSS variables: `--tier-0-soft` (#e08a83) through `--tier-4-soft` (#93c9a6)
- Text colors: `rgba(0,0,0,.82)` for numbers, `rgba(0,0,0,.5)` for labels/time
- Zero lines hidden (same logic as station cards)
- `SHOW_RELIABILITY` as a module-level constant (`const SHOW_RELIABILITY = true`)

#### 2. Collapsible Section Headers

**File**: `frontend/src/components/DayPartDetail.tsx`

**Intent**: Update day-part section headers: name weight to 800, replace text chevrons (`▲`/`▼`) with SVG chevron icons, apply palette tokens to background and text.

**Contract**: Header: part name in `font-extrabold`, range + average in muted text. Chevron: inline SVG `<svg>` (not text character). Background: surface token with hover state. Border: border token.

#### 3. Login Page Restyling

**File**: `frontend/src/pages/LoginPage.tsx`

**Intent**: Apply warm palette tokens and Nunito typography. Replace blue button/link colors with accent tokens. Update input styling to use surface bg + border tokens.

**Contract**: Replace all `text-blue-*`, `bg-blue-*`, `text-gray-*`, `border-gray-*`, `focus:ring-blue-*` with palette token equivalents. Button: accent bg + accentText. Links: accent color.

#### 4. Register Page Restyling

**File**: `frontend/src/pages/RegisterPage.tsx`

**Intent**: Same palette/typography updates as Login page.

**Contract**: Same token replacements as LoginPage. Keep validation logic and error messages unchanged.

#### 5. FavouriteToggleButton Palette Update

**File**: `frontend/src/components/FavouriteToggleButton.tsx`

**Intent**: Update heart icon colors from red/gray to accent/muted palette tokens.

**Contract**: Favourited: accent color. Not favourited: muted color, hover accent. Replace `text-red-500`, `text-gray-400`, etc.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `cd frontend && npx tsc --noEmit`
- Frontend tests pass: `cd frontend && npm test`
- Linting passes: `cd frontend && npx eslint src/`

#### Manual Verification:

- Slot tiles render as vertical cards in 6-column grid
- Tile backgrounds use softened tier colors matching the bike count
- Numbers are large (20px, 800 weight), labels are small (11px, 700 weight)
- Divider separates bike counts from average row
- "niepewne" appears on low-confidence slots
- Zero lines hidden on tiles (same as cards)
- Login/Register pages match warm palette
- All elements correct in both dark and light modes
- Polish pluralization remains correct across all tile states

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Theme hook: test OS detection, localStorage override, toggle cycling
- StationCard: test rendering with/without availability, zero handling, fallbacks
- Heatmap `cellColor`: test all 5 tiers + no-data case with new hex values
- Slot tile: test numbers-forward rendering, reliability display, zero-line hiding

### Integration Tests:

- `/stations/popular` endpoint returns correct shape with availability data
- Popular stations page renders cards with availability when endpoint returns data

### Manual Testing Steps:

1. Toggle dark/light mode, verify all components update
2. Change OS theme, verify app follows (when no manual override set)
3. Check popular station cards show bike counts
4. Navigate to station detail, verify heatmap colors and tick labels
5. Expand day parts, verify 6-column slot tile grid with correct colors
6. Test with station that has zero bikes — verify fallbacks
7. Test login/register pages in both themes

## Performance Considerations

- Google Fonts loaded with `display=swap` to avoid FOIT
- CSS custom properties used for theming — single class toggle on `<html>`, no re-render needed for theme switch
- `/stations/popular` endpoint is a single query with JOIN — no N+1 problem
- Softened tier colors defined as CSS variables, not computed at runtime

## References

- Design baseline (latest): `context/changes/ui-changes/DESIGN_BASELINE_2026-07-03.md`
- Research gap analysis: `context/changes/ui-changes/research.md`
- Earlier baselines: `DESIGN_BASELINE.md`, `DESIGN_BASELINE_2026-07-01.md`, `DESIGN_BASELINE_2026-07-02.md`
- Backend availability query pattern: `app/api/favourites.py:34-50`
- Polish pluralization: `frontend/src/polish.ts`
- Heatmap current implementation: `frontend/src/components/AvailabilityHeatmap.tsx`
- Slot tile current implementation: `frontend/src/components/DayPartDetail.tsx:104-130`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Design System Foundation

#### Automated

- [x] 1.1 TypeScript compiles — 1cd33b0
- [x] 1.2 Linting passes — 1cd33b0
- [x] 1.3 Existing tests pass — 1cd33b0

#### Manual

- [x] 1.4 Nunito/DM Mono fonts load correctly — 1cd33b0
- [x] 1.5 Dark/light toggle works in header — 1cd33b0
- [x] 1.6 OS theme detection works with live updates — 1cd33b0
- [x] 1.7 All palette tokens apply correctly in both themes — 1cd33b0

### Phase 2: Home Page

#### Automated

- [x] 2.1 Backend tests pass — c7e168b
- [x] 2.2 TypeScript compiles — c7e168b
- [x] 2.3 Frontend tests pass — c7e168b
- [x] 2.4 Backend linting and type checks pass — c7e168b

#### Manual

- [x] 2.5 Popular stations show availability data — c7e168b
- [x] 2.6 Station cards match design spec (both popular and favourite) — c7e168b
- [x] 2.7 Heart icon toggles favourite state — c7e168b
- [x] 2.8 Hero section and search bar match design baseline — c7e168b
- [x] 2.9 Cards correct in both dark/light modes — c7e168b

### Phase 3: Station Detail — Header, Heatmap & Tabs

#### Automated

- [x] 3.1 TypeScript compiles — 7370efa
- [x] 3.2 Frontend tests pass — 7370efa
- [x] 3.3 Linting passes — 7370efa

#### Manual

- [x] 3.4 Heatmap uses 5-tier hex colors with correct radii and gaps — 7370efa
- [x] 3.5 Hour ticks show every 3 hours, centered, DM Mono — 7370efa
- [x] 3.6 Legend shows 5 swatches — 7370efa
- [x] 3.7 Day-of-week tabs are accent pill chips — 7370efa
- [x] 3.8 Station header typography and sub-line match spec — 7370efa
- [x] 3.9 All elements correct in both themes — 7370efa

### Phase 4: Slot Tiles & Auth Pages

#### Automated

- [x] 4.1 TypeScript compiles
- [x] 4.2 Frontend tests pass
- [x] 4.3 Linting passes

#### Manual

- [x] 4.4 Slot tiles render as 6-column vertical cards with softened tier backgrounds
- [x] 4.5 Numbers-forward layout with correct typography sizes
- [x] 4.6 Reliability "niepewne" appears on low-confidence slots
- [x] 4.7 Login/Register pages match warm palette
- [x] 4.8 Polish pluralization correct across all states
- [x] 4.9 All elements correct in both dark/light modes
