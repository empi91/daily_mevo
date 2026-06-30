# MevoStats — First Deployment Plan

## Context

MevoStats is a FastAPI app that needs to go from a stub `main.py` to a running service on a Mikr.us VPS (plan 2.1, 1GB RAM, Docker-in-LXC, Helsinki). The goal: a health-checked FastAPI container accessible via HTTPS at a `*.wykr.es` subdomain, connected to Supabase (PostgreSQL, Frankfurt), with repeatable deploy/rollback scripts.

**Key constraints**: 1GB RAM (768MB for container), Docker-in-LXC (CVE-2025-52881 risk), single uvicorn worker, Supabase as future DB (Frankfurt, ~30-50ms latency from Helsinki).

---

## Phase 1: Local Project Setup (Agent)

### 1.1 Rewrite `main.py` → minimal FastAPI app
- [x] Replace stub with FastAPI app + `GET /health` endpoint
- [x] Use `pydantic-settings` for config (`Settings` class with `MEVO_` env prefix)
- [x] Health returns `{"status": "ok", "version": "0.1.0", "environment": "<env>"}`
- [x] Use `lifespan` context manager (future: DB pool init, scheduler start)

**File**: `main.py`

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    app_version: str = "0.1.0"

    model_config = {"env_prefix": "MEVO_"}


settings = Settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="MevoStats",
    version=settings.app_version,
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": settings.app_version,
        "environment": settings.environment,
    }
```

### 1.2 Update `pyproject.toml`
- [x] Add `pydantic-settings>=2.9.1` to dependencies
- [x] Run `uv sync`

### 1.3 Create `.env.example`
- [x] Document all env vars (current + planned with comments)

```env
# App settings
MEVO_ENVIRONMENT=development
MEVO_APP_VERSION=0.1.0

# Supabase (not needed for initial deploy)
# MEVO_DATABASE_URL=postgresql+asyncpg://user:pass@host:6543/dbname
# MEVO_SUPABASE_URL=https://your-project.supabase.co
# MEVO_SUPABASE_ANON_KEY=your-anon-key

# Mikr.us (for deploy script, not consumed by the app)
# MIKRUS_SERVER=srvXX
# MIKRUS_SSH_PORT=10XXX
# MIKRUS_APP_PORT=20XXX
# MIKRUS_API_KEY=your-api-key
```

### 1.4 Create `Dockerfile`
- [x] Multi-stage build: `python:3.12-slim` + `uv` from official image
- [x] Non-root user (`mevo`)
- [x] Single uvicorn worker, `PYTHONUNBUFFERED=1`
- [x] Target image size: <250MB (actual: 217MB local, ~similar on server)

```dockerfile
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim
RUN groupadd -r mevo && useradd -r -g mevo -d /app -s /sbin/nologin mevo
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY main.py ./
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
USER mevo
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

### 1.5 Create `docker-compose.yml`
- [x] Port from `MIKRUS_APP_PORT` env var (default 20000)
- [x] `mem_limit: 768m`, `memswap_limit: 768m` (no LXC swap)
- [x] `restart: unless-stopped`
- [x] Log rotation (10MB × 3 files)
- [x] Healthcheck via Python stdlib (no curl in slim image)

```yaml
services:
  app:
    build: .
    ports:
      - "${MIKRUS_APP_PORT:-20000}:8000"
    env_file:
      - .env
    restart: unless-stopped
    mem_limit: 768m
    memswap_limit: 768m
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

### 1.6 Create `.dockerignore`
- [x] Exclude `.venv`, `.git`, `.claude`, `context`, `__pycache__`, `.env`, `*.md`, caches

### 1.7 Local verification
- [x] `uv sync` installs pydantic-settings
- [x] `uv run uvicorn main:app --reload` → `localhost:8000/health` returns OK
- [x] `uv run ruff check . && uv run ruff format --check .` passes
- [x] `docker compose build` succeeds
- [x] `docker compose up` → `localhost:20000/health` returns OK
- [x] `docker images` shows image <250MB
- [x] `docker compose down` cleanup

---

## Phase 2: External Service Setup (User — Manual)

### 2.1 Create Supabase project
- [x] Go to `https://supabase.com/dashboard`, create new project
- [x] **Region: Frankfurt (eu-central-1)** — closest to Helsinki (~30-50ms)
- [x] Note: Project URL, Anon key, Connection string (Transaction mode pooler, **port 6543**)
- [x] Verify pooling is set to "Transaction mode" in Settings → Database → Connection Pooling

**Verify locally**:
```bash
psql "postgresql://postgres.[ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" -c "SELECT 1;"
```

### 2.2 Purchase Mikr.us and configure SSH
- [x] Buy 7 PLN trial at `mikr.us`, plan 2.1
- [x] From welcome email, note: server name (srv66), VPS name (tadek312), root password
- [x] Ports: SSH = 10312, App = 20312
- [x] Get API key from `mikr.us/panel/?a=api`
- [x] Set up SSH key:
```bash
ssh-keygen -t ed25519 -C mikrus -f ~/.ssh/mikrus
ssh-copy-id -i ~/.ssh/mikrus -p <10000+ID> root@<server>.mikr.us
```
- [x] Add SSH config alias:
```
Host mikrus
    HostName <server>.mikr.us
    User root
    Port <10000+ID>
    IdentityFile ~/.ssh/mikrus
```
- [x] Verify: `ssh mikrus 'echo connected'`
- [x] **IMPORTANT**: Do NOT use port 22 — 5 failed attempts = 24h IP block

**Verify port allocation**:
```bash
curl -s -X POST https://api.mikr.us/porty -d "srv=<server>&key=<api_key>" | python3 -m json.tool
```

### 2.3 Provide credentials to agent
After completing 2.1 + 2.2, share with the agent:
- Mikr.us server name + SSH port + App port
- Supabase connection string (transaction mode, port 6543)

---

## Phase 3: Server Preparation (Agent via SSH)

### 3.1 Verify Docker + system resources
- [x] `docker --version && docker compose version` (Docker 29.1.3, Compose 2.40.3)
- [x] `free -m && df -h` (1024MB RAM, 9.8GB disk)
- [x] `runc --version` (runc 1.3.4)

### 3.2 Docker-in-LXC compatibility check
- [x] Run `docker run --rm hello-world` — works
- [x] **If it works**: proceed to 3.3
- [ ] **If AppArmor error** (runc 1.2.7+ in LXC): (not needed)
  - Option A: Pin Docker packages: `apt-mark hold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`
  - Option B: Set AppArmor unconfined: write `{"apparmor-profile": "unconfined"}` to `/etc/docker/daemon.json`, restart Docker
  - Option C: Contact Mikr.us support if Docker is completely broken

### 3.3 Prevent future Docker breakage
- [x] Hold Docker packages: `apt-mark hold docker.io containerd runc docker-compose-v2`
- [x] Blacklist Docker in unattended-upgrades config (if installed)

### 3.4 Clone private repo to server (deploy key)
- [x] Generate deploy key on server:
  ```bash
  ssh-keygen -t ed25519 -f /root/.ssh/github_deploy -N ""
  cat /root/.ssh/github_deploy.pub
  ```
- [x] Add the public key as a **read-only deploy key** in GitHub: `github.com/empi91/daily_mevo/settings/keys`
- [x] Configure SSH on server to use the deploy key:
  ```bash
  cat >> /root/.ssh/config << 'EOF'
  Host github.com
      IdentityFile /root/.ssh/github_deploy
      StrictHostKeyChecking accept-new
  EOF
  ```
- [x] Clone: `git clone git@github.com:empi91/daily_mevo.git /app`

### 3.5 Create production `.env` on server
- [x] Write `/app/.env` with real values (never committed to git):
```env
MEVO_ENVIRONMENT=production
MEVO_APP_VERSION=0.1.0
MIKRUS_APP_PORT=<20000+ID>

# Supabase (from Phase 2.1 — transaction mode pooler, port 6543)
MEVO_DATABASE_URL=postgresql+asyncpg://postgres.[ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
MEVO_SUPABASE_URL=https://your-project.supabase.co
MEVO_SUPABASE_ANON_KEY=your-anon-key
```

---

## Phase 4: First Deploy (Agent via SSH)

### 4.1 Build and start
- [x] `cd /app && docker compose build && docker compose up -d`

### 4.2 Verify container health
- [x] `docker compose ps` — container running (healthy)
- [x] `docker compose logs --tail 50` — no errors
- [x] `docker stats --no-stream` — memory 41MB at idle

### 4.3 Test health endpoint on server
- [x] `curl -s http://localhost:20312/health` returns `{"status":"ok",...}`

### 4.4 Test external access via wykr.es
- [x] Open `https://srv66-20312.wykr.es/health` — returns OK
- [x] Open `https://srv66-20312.wykr.es/docs` — FastAPI Swagger UI (200 OK)

**If wykr.es doesn't work** (troubleshooting):
1. Verify port mapping matches panel allocation: `curl -X POST https://api.mikr.us/porty -d "srv=<server>&key=<api_key>"`
2. Check internal access first: `curl http://localhost:8000/health` on the server
3. Try `domena <20000+ID>` command on server for alternative subdomain
4. Try direct HTTP (no TLS): `http://<server>.mikr.us:<20000+ID>/health`
5. For `mikrus.cloud` subdomain: app must listen on IPv6 (`--host ::` instead of `0.0.0.0`)

### 4.5 Resource usage baseline
- [x] Record idle memory usage: 41MB / 768MB (5.38%)
- [x] `df -h /` — 6.6GB free (29% used)

---

## Phase 4.5: Supabase Database Wiring (Agent)

### 4.5.1 Add database dependencies
- [x] Add `asyncpg>=0.30.0` to `pyproject.toml` dependencies
- [x] Run `uv sync`

### 4.5.2 Extend `Settings` with database config
- [x] Add to `Settings` class in `main.py`:
```python
database_url: str | None = None
supabase_url: str | None = None
supabase_anon_key: str | None = None
```

### 4.5.3 Add DB pool to lifespan
- [x] Initialize asyncpg connection pool in `lifespan` context manager (with `statement_cache_size=0` for pgbouncer compatibility):
```python
import asyncpg

@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = None
    if settings.database_url:
        dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        pool = await asyncpg.create_pool(dsn, min_size=2, max_size=5)
        app.state.db_pool = pool
    yield
    if pool:
        await pool.close()
```

### 4.5.4 Extend health endpoint with DB status
- [x] Update `/health` to report database connectivity:
```python
@app.get("/health")
async def health() -> dict:
    db_status = "not_configured"
    if hasattr(app.state, "db_pool") and app.state.db_pool:
        try:
            async with app.state.db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            db_status = "connected"
        except Exception:
            db_status = "disconnected"
    return {
        "status": "ok",
        "version": settings.app_version,
        "environment": settings.environment,
        "database": db_status,
    }
```

### 4.5.5 Rebuild and verify on server
- [x] Rebuild container: `cd /app && git pull && docker compose build && docker compose up -d`
- [x] Verify health with DB: `curl -s http://localhost:20312/health` returns `"database": "connected"`
- [x] Verify external: `curl -s https://srv66-20312.wykr.es/health` returns `"database": "connected"`

### 4.5.6 Verify latency (Helsinki → Frankfurt)
- [x] From the server, test round-trip time (result: 55.5ms avg):
```bash
docker compose exec app python -c "
import asyncio, time, asyncpg
async def check():
    conn = await asyncpg.connect('postgresql://...')
    start = time.monotonic()
    for _ in range(10):
        await conn.fetchval('SELECT 1')
    elapsed = (time.monotonic() - start) / 10 * 1000
    print(f'Avg query latency: {elapsed:.1f}ms')
    await conn.close()
asyncio.run(check())
"
```
- [x] Expected: 30–50ms per query. Actual: 55.5ms (acceptable with transaction pooler overhead).

---

## Phase 5: Deploy & Rollback Scripts (Agent)

### 5.1 Create `deploy.sh`
- [x] Tags current image as `:prev` before deploying (rollback safety net)
- [x] Pulls, builds, restarts, then runs health check
- [x] Uses SSH config alias (`mikrus`), no hardcoded credentials

### 5.2 Create `rollback.sh`
- [x] Stops container, restores `:prev` tagged image, restarts
- [x] Runs health check after rollback
- [x] Fails gracefully if no `:prev` image exists

### 5.3 Final smoke test
- [x] `curl -s https://srv66-20312.wykr.es/health` → OK
- [x] `curl -s https://srv66-20312.wykr.es/docs` → Swagger HTML (200 OK)
- [x] `ssh mikrus 'docker stats --no-stream'` → container 41MB
- [x] `ssh mikrus 'docker compose -f /app/docker-compose.yml logs --tail 10'` → no errors
- [x] `ssh mikrus 'df -h /'` → 6.6GB free
- [x] `./deploy.sh` runs idempotently (redeploy test)

---

## Edge Case Reference

| Edge Case | Detection | Mitigation |
|-----------|-----------|------------|
| Docker-in-LXC AppArmor (CVE-2025-52881) | `docker run --rm hello-world` fails | Pin Docker version or set AppArmor unconfined (Phase 3.2) |
| OOM with 768MB limit | `docker stats` shows >500MB idle | Single worker already set; future: `pool_size=5`, `--limit-max-requests` |
| Port conflict on Mikr.us | `docker compose up` bind error | `ss -tlnp \| grep <port>` to find conflicting process |
| wykr.es TLS failure | HTTPS timeout or cert error | Fallback: `domena` command or direct HTTP access |
| Supabase connection failure | `/health` returns `"database": "disconnected"` | Check connection string, verify Frankfurt region, ensure port 6543 (transaction mode pooler) |
| Supabase pool exhaustion | Timeouts on DB queries under load | `max_size=5` matches single-worker setup; raise only if worker count grows |
| Docker build fails in LXC | Build step error in `docker compose build` | Check disk space (`df -h`), check Docker daemon logs (`journalctl -u docker`) |
| Git clone auth failure | Permission denied on clone | Verify deploy key added in GitHub repo settings; test with `ssh -T git@github.com` on server |

---

## Files Created/Modified

| File | Action | Phase |
|------|--------|-------|
| `main.py` | Rewrite | 1.1 |
| `main.py` | Edit (add DB pool + health DB status) | 4.5 |
| `pyproject.toml` | Edit (add pydantic-settings) | 1.2 |
| `pyproject.toml` | Edit (add asyncpg) | 4.5 |
| `.env.example` | Create | 1.3 |
| `Dockerfile` | Create | 1.4 |
| `docker-compose.yml` | Create | 1.5 |
| `.dockerignore` | Create | 1.6 |
| `deploy.sh` | Create | 5.1 |
| `rollback.sh` | Create | 5.2 |

Server-only (not in git): `/app/.env`

---

## Verification (End-to-End)

After all phases complete, these must all pass:

1. `curl https://<server>-<20000+ID>.wykr.es/health` returns `{"status":"ok","version":"0.1.0","environment":"production","database":"connected"}`
2. `curl https://<server>-<20000+ID>.wykr.es/docs` returns Swagger UI
3. `ssh mikrus 'docker stats --no-stream'` shows container running, memory <200MB idle
4. `./deploy.sh` completes without errors (idempotent redeploy)
5. `./rollback.sh` completes without errors (rollback + restore)
