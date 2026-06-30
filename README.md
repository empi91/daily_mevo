# MevoStats · [dailymevo.pl](https://dailymevo.pl)

It collects a snapshot of every Mevo bike-sharing station in Tricity (Gdańsk / Gdynia / Sopot) every 5 minutes and turns that stream into historical availability patterns — so you can plan your commute the night before.

## What you can do

- **Search** for any station by name
- **See a weekly heatmap** — at a glance, which hours are reliably green vs. consistently empty
- **Drill into any day** → 15-minute slot breakdown, split into morning / afternoon / evening / night, with a count of regular and electric bikes
- **Save favourites** (free account) so your regular stations are always one click away

No account needed to browse statistics.

## Running locally

```bash
# Backend
cp .env.example .env   # see .env.example for required variables
uv sync
uv run uvicorn app.main:app --reload

# Frontend
cd frontend && npm ci && npm run dev
```

Tests: `uv run pytest` (backend) · `cd frontend && npm test` (frontend) · see `context/RUNNING_TESTS.md` for full setup.
