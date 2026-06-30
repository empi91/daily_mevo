# Basic Observability — Plan Brief

> Full plan: `context/changes/basic-observability/plan.md`

## What & Why

Add structured logging and tracing to the MevoStats FastAPI app and data collector. Currently all logs are unstructured text with no request correlation, no tracing, and no freshness monitoring — making production debugging a manual grep-over-SSH exercise. The PRD's NFRs require data freshness monitoring ("most recent snapshot no older than 1 hour") and this is a prerequisite for S-01 (the north star station availability page).

## Starting Point

The app has ~15 log statements across 6 files using Python's stdlib `logging` — all unstructured text. No middleware, no request IDs, no tracing. The `/health` endpoint reports collector status but not data freshness. Docker's json-file log driver is already configured, so structured JSON to stdout will be captured automatically.

## Desired End State

Every log line is structured JSON in production (pretty console in dev). Every HTTP request carries a correlation ID. Every collector cycle appears as a traced span in the Logfire dashboard. The `/health` endpoint reports data freshness with a WARNING log when staleness exceeds 1 hour. A developer can open Logfire and see request traces + collector job health at a glance.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Logging library | structlog | Best async context propagation via contextvars; native ProcessorFormatter unifies uvicorn logs |
| Tracing/dashboard | Pydantic Logfire | Built for FastAPI/Pydantic; 10M events/month free; 2-line integration |
| Error tracking | Logfire traces only (no Sentry) | Logfire surfaces errors in spans; separate error tracking is overkill at this stage |
| Log format (dev) | Pretty console (ConsoleRenderer) | Best DX for local development |
| Log format (prod) | JSON to stdout | Machine-parsable; captured by Docker json-file driver |
| Logfire activation | Production only (if-token-present) | No dev noise in dashboard; saves free-tier quota |
| Request middleware | Standard context (ID, method, path, status, duration) | Covers 90% of debugging needs without logging bodies/headers |
| Collector observability | Logfire spans per cycle + structured logs | ~288 spans/day; full visibility in dashboard and local logs |
| Freshness monitoring | Health endpoint extension + WARNING log | Builds on existing /health; deploy scripts already poll it |
| Default log level | INFO | Captures routine collector activity + all problems |

## Scope

**In scope:**
- structlog configuration with environment-aware rendering
- Logfire integration (FastAPI instrumentation, collector spans)
- ASGI request context middleware (request_id, timing)
- Migrate collector modules to structlog
- Health endpoint freshness extension
- Dependency and configuration updates

**Out of scope:**
- Alerting/notifications (Logfire alerts, email, Slack)
- Sentry or separate error tracking
- asyncpg query-level tracing
- Prometheus metrics endpoint
- Log aggregation services (Axiom, Better Stack)
- Uptime monitoring services

## Architecture / Approach

structlog handles all log formatting and context binding. Logfire adds OpenTelemetry tracing on top. The two connect via `logfire.StructlogProcessor()` in the structlog processor chain — events flow to both local stdout and Logfire when the token is present. uvicorn's internal logs route through structlog's `ProcessorFormatter` as "foreign events" for consistent formatting. Environment-aware: `MEVO_ENVIRONMENT` controls rendering; `LOGFIRE_TOKEN` presence controls Logfire activation.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Logging Foundation | structlog config, uvicorn unification, env-aware rendering | uvicorn log duplication if handler cleanup is wrong |
| 2. Request & Collector Observability | Request middleware, Logfire spans for collector jobs, structlog migration | contextvars not propagating across ASGI middleware boundary |
| 3. Health Endpoint & Freshness | /health extension with freshness data + WARNING logs | Extra DB query per health check adds latency |
| 4. Configuration & Deployment | Dependencies, env vars, Docker build verification | Logfire SDK size increasing Docker image / memory |

**Prerequisites:** None — F-02 has no dependencies on other roadmap items.
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- Logfire SDK + OpenTelemetry transitive dependencies may increase Docker image size; need to verify it stays reasonable for Mikr.us's 10GB NVMe
- `send_to_logfire="if-token-present"` is assumed to be truly zero-overhead without a token — needs runtime verification
- structlog's `ProcessorFormatter` with `foreign_pre_chain` is assumed to handle uvicorn + asyncpg stdlib log records cleanly — the nymous reference gist confirms this but it needs testing with our specific versions

## Success Criteria (Summary)

- Every log line in production is valid JSON parseable by `jq`
- `/health` returns `data_freshness.fresh` boolean and emits WARNING when stale
- Logfire dashboard shows request traces and collector job spans (when token configured)
