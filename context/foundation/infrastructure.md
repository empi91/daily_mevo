---
project: MevoStats
researched_at: 2026-06-04
recommended_platform: Mikr.us
runner_up: Railway
context_type: mvp
tech_stack:
  language: Python 3.12
  framework: FastAPI
  runtime: uvicorn (async)
deployment_type: single
estimated_monthly_cost: "~$2.12 (~7.69 PLN)"
linux_admin_required: true
---

## Recommendation

**Deploy on Mikr.us (plan 2.1).** Mikr.us is the cheapest viable option at ~$2.12/month (75 PLN/year brutto, prepaid annually). It supports Docker on the 2.1 plan, includes shared PostgreSQL, and provides automatic TLS via subdomains. The REST API with `/exec` endpoint enables scripted deployments. The developer has some Linux experience — Mikr.us fits this profile at less than half the cost of any PaaS alternative. The project uses external Supabase for the primary database, so the shared PostgreSQL limit (100MB soft) is not a blocking constraint. Mikr.us servers are in Helsinki, Finland (Hetzner datacenter) with low latency to Tricity, Poland.

## Platform Comparison

| Platform | CLI-first | Managed/VPS | Agent docs | Deploy API | MCP | Cost | Total (/12) |
|---|---|---|---|---|---|---|---|
| **Railway** | Pass (2) | Pass (2) | Pass (2) | Pass (2) | Pass (2) | Partial (1) | **11** |
| **Fly.io** | Pass (2) | Pass (2) | Pass (2) | Pass (2) | Pass (2) | Partial (1) | **11** |
| **Mikr.us** | Partial (1) | Partial (1) | Partial (1) | Partial (1) | Fail (0) | Pass (2) | **6** |

Mikr.us wins on cost (the decisive criterion per developer interview) despite trailing on DX and agent tooling. Railway is the runner-up if budget increases to $5/month. Fly.io is third — similar cost to Railway but requires Dockerfile maintenance and has unpredictable usage-based billing.

## Anti-Bias Cross-Check: Mikr.us

### Devil's Advocate — Weaknesses

1. **Docker-in-LXC is inherently fragile** — Docker runs inside an LXC container, not on bare metal. Engine version bumps have broken the platform before (28.5.2 incident, late 2024). One uncontrolled auto-update can cause hours of downtime.
2. **Shared IPv4 with port mapping** — no standard ports (80/443). You get 3 ports by default (SSH at `10000+ID`, two general at `20000+ID` and `30000+ID`), expandable to 10 via panel. TLS is handled automatically via subdomains, but custom domains require manual nginx + Cloudflare setup.
3. **1GB RAM is tight for Docker** — Docker daemon (~150MB) + FastAPI + Python runtime (~120MB) leaves ~730MB. Add nginx and you're near the limit. OOM kills under load are possible.
4. **No SLA, no guaranteed uptime** — hobby hosting with fair-play resource limits. No status page, no incident communication beyond the Facebook group.
5. **Annual prepayment** — 75 PLN (~$21) upfront. If the project dies in month two, you've overpaid. The 7 PLN trial mitigates this for one month.

### Pre-Mortem — How This Could Fail

The developer chose Mikr.us for the price. Docker-in-LXC worked initially but broke on a Docker version bump in month two (3 hours downtime). The shared PostgreSQL hit its 100MB soft limit in month three — database went read-only, 12 hours of missed snapshots. By month four, every workaround was fragile and undocumented. The `*.mikrus.cloud` subdomain started returning 502s during peak hours from shared TLS proxy overload. Operational knowledge lived only in the developer's head. When the developer went on vacation in month five, nobody could maintain the service.

### Unknown Unknowns

1. **LXC blocks custom kernel modules** — some Docker networking modes (overlay networks, certain iptables rules) fail silently.
2. **Shared PostgreSQL has no backups and no proactive limit warning** — database goes read-only at 100MB, no alert beforehand.
3. **The `/exec` API key has no scoping, rate limiting, or IP allowlisting** — if the key leaks, anyone can execute arbitrary commands on your server. The endpoint has a 60-second execution timeout.
4. **Fair-play CPU/IO limits are opaque** — the boundary is undefined until you hit it.
5. **Annual billing with no monthly option** — locks you in after the 7 PLN trial. Multi-year discounts (15% for 2 years, 17% for 3 years) deepen the lock-in.

## Mikr.us Platform Reference

### Server Specs (Plan 2.1)

- **RAM**: 1 GB
- **Storage**: 10 GB NVMe SSD
- **Hardware**: Intel i7-8700 or AMD Ryzen 5, 128 GB RAM host
- **Virtualization**: LXC containers (shared kernel with host)
- **Bandwidth**: 1 Gbps shared
- **Datacenter**: Hetzner, Helsinki, Finland
- **Root access**: Yes (full root via SSH)

### SSH Access

- **Port**: `10000 + machine_number` (e.g., machine 123 → port 10123)
- **User**: root
- **Host**: varies per server (e.g., `srv03.mikr.us`, `srv06.mikr.us`)
- **Credentials**: provided in welcome email, resettable in panel
- **CRITICAL**: Do NOT use port 22 — five failed attempts on port 22 = IP blocked for 24 hours
- **Key setup**: `ssh-keygen -t rsa -b 4096 -C mikrus -f ~/.ssh/mikrus` then `ssh-copy-id -i ~/.ssh/mikrus -p PORT root@srvXX.mikr.us`

### Port Allocation

- 3 ports by default per VPS:
  - `10000 + ID` — reserved for SSH
  - `20000 + ID` — general purpose (TCP)
  - `30000 + ID` — general purpose (TCP)
- Expandable to 10 total ports (free) via control panel
- UDP available on 200XX and 300XX port ranges
- IPv4 is shared (port forwards, not a dedicated IP)
- IPv6 is full and dedicated — unlimited services can listen on IPv6

### Subdomain and TLS

Three mechanisms, all with automatic TLS termination by the platform (your app serves plain HTTP):

1. **wykr.es** (IPv4, simplest): `serwer-port.wykr.es` (e.g., `frog01-20100.wykr.es`). Restricted to ports from your panel allocation. HTTP/HTTPS only.
2. **mikrus.cloud** (IPv6): `serwer-port.mikrus.cloud`. Any port number allowed. **App MUST listen on IPv6, not IPv4.**
3. **`domena` command** (IPv6, flexible): run `domena 555` on the server for a random subdomain on port 555, or `domena testuje123.byst.re 1234` for a custom subdomain. App must listen on IPv6.

Custom domains supported via Cloudflare DNS or panel configuration (e.g., `mojaplikacja.bieda.it`).

### REST API (11 Endpoints)

Base URL: `api.mikr.us`. All endpoints are POST. Authentication: `key` as POST parameter or `Authorization` header. API key from `mikr.us/panel/?a=api`.

| Endpoint | Extra Params | Cache | Description |
|---|---|---|---|
| `/info` | — | 60s | Server info (`.bash` variant available) |
| `/serwery` | — | 60s | Lists all servers owned by user |
| `/restart` | — | none | Restarts the server |
| `/logs` | — | none | Last 10 log entries |
| `/logs/{ID}` | ID (path) | none | Specific log entry by ID |
| `/amfetamina` | — | none | 30-min RAM + disk I/O boost (once per 6 hours) |
| `/db` | — | 60s | Returns database credentials |
| `/exec` | `cmd` (POST) | none | Execute shell command. **60-second timeout.** |
| `/stats` | — | 60s | Disk, memory, uptime metrics |
| `/porty` | — | 60s | Returns assigned TCP/UDP ports |
| `/cloud` | — | none | Cloud services and statistics |
| `/domain` | `port`, `domain` (POST) | none | Domain assignment (`"-"` for auto-generated) |

All endpoints require `srv` (server name) + `key` (API key) as POST parameters.

### Shared PostgreSQL

- Request access via panel at `mikr.us/panel/?a=postgres`
- Credentials provided: host, login, password, database name
- Port: 5432
- **Limit**: 100MB per user (soft limit — database goes read-only when exceeded, no proactive warning)
- One database per user
- Available on plans 2.x and above
- No backups provided
- Also available: MySQL, MongoDB (shared)

### LXC-Specific Limitations

1. No kernel changes — cannot install custom kernel or alternative OS
2. No direct block device access
3. No reliable SWAP files
4. No standard NFS mounting (use FUSE-based alternatives)
5. No mail servers (shared IPv4 prohibits port 25/587)
6. No DNS servers (port 53 unavailable)
7. Port 22 blocked (SSH on assigned port only)
8. Some Docker networking modes may fail silently (overlay networks, certain iptables rules)

### Process Persistence

- **systemd** (recommended for production): create `/etc/systemd/system/myapp.service`, `systemctl enable myapp`
- **screen**: `screen`, run app, Ctrl+A+D to detach — does NOT survive reboot
- **Docker restart policy**: `restart: unless-stopped` in docker-compose.yml

### Backup (Strych)

- 200MB per user on shared backup server
- Activation via panel ("Backup" section)
- Tool: `rsnappush` (rsync-based incremental)
- Target: `strych.mikr.us` via SSH
- Frequency: daily or weekly recommended

### Additional Services

- **Amfetamina**: 30-min RAM + disk I/O boost, once per 6 hours (via panel or `/amfetamina` API)
- **WireGuard VPN**: free on 2.0+, 1 Gbps, Helsinki, activated in panel
- **Storage**: paid network disk (125GB–1TB), mounted at `/storage/`

## Operational Story

- **Preview deploys**: Not available. Mikr.us is a single VPS — no branch preview URLs. Test locally with Docker Compose before deploying.
- **Secrets**: Environment variables in `.env` file on the server (excluded from git), passed via Docker Compose `env_file`. API key from `mikr.us/panel/?a=api`. No platform-level secret management.
- **Rollback**: Manual. Keep the previous Docker image tagged (e.g., `app:prev`). Rollback: `docker compose down && docker tag app:prev app:latest && docker compose up -d`. No platform-level rollback.
- **Approval**: All actions are manual or scripted. The `/exec` API allows remote command execution with the API key (60s timeout). Destructive actions (restart, data deletion) should be SSH-only.
- **Logs**: Via SSH (`docker compose logs -f`) or REST API (`POST api.mikr.us/logs`). No log aggregation — consider Grafana Cloud free tier if needed later.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Docker engine update breaks LXC | Devil's advocate | Medium | High | Pin Docker version, disable auto-updates, test upgrades manually |
| 1GB RAM OOM under load | Devil's advocate | Medium | Medium | Use Supabase (not local DB), keep Docker image lean, set `mem_limit` in Compose |
| Shared PostgreSQL hits 100MB limit | Pre-mortem | Medium | High | Use Supabase as primary DB; if using shared PG, run aggressive data cleanup cron |
| `*.mikrus.cloud` TLS proxy overload (502s) | Pre-mortem | Low | Medium | Use `wykr.es` subdomain as alternative; set up custom domain with Cloudflare as fallback |
| `/exec` API key leak → unauthorized access | Unknown unknowns | Low | High | Never commit API key, rotate periodically, use GitHub Secrets for CI/CD |
| Fair-play throttling on CPU/IO | Unknown unknowns | Low | Medium | Keep 5-min collection cycle lightweight; batch aggregation to off-peak hours |
| Annual lock-in, project abandoned early | Devil's advocate | Medium | Low | Use 7 PLN trial month first; only commit to annual after validating setup |
| No backups on shared PostgreSQL | Unknown unknowns | Low | High | Use Supabase as primary DB with its own backup policy |
| Docker networking fails silently in LXC | Unknown unknowns | Low | Medium | Test all networking modes during trial month; avoid overlay networks |

## Getting Started

1. **Purchase trial**: Buy the 7 PLN one-month trial at mikr.us. Select the Mikrus 2.1 plan.

2. **Get credentials**: Note from the welcome email: server name (e.g., `srv03`), machine number (for SSH port = `10000 + number`). Get API key from `mikr.us/panel/?a=api`.

3. **Set up SSH key access**:
   ```bash
   ssh-keygen -t rsa -b 4096 -C mikrus -f ~/.ssh/mikrus
   ssh-copy-id -i ~/.ssh/mikrus -p <10000+ID> root@<server>.mikr.us
   ```

4. **SSH in and verify Docker**:
   ```bash
   ssh -p <10000+ID> root@<server>.mikr.us
   docker --version && docker compose version
   ```
   Pin Docker version to avoid LXC compatibility issues — disable unattended-upgrades for Docker packages.

5. **Request PostgreSQL** (optional fallback): Go to `mikr.us/panel/?a=postgres` to get shared DB credentials.

6. **Check assigned ports**: Run `curl -X POST https://api.mikr.us/porty -d "srv=<server>&key=<api_key>"` or check the panel. Note your `20000+ID` port for the web app.

7. **Create project structure on the server**:
   ```bash
   mkdir -p /app && cd /app
   ```

8. **Create `docker-compose.yml`** in the repo:
   ```yaml
   services:
     app:
       build: .
       ports:
         - "<20000+ID>:8000"
       env_file: .env
       restart: unless-stopped
       mem_limit: 768m
   ```
   No nginx needed if using `wykr.es` or `mikrus.cloud` subdomain (platform handles TLS termination). Your app listens on plain HTTP port 8000 inside the container, mapped to the assigned external port.

9. **Create deploy script** (`deploy.sh`):
   ```bash
   #!/bin/bash
   SERVER="root@<server>.mikr.us"
   PORT="<10000+ID>"
   ssh -p $PORT $SERVER 'cd /app && git pull && docker compose build && docker compose up -d'
   ```
   Or via REST API (60s timeout — for longer builds, use SSH):
   ```bash
   curl -X POST https://api.mikr.us/exec \
     -d "srv=<server_id>&key=<api_key>&cmd=cd /app && git pull && docker compose build && docker compose up -d"
   ```

10. **Configure environment variables**: Create `.env` on the server (not in git) with Supabase connection string, API keys, and app settings.

11. **Verify**: Access your app at `https://<server>-<20000+ID>.wykr.es/docs` to see the FastAPI Swagger UI.

## Mikr.us Documentation Resources

| Source | URL | Format | Agent-usable |
|---|---|---|---|
| Wiki (rendered) | wiki.mikr.us | Hugo HTML, Polish | Yes (clean, predictable slugs, ~51 pages) |
| Wiki source | github.com/Mrugalski-pl/mikrus-dokumentacja | Raw Markdown, Polish | Yes (git-cloneable) |
| REST API docs | api.mikr.us | HTML page, Polish | Yes (11 endpoints) |
| Community MCP | lobehub.com/mcp/yeahneck-mikrus-mcp | MCP/SSE protocol | Yes (51 wiki pages, docs only — not operational) |
| Community CLIs | github.com/qba73/mikrus | Go source | Reference only |
| Blog guides | blog.mikr.us/tags/poradnik/ | HTML, Polish | Partially |

## Out of Scope

- Docker image optimization (but Docker Compose structure is in Getting Started)
- CI/CD pipeline setup (but `/exec` API and deploy script enable GitHub Actions integration)
- Production-scale architecture (multi-region, HA, DR)
- Server hardening / security beyond basic firewall
- Nginx reverse proxy configuration (not needed when using platform subdomain TLS)

## Custom Domain

`dailymevo.pl` is the public-facing domain, routed via Cloudflare Tunnel (`cloudflared` systemd service on the VPS). DNS and TLS are managed by Cloudflare (free tier). The old `srv66-20312.wykr.es` URL remains functional as a fallback. Domain registered at OVH.pl (~73 PLN/yr renewal).
