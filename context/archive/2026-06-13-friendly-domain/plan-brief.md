# Friendly Domain (dailymevo.pl) — Plan Brief

> Full plan: `context/changes/friendly-domain/plan.md`
> Research: `context/changes/friendly-domain/research.md`

## What & Why

Replace the unmemorable `srv66-20312.wykr.es` URL with `dailymevo.pl` — a short, professional domain that users can actually remember and share. The app is already live and functional; this is purely an infrastructure change to improve accessibility.

## Starting Point

The app runs in Docker on a Mikr.us VPS (plan 2.1, 1GB RAM). Uvicorn listens on `0.0.0.0:8000` inside the container, mapped to port 20312 externally. Mikr.us's platform proxy provides HTTPS via the `wykr.es` wildcard subdomain. No custom domain, no Cloudflare account exists yet.

## Desired End State

`https://dailymevo.pl` serves the full MevoStats app with automatic HTTPS. `www.dailymevo.pl` redirects to the root domain. The old `wykr.es` URL continues working as a fallback. `cloudflared` runs as a systemd service, auto-recovering on reboot.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Domain name | `dailymevo.pl` | Short, memorable, matches repo name, available at NASK registry | Research + User |
| Registrar | OVH.pl | Cheapest first year (~12 PLN), Polish interface, Mikr.us wiki uses OVH in examples | Research |
| Connection method | Cloudflare Tunnel | Works with existing localhost setup, no IPv6/port changes, survives IP changes | Research + Plan |
| Old URL | Keep working | Zero disruption, automatic fallback if tunnel fails | Plan |
| TLS mode | Cloudflare Full | Tunnel provides encryption to edge; Full mode is correct for this setup | Plan |

## Scope

**In scope:**
- Buy `dailymevo.pl` at OVH.pl
- Set up Cloudflare (free tier) as DNS provider
- Install and configure `cloudflared` tunnel on Mikr.us VPS
- Update CORS config to allow the new domain
- Redirect `www` to root domain
- Close GitHub issue #13

**Out of scope:**
- Email setup on the domain
- Cloudflare WAF/caching rules
- Removing the old `wykr.es` URL
- Docker/uvicorn config changes

## Architecture / Approach

```
User → https://dailymevo.pl → Cloudflare Edge (TLS termination)
                                    ↓ (tunnel)
                              cloudflared on VPS
                                    ↓
                              localhost:20312 → Docker → uvicorn:8000
```

Cloudflare Tunnel creates an outbound connection from the server to Cloudflare's edge — no inbound firewall rules needed. The existing `wykr.es` path is unaffected and runs in parallel.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Domain Purchase & Cloudflare Setup | Domain registered, DNS on Cloudflare | Nameserver propagation delay (up to 24h) |
| 2. Cloudflare Tunnel on Server | App reachable at dailymevo.pl | cloudflared compatibility with LXC environment |
| 3. App Configuration Update | CORS allows new domain, docs updated | None — straightforward config change |
| 4. www Redirect & Cleanup | Canonical URL, issue closed | None |

**Prerequisites:** OVH.pl account, Cloudflare account (both free to create), SSH access to Mikr.us VPS
**Estimated effort:** ~1 hour of active work across 1-2 sessions (Phase 1 has a waiting period for DNS propagation)

## Open Risks & Assumptions

- `cloudflared` should work in Mikr.us's LXC environment (it's a static binary, no kernel modules needed — low risk)
- RAM headroom is sufficient (~41MB idle + ~50MB cloudflared = ~91MB of 768MB limit)
- OVH.pl first-year pricing (~12 PLN brutto) may vary slightly; renewal is ~73 PLN/yr

## Success Criteria (Summary)

- `https://dailymevo.pl` loads the full app with working search, charts, and auth
- `https://www.dailymevo.pl` redirects to root domain
- `https://srv66-20312.wykr.es` still works as before
