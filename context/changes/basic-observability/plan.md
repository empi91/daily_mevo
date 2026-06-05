# Basic Observability Implementation Plan

## Overview

Add structured logging (structlog) and tracing (Pydantic Logfire) to the MevoStats FastAPI app and data collector. The goal: production issues surface in structured JSON logs and a Logfire dashboard without manual debugging or grepping unstructured output.

## Current State Analysis

- **Logging:** 6 files use Python's stdlib `logging` with `getLogger(__name__)`. ~15 log statements total — unstructured text messages via `logger.info()`, `logger.warning()`, `logger.exception()`.
- **No middleware:** No request/response logging, no request IDs, no correlation.
- **No tracing:** No OpenTelemetry, no Logfire, no spans.
- **Health endpoint:** `/health` returns collector status (running/stopped, last_collected_at, next_run_at, stations_count). Deploy scripts poll it.
- **Docker logging:** docker-compose configures json-file driver with 10MB max, 3 file rotation. `PYTHONUNBUFFERED=1` set in Dockerfile.
- **No freshness monitoring:** NFR requires "most recent snapshot no older than 1 hour" but nothing checks or reports staleness.

### Key Discoveries:

- `app/main.py:80-84` — FastAPI app created with no middleware
- `app/main.py:15-77` — lifespan manages db pool + APScheduler; scheduler jobs use `logger.exception()` for errors
- `app/config.py:4-16` — Settings class with `env_prefix="MEVO_"`, includes `environment` field already
- `app/collector/*.py` — all 3 collector modules use `logging.getLogger(__name__)` with consistent patterns
- `app/main.py:87-135` — health endpoint already queries DB and scheduler state; good foundation for freshness extension
- `docker-compose.yml` — json-file log driver already configured; structured JSON stdout will be captured automatically
- uvicorn runs via `scripts/entrypoint.sh` with no `--log-config` flag — default logging config will need overriding

## Desired End State

After this plan is complete:

1. All application logs are structured JSON in production (pretty console in development)
2. Every HTTP request carries a correlation ID (request_id) visible in all logs within that request
3. Every collector cycle (station sync, snapshot collection) is a Logfire span with duration, count, and error tracking
4. The `/health` endpoint reports data freshness (last snapshot age vs. 1-hour threshold)
5. A WARNING-level log fires when data freshness degrades past the 1-hour threshold
6. Logfire dashboard shows request traces, collector job spans, and Pydantic validation data in production (controlled by `LOGFIRE_TOKEN` presence)
7. uvicorn's internal logs are unified through the same structlog pipeline — no duplicate or misformatted lines

**Verification:** `curl /health` returns freshness data; `docker logs | jq .` parses every line as valid JSON; Logfire dashboard shows traces for both HTTP requests and collector jobs.

## What We're NOT Doing

- No alerting/notification system (Logfire alerts, email, Slack) — passive monitoring only
- No Sentry or separate error tracking service — Logfire traces surface errors
- No asyncpg query-level tracing — collector spans only, not individual SQL queries
- No custom metrics/Prometheus endpoint — Logfire traces are the metrics layer
- No log aggregation service (Axiom, Better Stack) — Docker json-file + Logfire is sufficient
- No uptime monitoring service — existing deploy script health checks continue as-is

## Implementation Approach

**structlog** handles all log formatting and context binding. **Logfire** adds tracing spans and a dashboard on top. The two integrate via `logfire.StructlogProcessor()` in the structlog processor chain — structlog events flow to Logfire automatically when `LOGFIRE_TOKEN` is present.

The migration is additive: existing `logging.getLogger(__name__)` calls continue working because structlog's `ProcessorFormatter` intercepts stdlib log records ("foreign events") and formats them identically to native structlog events. Collector modules migrate to `structlog.stdlib.get_logger()` for context binding, but no log call signatures change drastically.

Environment-aware rendering: `MEVO_ENVIRONMENT=development` → pretty console output, Logfire inactive. `MEVO_ENVIRONMENT=production` + `LOGFIRE_TOKEN` set → JSON stdout + Logfire active.

## Phase 1: Logging Foundation

### Overview

Create the structlog + Logfire configuration module, unify uvicorn logging, and wire it into the FastAPI app startup. After this phase, all logs (app + uvicorn) flow through structlog with environment-aware rendering.

### Changes Required:

#### 1. New logging configuration module

**File**: `app/logging.py` (new)

**Intent**: Central logging setup function that configures structlog processors, Logfire integration, uvicorn log unification, and environment-aware rendering (pretty console in dev, JSON in prod). Called once at app startup before anything else.

**Contract**: Exports `setup_logging() -> None`. Reads `MEVO_ENVIRONMENT` (via `app.config.settings`) and `LOG_LEVEL` env var (default `INFO`). Configures:
- structlog with `merge_contextvars`, `add_log_level`, `TimeStamper(fmt="iso")`, `StructlogProcessor()`, and `ProcessorFormatter`
- Logfire via `logfire.configure(service_name="mevostats", send_to_logfire="if-token-present", console=False)`
- Root logger with single `StreamHandler` using structlog's `ProcessorFormatter`
- uvicorn loggers (`uvicorn`, `uvicorn.error`) cleared and set to propagate; `uvicorn.access` silenced (middleware handles access logs)

#### 2. Add new dependencies

**File**: `pyproject.toml`

**Intent**: Add structlog and logfire[fastapi] to project dependencies.

**Contract**: Add `"structlog>=25.1"` and `"logfire[fastapi]>=1.0"` to `[project].dependencies`. Add `"logfire"` to `[[tool.mypy.overrides]]` ignore list.

#### 3. Wire logging into app startup

**File**: `app/main.py`

**Intent**: Call `setup_logging()` before FastAPI app creation so all startup logs (including lifespan) are structured. Import and invoke Logfire FastAPI instrumentation.

**Contract**: 
- Import and call `setup_logging()` at module level (before `app = FastAPI(...)`)
- Add `logfire.instrument_fastapi(app)` after app creation
- Replace `import logging` / `logging.getLogger(__name__)` with `structlog.stdlib.get_logger()`

#### 4. Update entrypoint for uvicorn

**File**: `scripts/entrypoint.sh`

**Intent**: Pass `--log-config` flag to prevent uvicorn from overriding the structlog logging setup.

**Contract**: Change uvicorn invocation to include `--no-access-log` (middleware handles access logs). The structlog config already runs at import time, so no `--log-config` override needed — uvicorn's default dictConfig is neutralized by `setup_logging()` clearing handlers.

### Success Criteria:

#### Automated Verification:

- App starts without errors: `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Type checking passes: `uv run mypy .`
- Linting passes: `uv run ruff check .`
- Existing tests pass: `uv run pytest`

#### Manual Verification:

- In dev (`MEVO_ENVIRONMENT=development`): logs appear as colorized, human-readable console output
- In prod-like mode (`MEVO_ENVIRONMENT=production`): every log line is valid JSON parseable by `jq`
- uvicorn startup messages appear in the structlog format (no duplicate or plain-text lines)
- Health endpoint still works: `curl http://localhost:8000/health`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Request & Collector Observability

### Overview

Add ASGI middleware for request correlation (request_id, method, path, status, duration) and wrap collector jobs with Logfire spans. Migrate collector modules from stdlib logging to structlog.

### Changes Required:

#### 1. Request context middleware

**File**: `app/middleware.py` (new)

**Intent**: ASGI middleware that generates a request_id (UUID4), binds it plus method/path to structlog's contextvars, times the request, and emits a structured access log on completion. Returns request_id in `X-Request-ID` response header.

**Contract**: Class `RequestContextMiddleware` extending Starlette's `BaseHTTPMiddleware`. Binds `request_id`, `method`, `path` via `structlog.contextvars.bind_contextvars()`. Emits `logger.info("request_completed", status_code=..., duration_ms=...)` after each request. Calls `clear_contextvars()` at start of each request.

#### 2. Register middleware on FastAPI app

**File**: `app/main.py`

**Intent**: Add `RequestContextMiddleware` to the app's middleware stack.

**Contract**: `app.add_middleware(RequestContextMiddleware)` after app creation, before lifespan runs.

#### 3. Migrate collector modules to structlog

**Files**: `app/collector/gbfs_client.py`, `app/collector/station_sync.py`, `app/collector/snapshot_collector.py`

**Intent**: Replace `import logging` / `logging.getLogger(__name__)` with `structlog.stdlib.get_logger()` in all three collector modules. Existing log calls (`logger.info(...)`, `logger.warning(...)`, `logger.exception(...)`) remain the same — structlog's stdlib wrapper has the same API.

**Contract**: Each file replaces its logger initialization. No log message text or arguments change. The structlog logger automatically includes any bound context (e.g., `job_name` from the scheduler wrapper).

#### 4. Wrap scheduler jobs with Logfire spans

**File**: `app/main.py`

**Intent**: Wrap `run_station_sync()` and `run_snapshot_collection()` with Logfire spans so each 5-min cycle appears as a traced span in the Logfire dashboard with duration, result count, and error status. Also bind `job_name` to structlog context for each job run.

**Contract**: Each scheduler job function gets wrapped with `logfire.span("scheduled_job:{job_name}", job_name=...)`. Inside the span: `clear_contextvars()` + `bind_contextvars(job_name=...)` at start; `span.set_attribute("result_count", count)` on success. Existing try/except structure preserved — `logger.exception()` on failure sets the span to error state automatically.

### Success Criteria:

#### Automated Verification:

- App starts and collector runs without errors
- Type checking passes: `uv run mypy .`
- Linting passes: `uv run ruff check .`
- Existing tests pass: `uv run pytest`

#### Manual Verification:

- HTTP request logs include `request_id`, `method`, `path`, `status_code`, `duration_ms`
- Response headers include `X-Request-ID`
- Collector cycle logs include `job_name` context field
- In production mode with `LOGFIRE_TOKEN`: verify spans appear in Logfire dashboard (both request traces and collector job spans)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Health Endpoint & Freshness Monitoring

### Overview

Extend the `/health` endpoint with data freshness reporting (last snapshot age vs. 1-hour threshold). Emit a WARNING log when freshness degrades.

### Changes Required:

#### 1. Add freshness configuration

**File**: `app/config.py`

**Intent**: Add a configurable freshness threshold setting so the 1-hour limit isn't hardcoded.

**Contract**: Add `freshness_threshold_seconds: int = 3600` to the `Settings` class. Env var: `MEVO_FRESHNESS_THRESHOLD_SECONDS`.

#### 2. Extend health endpoint with freshness data

**File**: `app/main.py`

**Intent**: Query the most recent snapshot timestamp from the database, compute age, compare against threshold, and include freshness status in the `/health` response. Emit a WARNING log when the freshness threshold is exceeded.

**Contract**: Add a `data_freshness` key to the health response:
```json
{
  "data_freshness": {
    "last_snapshot_at": "2026-06-05T12:00:00+00:00",
    "age_seconds": 180,
    "threshold_seconds": 3600,
    "fresh": true
  }
}
```
When `fresh` is `false`, emit `logger.warning("data_freshness_degraded", age_seconds=..., threshold_seconds=...)`. When the DB is unavailable or no snapshots exist, `last_snapshot_at` is `null` and `fresh` is `false`.

### Success Criteria:

#### Automated Verification:

- App starts without errors
- Type checking passes: `uv run mypy .`
- Linting passes: `uv run ruff check .`
- Existing tests pass: `uv run pytest`
- Health endpoint returns `data_freshness` key: `curl http://localhost:8000/health | jq .data_freshness`

#### Manual Verification:

- With active collector: `fresh` is `true`, `age_seconds` is small (< 300)
- With collector disabled (`MEVO_COLLECTOR_ENABLED=false`) and stale data: `fresh` becomes `false` after threshold, WARNING log appears in output

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Configuration & Deployment

### Overview

Update environment configuration, documentation, and deployment artifacts for the new observability stack.

### Changes Required:

#### 1. Update environment example

**File**: `.env.example`

**Intent**: Document the new observability-related environment variables.

**Contract**: Add a `# Observability` section with `LOGFIRE_TOKEN`, `MEVO_FRESHNESS_THRESHOLD_SECONDS`, and `LOG_LEVEL` entries (commented out with descriptions).

#### 2. Add log_level to Settings

**File**: `app/config.py`

**Intent**: Make the log level configurable via the standard `MEVO_` env prefix, consistent with other settings.

**Contract**: Add `log_level: str = "INFO"` to Settings. The `setup_logging()` function reads this instead of a separate `LOG_LEVEL` env var.

#### 3. Update entrypoint for production logging

**File**: `scripts/entrypoint.sh`

**Intent**: Ensure uvicorn doesn't interfere with structured logging in the Docker container.

**Contract**: Add `--no-access-log` flag to the uvicorn command (access logs handled by middleware).

#### 4. Sync dependencies

**Intent**: Run `uv sync` to lock new dependencies. Verify Docker build still works.

**Contract**: `uv sync` succeeds; `docker build .` produces a working image.

### Success Criteria:

#### Automated Verification:

- `uv sync` succeeds without errors
- Docker image builds: `docker build -t mevostats:test .`
- Container starts and health check passes: `docker run --env-file .env mevostats:test`
- Type checking passes: `uv run mypy .`
- Linting passes: `uv run ruff check .`

#### Manual Verification:

- Container logs are structured JSON (not plain text)
- `.env.example` documents all new variables
- Health endpoint returns freshness data from within the container

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Logging config: verify `setup_logging()` doesn't raise; verify JSON output in prod mode
- Freshness calculation: verify age computation and threshold comparison logic

### Integration Tests:

- Health endpoint returns `data_freshness` with expected structure
- Request middleware adds `X-Request-ID` header to responses

### Manual Testing Steps:

1. Start app in dev mode — verify colorized console logs
2. Start app in prod mode — verify every line is valid JSON via `docker logs | jq .`
3. Hit `/health` — verify `data_freshness` section present
4. Check collector logs — verify `job_name` context and structured format
5. If Logfire token available: verify traces appear in dashboard

## Performance Considerations

- structlog adds ~15% overhead over stdlib logging for 100K messages — negligible for this app's ~300 log lines/day
- Logfire SDK with `send_to_logfire="if-token-present"` is a no-op without token — zero overhead in dev/CI
- Collector spans: ~288/day (one per 5-min cycle) — well within Logfire's 10M/month free tier
- Request spans: minimal until S-01 ships (only `/health` endpoint currently)
- Total RAM impact: under 10 MB additional (structlog + logfire SDK)

## Migration Notes

- Existing `logging.getLogger(__name__)` calls in collector modules work without changes through structlog's `ProcessorFormatter` foreign event handling. Migration to `structlog.stdlib.get_logger()` is for ergonomics (context binding), not correctness.
- No database migration needed.
- Deploy requires setting `LOGFIRE_TOKEN` in production `.env` for Logfire to activate. Without it, the app runs with structured JSON logging only (no Logfire).
- Rollback: remove logfire/structlog deps, revert `app/logging.py` and middleware — stdlib logging resumes.

## References

- Roadmap: `context/foundation/roadmap.md` (F-02)
- PRD NFRs: `context/foundation/prd.md` §Non-Functional Requirements
- structlog docs: https://www.structlog.org/en/stable/
- Logfire FastAPI integration: https://logfire.pydantic.dev/docs/integrations/web-frameworks/fastapi/
- Logfire structlog integration: https://logfire.pydantic.dev/docs/integrations/logging/structlog/
- FastAPI + structlog + uvicorn reference: https://gist.github.com/nymous/f138c7f06062b7c43c060bf03759c29e

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Logging Foundation

#### Automated

- [x] 1.1 App starts without errors — b46230b
- [x] 1.2 Type checking passes — b46230b
- [x] 1.3 Linting passes — b46230b
- [x] 1.4 Existing tests pass — b46230b

#### Manual

- [ ] 1.5 Dev mode shows colorized console logs
- [ ] 1.6 Prod mode outputs valid JSON on every line
- [ ] 1.7 uvicorn logs appear in structlog format
- [ ] 1.8 Health endpoint still works

### Phase 2: Request & Collector Observability

#### Automated

- [x] 2.1 App starts and collector runs without errors
- [x] 2.2 Type checking passes
- [x] 2.3 Linting passes
- [x] 2.4 Existing tests pass

#### Manual

- [x] 2.5 Request logs include request_id, method, path, status_code, duration_ms
- [x] 2.6 Response headers include X-Request-ID
- [x] 2.7 Collector logs include job_name context
- [ ] 2.8 Logfire dashboard shows spans (if token configured)

### Phase 3: Health Endpoint & Freshness Monitoring

#### Automated

- [ ] 3.1 App starts without errors
- [ ] 3.2 Type checking passes
- [ ] 3.3 Linting passes
- [ ] 3.4 Existing tests pass
- [ ] 3.5 Health endpoint returns data_freshness key

#### Manual

- [ ] 3.6 Active collector shows fresh=true with small age_seconds
- [ ] 3.7 Stale data triggers fresh=false and WARNING log

### Phase 4: Configuration & Deployment

#### Automated

- [ ] 4.1 uv sync succeeds
- [ ] 4.2 Docker image builds successfully
- [ ] 4.3 Container starts and health check passes
- [ ] 4.4 Type checking passes
- [ ] 4.5 Linting passes

#### Manual

- [ ] 4.6 Container logs are structured JSON
- [ ] 4.7 .env.example documents all new variables
- [ ] 4.8 Health endpoint works from within container
