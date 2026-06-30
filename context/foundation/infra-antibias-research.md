---
project: MevoStats
researched_at: 2026-05-29
platforms_evaluated:
  - Railway
  - Fly.io
  - Mikr.us
tech_stack: Python 3.12 / FastAPI / asyncpg / React+Vite / Supabase (external DB)
purpose: Anti-bias cross-check and 6-month cost projection for infrastructure decision
---

# Infrastructure Anti-Bias Research

Three-platform deep dive: full Devil's Advocate / Pre-Mortem / Unknown Unknowns cross-check, 6-month pricing projection, and (for Mikr.us) a documentation accessibility audit.

---

## 1. Railway

### Devil's Advocate — Weaknesses

1. **$5/month floor with no free tier** — the 30-day trial is a ticking clock. If you pause the project for a month, you still pay the subscription fee. Fly.io and Hetzner let you destroy resources and pay nothing.
2. **No SSH access** — when something goes wrong inside the container, you cannot shell in and debug. You're limited to logs and redeployment. A corrupted state requires a full redeploy.
3. **Hobby plan resource opacity** — while not capped at 2 services (corrected from baseline), the plan has resource limits that aren't prominently documented. A FastAPI app + APScheduler is fine, but adding a React frontend service + background worker could bump into undocumented limits.
4. **US-West-1 primary region** — your users are in Tricity, Poland. Railway's primary region is US-West. EU regions exist but are less documented for availability and performance. Latency to Supabase (if US-hosted) compounds the round-trip.
5. **Containerized databases, not managed** — Railway's one-click PostgreSQL has no automated backups out of the box. Moot for this project (using Supabase), but limits future flexibility.

### Pre-Mortem — How Railway Could Fail in 6 Months

The developer deployed MevoStats on Railway in June 2026, excited by the frictionless push-to-deploy experience. For the first two months, everything worked — the FastAPI app collected Mevo snapshots every 5 minutes via APScheduler, and the $5/month Hobby plan covered costs easily.

By month three, problems started. The developer added the React frontend as a second Railway service, and usage credits started running out before month-end. The $5 included credit that seemed generous for one service wasn't enough for two. Overage charges appeared — small at first, but unpredictable. The developer considered moving the frontend to Cloudflare Pages but hadn't architected CORS or API URL configuration for a split deployment.

Month five brought the real disaster. A Railway platform update changed container networking behavior, and the APScheduler jobs started failing silently — no crash, just missed collection windows. Without SSH access, the developer couldn't inspect the running process. Logs showed the app was healthy, but the scheduler wasn't firing. Three days of missed snapshots before the bug was identified through code-level logging changes and redeployment. The historical data gap was permanent.

The final blow: Railway's EU region had higher latency to Supabase's US-hosted PostgreSQL than expected. The 5-minute collection cycle worked fine, but user-facing queries for station charts took 800ms+ round-trips, making the station detail page feel sluggish on mobile.

### Unknown Unknowns

1. **APScheduler duplicate execution during deploys**: Railway performs zero-downtime deploys by spinning up a new container before killing the old one. If APScheduler uses an in-memory job store, both instances run simultaneously for a brief window — duplicate snapshot collection. This is subtle and won't surface in testing.
2. **Credit burn rate opacity**: Railway's usage dashboard updates with a delay. You won't know you've exceeded the $5 credit until the billing cycle closes. No real-time alert at a custom threshold.
3. **Hobby plan is not meant for production**: Railway's terms position the Hobby plan for personal projects. If MevoStats gains real users, you may need to upgrade to Pro ($20/month) for SLA, priority support, and higher limits — a 4x cost jump with no intermediate tier.
4. **Remote-only MCP server**: Railway's MCP server requires OAuth flow and internet access. If you're working offline or behind a restrictive network, the MCP server is unreachable. CLI still works.
5. **Supabase free tier + Railway Hobby = two ticking clocks**: Supabase's free tier pauses projects after 7 days of inactivity. If both platforms have inactivity gotchas, a week-long vacation could pause your database and miss snapshots.

### 6-Month Pricing

| Item | Monthly | 6 Months |
|---|---|---|
| Hobby plan subscription | $5.00 | $30.00 |
| Usage (FastAPI + APScheduler, within $5 credit) | ~$0.00 overage | $0.00 |
| **Total** | **$5.00** | **$30.00 (~€27.50)** |

- **Price predictability**: Fixed — $5/month unless you exceed the included credit.
- **Pause for 1 month**: Scale services to zero = $0 usage, but still pay $5 subscription.
- **One-time setup cost**: $0 (free $5 trial credit available for new accounts, 30 days).
- **Overage rates**: $20/vCPU/month, $10/GB-RAM/month, $0.05/GB egress.

---

## 2. Fly.io

### Devil's Advocate — Weaknesses

1. **No free tier at all** — $4/month from day one, credit card required at signup. The $5 trial credit window has tightened to "2 hours or 7 days, whichever comes first" — barely enough to evaluate. If you forget to tear down resources, you pay immediately.
2. **Fly Postgres is effectively deprecated** — the unmanaged option receives no further investment. The new Managed Postgres starts at $38/month, which is absurd for an MVP. If you ever need co-located DB, there's no affordable path.
3. **Usage-based pricing is unpredictable** — compute is per-second, bandwidth per-GB, volumes per-GB/month, snapshots billable since January 2026. Small costs add up in ways that are hard to forecast for a solo developer without billing history.
4. **No dedicated rollback command** — `fly deploy` with a previous image tag is the rollback mechanism. You need to know which image to revert to. No `fly rollback` equivalent exists. In a production incident, this adds friction.
5. **Dockerfile required** — unlike Railway's auto-detect, Fly.io requires you to maintain a Dockerfile. For a solo developer new to Docker, this is additional complexity on every dependency change.

### Pre-Mortem — How Fly.io Could Fail in 6 Months

The developer chose Fly.io for the full VM flexibility and ~$4/month price tag. Initial setup was slower than expected — writing a Dockerfile for FastAPI, configuring `fly.toml`, and understanding the Fly networking model took a full evening. But the app deployed and APScheduler started collecting Mevo snapshots.

Month two surfaced the first surprise: the dedicated IPv4 address ($2/month) was a silent cost the developer hadn't budgeted. Without it, external services sometimes couldn't reach the app reliably. The developer kept it, pushing monthly costs to $4+.

Month three brought a memory crisis. The shared-cpu-1x machine with 256MB RAM was fine for FastAPI alone, but as the snapshot collection history grew, the aggregation queries started consuming more memory. Python's garbage collector couldn't reclaim fast enough during peak query periods. The app OOM-killed twice in one week, each time losing the APScheduler state and missing collection windows until the machine auto-restarted.

The developer upgraded to 512MB ($4/month compute + $2 IPv4 = $6/month), exceeding their $5 budget ceiling. But the real frustration was operational: every config change required editing `fly.toml` and redeploying. Fly's CLI was powerful but assumed Docker fluency the developer didn't have. When a Python dependency needed a system-level library, debugging the Dockerfile took longer than writing the feature.

By month five, the developer realized they were spending more time on infrastructure than on product. The combination of Docker maintenance, memory tuning, and usage-based billing anxiety made Fly.io feel like running a VPS without the VPS's freedom.

### Unknown Unknowns

1. **Machine stop/start semantics**: Fly.io machines can be stopped to save costs, but a stopped machine still holds its IPv4 allocation ($2/month). To truly stop paying, you must destroy the machine — but then you lose its configuration and volume attachments.
2. **256MB is dangerously small for Python**: Python's runtime overhead (interpreter + loaded libraries) consumes 80-120MB before your app code runs. FastAPI + Pydantic + asyncpg + APScheduler leaves very little headroom. A single large request can trigger OOM.
3. **Supabase connection goes over public internet**: Fly.io's private networking (6PN/WireGuard) only covers Fly-to-Fly communication. Connections to external Supabase traverse the public internet with no private link option. Latency depends entirely on region placement.
4. **`fly deploy` builds locally by default**: The Docker image is built on your laptop and pushed. On a slow connection, this takes minutes per deploy. Remote builders exist but add configuration complexity and occasional queuing delays.
5. **Volume data is not replicated**: If you use a Fly volume for any persistent data, it lives on a single physical host. If that host fails, your data is gone until Fly restores from a snapshot (which are now billable). For this project the risk is low (Supabase holds the data), but any local state (APScheduler job store, logs) is ephemeral.

### 6-Month Pricing

| Item | Monthly | 6 Months |
|---|---|---|
| shared-cpu-1x, 256MB (24/7) | ~$2.00 | ~$12.00 |
| Dedicated IPv4 | $2.00 | $12.00 |
| Egress (<1 GB/month) | ~$0.02 | ~$0.12 |
| **Total** | **~$4.02** | **~$24.12 (~€22.00)** |

- **Price predictability**: Variable — usage-based, per-second billing. Predictable at steady state but can spike with memory upgrades.
- **Pause for 1 month**: Stop machine = $0 compute, but still pay $2/month for IPv4. Destroy machine to fully stop paying.
- **One-time setup cost**: $0 ($5 trial credit for new accounts, 2 hours or 7 days).
- **Risk**: if 256MB is insufficient, upgrading to 512MB raises compute to ~$4/month → total ~$6/month, exceeding budget.

---

## 3. Mikr.us

### Devil's Advocate — Weaknesses

1. **Docker-in-LXC is inherently fragile** — the OpenVZ/LXC virtualization layer means Docker runs inside a container, not on bare metal. Docker engine version bumps have broken things before (the 28.5.2 incident in late 2024). One uncontrolled auto-update can cause hours of downtime.
2. **Shared IPv4 with port mapping** — no standard ports (80/443). You rely on `*.mikrus.cloud` subdomains for TLS, which the platform terminates automatically. Custom domains require manual nginx + Cloudflare setup. Some HTTP clients and libraries assume standard ports.
3. **1GB RAM is dangerously tight for Docker Compose** — the Docker daemon itself uses 100-200MB. FastAPI + Python runtime uses another 100-150MB. That leaves 650-800MB for everything else. Add a reverse proxy and you're at the limit. OOM kills under load are likely.
4. **No SLA, no guaranteed uptime** — Mikr.us is hobby hosting. If the shared host has issues on a weekend, you wait. No status page, no incident communication beyond the Facebook group.
5. **Annual prepayment with no refund** — 92.25 PLN (~$25) upfront for a year. If the project dies in month two, you've overpaid. The 7 PLN trial mitigates this, but only for one month.

### Pre-Mortem — How Mikr.us Could Fail in 6 Months

The developer chose Mikr.us for the unbeatable ~$2/month effective price. Initial setup was rough — the Docker-in-LXC environment required specific configuration, and the first Docker Compose deployment failed because the combined memory of FastAPI + nginx exceeded the 1GB limit. After switching to the shared PostgreSQL (instead of containerizing it) and using a lightweight process manager instead of Docker Compose for the app, things stabilized.

Month two, a Docker engine update pushed by the host OS broke container networking — the known LXC compatibility issue resurfaced with a new Docker version. The fix required manual SSH intervention: pinning Docker to a specific version and restarting the daemon. Three hours of downtime, dozens of missed snapshots.

Month three brought the database problem. The shared PostgreSQL hit its soft 200MB limit as raw snapshot data accumulated. At 288 snapshots/day (one every 5 minutes) across ~100 Mevo stations, the raw data table grew faster than expected. The database went read-only, and 12 hours of snapshots were lost before the developer noticed — there were no alerts, no monitoring, just silence.

By month four, the developer had learned to work around the constraints: aggressive data aggregation to keep PostgreSQL under 200MB, Docker version pinning, manual deploy scripts via the `/exec` API. But every workaround was fragile and undocumented. When the developer went on vacation in month five, nobody could maintain the service — the operational knowledge was entirely in their head.

The final straw: the `*.mikrus.cloud` subdomain started returning intermittent 502 errors during peak hours. The shared TLS termination proxy was overloaded by other tenants on the same host. No fix available — it's shared infrastructure with fair-play limits, not guaranteed resources.

### Unknown Unknowns

1. **Kernel module restrictions**: OpenVZ/LXC virtualization means you cannot load custom kernel modules. This affects some Docker networking modes (overlay networks, certain iptables rules) and can cause subtle failures that only manifest at runtime.
2. **Shared PostgreSQL has no backup mechanism** — if the shared database host fails, your data is gone. The 200MB soft limit is enforced reactively (database goes read-only), not proactively (no warning before the limit). Since this project uses external Supabase, this is only relevant if you use the included shared DB for anything.
3. **The `/exec` API endpoint has minimal security** — authentication is a single API key with no scoping, no rate limiting, no IP allowlisting. If the key leaks (e.g., committed to a public repo), anyone can execute arbitrary commands on your server.
4. **Annual billing locks you in** — 92.25 PLN/year with no monthly option (except the 7 PLN one-time trial). If the service doesn't work out after month three, you've prepaid for nine months you won't use. Multi-year discounts (15% for 2 years, 17% for 3 years) deepen the lock-in.
5. **Fair-play resource limits are opaque** — Mikr.us enforces "fair play" CPU and I/O limits, not strict quotas. What counts as "fair" is undefined. A 5-minute data collection cycle with occasional aggregation queries should be fine, but there's no way to know the boundary until you hit it.

### 6-Month Pricing

| Item | Monthly (effective) | 6 Months |
|---|---|---|
| Mikrus 2.1 (92.25 PLN/year gross) | ~7.69 PLN (~$2.12) | ~46.13 PLN (~$12.70) |
| Shared PostgreSQL | Included | Included |
| TLS via *.mikrus.cloud | Included | Included |
| **Total** | **~$2.12 (~€1.82)** | **~$12.70 (~€10.92)** |

- **Price predictability**: Fixed — annual prepaid, no usage-based charges.
- **Pause for 1 month**: No savings — annual prepaid with no refund.
- **One-time setup cost**: 7 PLN (~$1.93) optional 1-month trial. Full year: 92.25 PLN (~$25.41) upfront.
- **Multi-year discounts**: 15% off for 2 years, 17% off for 3 years.

**Note**: The effective 6-month cost is ~$12.70, but you must pay the full year upfront (92.25 PLN / ~$25.41). There is no 6-month billing option.

---

## Mikr.us Documentation — Accessibility Audit

The initial research scored Mikr.us as "Fail" on agent-accessible documentation. A deep dive reveals the picture is significantly better than expected:

### Sources Found

| Source | URL | Language | Format | Agent-parseable? |
|---|---|---|---|---|
| **Wiki** | wiki.mikr.us | Polish | Hugo static HTML (clean) | Yes — predictable slugs, ~51 pages |
| **Wiki source** | github.com/Mrugalski-pl/mikrus-dokumentacja | Polish | Raw Markdown in `/content` | Yes — git-cloneable, community-maintained |
| **REST API docs** | api.mikr.us | Polish | Simple HTML page | Yes — 11 endpoints listed, small and stable |
| **Community MCP server** | lobehub.com/mcp/yeahneck-mikrus-mcp | Polish | MCP protocol (SSE) | Yes — serves all 51 wiki pages via MCP |
| **Community CLIs** | github.com/qba73/mikrus, github.com/pwittchen/mikrus-cli | English (code) | Go source | Usable as reference |
| **Blog/guides** | blog.mikr.us/tags/poradnik/ | Polish | HTML | Partially — blog format, not structured |
| **Paid courses** | docker.mikr.us, nginx.mikr.us, git.mikr.us, ansible.mikr.us | Polish | Video (paywalled) | No |
| **Facebook group** | facebook.com/groups/mikrusy/ | Polish | Social media | No |

### Revised Assessment

The wiki Markdown source on GitHub and the community MCP server are genuine assets. An AI agent can:
- Clone the wiki repo and read all 51 pages as raw Markdown
- Use the MCP server at `https://srv47-40231.wykr.es/sse` to query wiki content
- Call the REST API `/exec`, `/logs`, `/restart`, `/info` endpoints for operations
- Use community Go CLIs as operational reference

**Remaining gaps**: all content is Polish-only (agent must translate), no OpenAPI spec for the REST API, no English documentation of any kind, paid courses (Docker/nginx) are inaccessible video content.

**Revised score**: Agent docs moves from Fail (0) to **Partial (1)** — raw Markdown source + community MCP + REST API docs are usable but Polish-only and community-maintained (not official, could go stale).

---

## 6-Month Cost Comparison Summary

| | Railway | Fly.io | Mikr.us |
|---|---|---|---|
| **Monthly cost** | $5.00 | ~$4.02 | ~$2.12 |
| **6-month total (USD)** | $30.00 | ~$24.12 | ~$12.70 |
| **6-month total (EUR)** | ~€27.50 | ~€22.00 | ~€10.92 |
| **Upfront payment** | $0 | $0 | ~$25.41 (full year) |
| **Price model** | Fixed subscription | Variable (usage-based) | Fixed (annual prepaid) |
| **Pause cost** | $5/mo (subscription stays) | ~$2/mo (IPv4 stays) | $0 (already paid) |
| **Budget risk** | Low — capped at $5 unless overage | Medium — memory upgrade → $6/mo | Low — fixed, but locked in |
| **Break-even vs Railway** | — | Saves ~$1/mo | Saves ~$2.88/mo |

---

## Revised Scoring Matrix (post-research)

Mikr.us agent docs score updated from Fail to Partial based on documentation audit findings.

| Platform | CLI-first | Managed/VPS | Agent docs | Deploy API | MCP | Cost | Total |
|---|---|---|---|---|---|---|---|
| **Railway** | Pass (2) | Pass (2) | Pass (2) | Pass (2) | Pass (2) | Partial (1) | **11/12** |
| **Fly.io** | Pass (2) | Pass (2) | Pass (2) | Pass (2) | Pass (2) | Partial (1) | **11/12** |
| **Mikr.us** | Partial (1) | Partial (1) | Partial (1) | Partial (1) | Fail (0) | Pass (2) | **6/12** |

Note: Mikr.us has a community MCP server (wiki content only, not operational). The MCP criterion evaluates operational platform management via MCP, which Mikr.us still lacks — the community server serves documentation, not deployment/logs/scaling tools. Score remains Fail for MCP.
