# Heatmap Color Scale — Plan Brief

> Full plan: `context/changes/heatmap-color-scale/plan.md`
> Research: `context/changes/heatmap-color-scale/research.md`

## What & Why

The current heatmap uses a 3-tier colour scale (green/yellow/red) driven by a backend-assigned `reliability_label`. Users can't distinguish between "2 bikes" and "5 bikes" — both look the same yellow. We're replacing it with a 5-tier red→orange→yellow→lime→green gradient keyed on raw bike counts, giving commuters finer-grained signal at a glance.

## Starting Point

`AvailabilityHeatmap.tsx` contains a `cellColor(label: string)` function that switches on `reliability_label`. Both `avg_bikes` and `avg_ebikes` are already present on every `AvailabilitySlot` in the API response — the frontend has all the data it needs to bucket without any backend changes.

## Desired End State

The heatmap shows 5 distinct colours across the gradient. A commuter can immediately see whether a time slot typically has 1 bike (red), 2–3 (orange), 4–6 (yellow), 7–9 (lime), or 10+ (green). The legend shows all 5 tiers with Polish labels. All colour buckets are covered by unit tests.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Bucket boundaries | 0–1, 2–3, 4–6, 7–9, ≥10 | Clarified by user to avoid overlap in original spec | Plan |
| Color ramp | red → orange → yellow → lime → green | User confirmed suggested gradient | Research |
| Architecture | Frontend-only bucketing | `avg_bikes + avg_ebikes` already in API response; no backend churn needed | Plan |
| No-data condition | `!slot \|\| slot.sample_count < 1` | Consistent with frontend logic; removes dependency on `reliability_label` string | Plan |
| Legend language | Polish (unchanged) | No i18n direction in project; keep existing style | Plan |
| Test scope | Full 5-bucket coverage | User chose recommended option; every bucket needs a passing test | Plan |

## Scope

**In scope:**
- `cellColor()` function — new signature and 5-bucket logic
- Call site in JSX — pass numeric total and sample count instead of label string
- `cellTitle()` no-data guard — change label check to `sample_count < 1`
- Legend — 5 colour swatches + no-data entry
- Tests — update 2 failing colour tests, add 3 new bucket tests, update legend test

**Out of scope:**
- Backend: `app/api/stations.py`, `app/config.py` — no changes
- `AvailabilitySlot` TypeScript interface — no changes
- `reliability_label` API field — kept on response, just no longer used for colour
- Grid geometry, row selection, hover states

## Architecture / Approach

Pure frontend change, single component. `cellColor()` gets a new signature `(total: number, sampleCount: number) → string` with an if-else chain over the 5 thresholds. The JSX call site computes `(slot?.avg_bikes ?? 0) + (slot?.avg_ebikes ?? 0)` inline. No new dependencies, no new files.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Component | Updated `cellColor`, `cellTitle`, call site, and legend | Tailwind purge may not include `bg-orange-400` or `bg-lime-400` if those classes aren't used elsewhere |
| 2. Tests | All 5 buckets covered, legend test updated | Fixture totals must match expected buckets — verified during research |

**Prerequisites:** None — no migrations, no infra, no auth.  
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- **Tailwind purge**: If `bg-orange-400` and `bg-lime-400` aren't used elsewhere in the project, Tailwind's JIT must see them as string literals in the component — they must not be constructed dynamically. The plan uses literal class strings so this is safe, but worth confirming visually.
- `reliability_label` stays in the API response and is still used by `cellTitle()` — wait, no: `cellTitle()` will use `sample_count` after the change. `reliability_label` becomes a purely unused field on the frontend.

## Success Criteria (Summary)

- Heatmap shows 5 visually distinct colours (confirmed manually in the browser)
- `npx vitest run` passes with all 5 bucket tests green
- Legend shows 6 entries with correct Polish text
