---
starter_id: fastapi
package_manager: uv
project_name: daily-mevo
hints:
  language_family: python
  team_size: solo
  deployment_target: mikrus
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: false
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

## Why this stack

Solo Python developer building a Mevo bike-availability tracker as an after-hours MVP in 3 weeks. FastAPI is async-native (matching the stated preference), fully typed via Pydantic (passing all 4 agent-friendly gates), and pairs naturally with a separate React via Vite frontend for the station charts and dashboard. PostgreSQL is the database (preferably using Supabase) — its aggregation capabilities handle the core workload of computing averages per station per 15-minute timeslot per day-of-week across growing historical snapshots, with async access via asyncpg. The 5-minute data collection cycle maps to APScheduler or system cron alongside FastAPI. Auth (registration, login, favourites) is available via fastapi-users or a lightweight JWT approach. Tooling is uv for package management (fast, modern), ruff for linting and formatting, and mypy for type checking — all agent-friendly defaults. Deployment target is Mikr.us VPS with Docker Compose and SSH-based deploy.
