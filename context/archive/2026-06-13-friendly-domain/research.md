---
date: 2026-06-13T23:00:00+02:00
researcher: Claude
git_commit: 817d683
branch: main
repository: daily_mevo
topic: "Custom domain setup for Mikr.us instance"
tags: [research, infrastructure, domain, dns, cloudflare]
status: complete
last_updated: 2026-06-13
last_updated_by: Claude
---

# Research: Custom Domain Setup for Mikr.us Instance

**Date**: 2026-06-13
**Git Commit**: 817d683
**Branch**: main
**Repository**: daily_mevo

## Research Question

How to set up a custom domain (ideally dailymevo.pl) for the Mikr.us VPS instance currently at `https://srv66-20312.wykr.es/`? What are the cheapest options? How does DNS/HTTPS work with Mikr.us?

## Summary

**dailymevo.pl is available** (verified via NASK WHOIS — the authoritative .pl registry). A .pl domain costs ~5–15 EUR/year depending on registrar. There are also two **free options** via Mikr.us: a custom subdomain on `byst.re` (e.g. `dailymevo.byst.re`) or the built-in `wykr.es` format. Connecting a custom domain to Mikr.us requires Cloudflare (free tier) as DNS proxy — either via AAAA record (simpler) or Cloudflare Tunnel (more robust). HTTPS is automatic in both cases.

## Detailed Findings

### 1. Domain Availability (WHOIS-verified via NASK)

| Domain | Available | Notes |
|---|---|---|
| `dailymevo.pl` | **Yes** | Ideal choice |
| `mevostats.pl` | **Yes** | Matches project name |
| `dailymevo.com.pl` | **Yes** | Free alternative (.com.pl is cheaper at some registrars) |
| `mevo-stats.pl` | **Yes** | Hyphenated alternative |

All verified against the authoritative Polish registry (whois.dns.pl), not third-party lookup tools (which gave false "registered" results).

### 2. Domain Pricing (.pl)

| Registrar | Registration | Renewal (est.) | Notes |
|---|---|---|---|
| Domain Factory | ~2.29 EUR | ~10–15 EUR | Cheapest first year |
| Dynadot | ~$4.99 | ~$12 | Reliable, international |
| OVH | ~5–8 EUR | ~8–10 EUR | Popular in Poland, good Cloudflare integration guides |
| Cloudflare Registrar | at-cost (~$9) | same | No markup, but .pl availability unverified |
| nazwa.pl | ~5 PLN first year | ~50–80 PLN | Polish registrar, promos common |

**Bottom line**: ~5–15 EUR/year for .pl. First-year promos often bring it under 5 EUR.

### 3. Free Options (Zero Cost)

#### Option A: Mikr.us `byst.re` subdomain (FREE)

Run on the Mikr.us server:
```bash
domena dailymevo.byst.re 20312
```

- Gives you `dailymevo.byst.re` pointing to port 20312
- Automatic HTTPS
- App must listen on IPv6 (`::`)
- Validates connectivity before creating
- Other suffix options may exist (bieda.it was mentioned in docs but byst.re is the primary one)

**Pros**: Free, instant, no DNS knowledge needed, HTTPS included.
**Cons**: You don't own the domain — Mikr.us controls it. Not as professional as a .pl domain.

#### Option B: Mikr.us panel subdomain

Configure a dedicated subdomain through the Mikr.us user panel (subdomains section). More control than the `domena` command.

#### Option C: Keep wykr.es (current, FREE)

`srv66-20312.wykr.es` — already working, but ugly and unmemorable.

### 4. Connecting a Custom Domain to Mikr.us

Two approaches, both using Cloudflare (free tier):

#### Approach A: Cloudflare AAAA Record (Simpler)

1. Buy domain (e.g. dailymevo.pl)
2. Create free Cloudflare account, add domain
3. Change nameservers at registrar to Cloudflare's
4. Get server IPv6: run `ip -6 a s` on server (use address that does NOT start with `fe80`)
5. In Cloudflare DNS, add record:
   - Type: **AAAA**
   - Name: **@** (root domain)
   - Value: server's IPv6 address
   - Proxy: **ON** (orange cloud)
6. SSL/TLS settings → set to **Flexible**
7. App must listen on port 80 on IPv6

**Pros**: Simple, 5-minute setup.
**Cons**: App must listen on IPv6 port 80. May need nginx or uvicorn config change.

#### Approach B: Cloudflare Tunnel (More Robust)

1. Buy domain, add to Cloudflare (same as above)
2. Install `cloudflared` on the Mikr.us server:
   ```bash
   wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared-linux-amd64.deb
   ```
3. Run `cloudflared tunnel login` locally, authorize domain
4. Transfer cert to server at `/root/.cloudflared/cert.pem`
5. Create tunnel:
   ```bash
   cloudflared tunnel create mevostats
   cloudflared tunnel route dns mevostats dailymevo.pl
   ```
6. Configure `/etc/cloudflared/config.yml`:
   ```yaml
   tunnel: <TUNNEL_UUID>
   credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json
   ingress:
     - hostname: dailymevo.pl
       service: http://localhost:20312
     - service: http_status:404
   ```
7. Enable as service:
   ```bash
   sudo cloudflared service install
   sudo systemctl enable --now cloudflared
   ```

**Pros**: Works with localhost (no IPv6 binding needed), more reliable, Cloudflare handles all TLS.
**Cons**: Extra software on server (~50MB RAM), more setup steps, `cloudflared` process running.

### 5. HTTPS

- **With Cloudflare (both approaches)**: HTTPS is automatic. Cloudflare terminates TLS at their edge. Your app serves plain HTTP.
- **With byst.re subdomain**: HTTPS is automatic via Mikr.us platform.
- No need to manage certificates yourself in any scenario.

## Architecture Insights

The current setup uses `wykr.es` which is Mikr.us's IPv4 port-mapped subdomain system. The app (FastAPI/uvicorn) listens on port 20312 inside the container, and Mikr.us's proxy handles TLS termination.

For a custom domain, the cleanest path is Cloudflare Tunnel because:
- It doesn't require changing how the app listens (stays on localhost:20312)
- It doesn't require IPv6 binding changes
- It survives server IP changes
- 1GB RAM on Mikr.us is tight, but cloudflared uses ~30-50MB which is manageable

## Recommendation

| Option | Cost | Effort | Result |
|---|---|---|---|
| **`dailymevo.byst.re`** | Free | 1 command | Good enough for now |
| **`dailymevo.pl` + Cloudflare Tunnel** | ~5-15 EUR/yr | ~30 min setup | Professional, memorable |
| **`dailymevo.pl` + AAAA record** | ~5-15 EUR/yr | ~15 min setup | Simple but needs IPv6 config |

**Suggested approach**: Start with `dailymevo.byst.re` (free, instant) to validate the setup works. If you want to invest in a proper domain later, buy `dailymevo.pl` and use Cloudflare Tunnel.

## Open Questions

1. Does the current Docker setup bind to IPv6 (`::`) or only IPv4 (`0.0.0.0`)? This affects which Cloudflare approach works.
2. Is `cloudflared` compatible with Mikr.us's LXC environment? (Docker-in-LXC has known limitations)
3. What's the exact RAM usage on the server currently? Adding cloudflared needs ~30-50MB headroom.
4. Are there other `domena` suffixes besides `byst.re`? The wiki only documents byst.re explicitly.
