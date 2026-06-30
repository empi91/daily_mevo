---
bootstrapped_at: 2026-05-28T20:41:00Z
starter_id: fastapi
starter_name: FastAPI
project_name: daily-mevo
language_family: python
package_manager: uv
cwd_strategy: native-cwd
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: pip-audit --format json
---

## Hand-off

```yaml
starter_id: fastapi
package_manager: uv
project_name: daily-mevo
hints:
  language_family: python
  team_size: solo
  deployment_target: fly
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
```

### Why this stack

Solo Python developer building a Mevo bike-availability tracker as an after-hours MVP in 3 weeks. FastAPI is async-native (matching the stated preference), fully typed via Pydantic (passing all 4 agent-friendly gates), and pairs naturally with a separate React via Vite frontend for the station charts and dashboard. PostgreSQL is the database (preferably using Supabase) — its aggregation capabilities handle the core workload of computing averages per station per 15-minute timeslot per day-of-week across growing historical snapshots, with async access via asyncpg. The 5-minute data collection cycle maps to APScheduler or system cron alongside FastAPI. Auth (registration, login, favourites) is available via fastapi-users or a lightweight JWT approach. Tooling is uv for package management (fast, modern), ruff for linting and formatting, and mypy for type checking — all agent-friendly defaults. Deployment target is set to Fly.io as a placeholder; the final platform will be decided in the infrastructure step.

## Pre-scaffold verification

| Signal        | Value   | Severity | Notes                                                    |
| ------------- | ------- | -------- | -------------------------------------------------------- |
| npm package   | not run | —        | non-JS starter; npm check skipped                        |
| GitHub repo   | not run | —        | docs_url (fastapi.tiangolo.com) is not a GitHub URL; no recency signal available |

## Scaffold log

**Resolved invocation**: `uv init . && uv add fastapi uvicorn`
**Strategy**: native-cwd
**Exit code**: 0
**Pre-flight files-to-touch**: pyproject.toml, main.py, .python-version, uv.lock
**Files written by CLI**: 4 (pyproject.toml, main.py, .python-version, uv.lock)
**Pre-existing files preserved**: CLAUDE.md, README.md, .gitignore, idea.md, skills-lock.json, context/, .agents/, .claude/, .git/, .venv/

## Post-scaffold audit

**Tool**: pip-audit --format json
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW
**Direct vs transitive**: not distinguished by this tool

No vulnerabilities found. Clean dependency tree with 40 packages audited.

Dependencies audited (direct): fastapi 0.136.3, uvicorn 0.48.0.
Key transitive: pydantic 2.13.4, starlette 1.2.0, anyio 4.13.0, h11 0.16.0, idna 3.17, click 8.4.1.

## Hints recorded but not acted on

| Hint                       | Value                              |
| -------------------------- | ---------------------------------- |
| bootstrapper_confidence    | first-class                        |
| quality_override           | false                              |
| path_taken                 | custom                             |
| self_check_answers         | typed: true, from_official_starter: true, conventions: true, docs_current: true, can_judge_agent: false |
| team_size                  | solo                               |
| deployment_target          | fly                                |
| ci_provider                | github-actions                     |
| ci_default_flow            | auto-deploy-on-merge               |
| has_auth                   | true                               |
| has_payments               | false                              |
| has_realtime               | false                              |
| has_ai                     | false                              |
| has_background_jobs        | true                               |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
