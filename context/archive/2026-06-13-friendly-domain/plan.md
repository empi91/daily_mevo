# Friendly Domain (dailymevo.pl) Implementation Plan

## Overview

Set up `dailymevo.pl` as the public-facing domain for the MevoStats app, currently served at `https://srv66-20312.wykr.es/`. The domain will be purchased at OVH.pl, routed through Cloudflare (free tier) for DNS and TLS, and connected to the Mikr.us VPS via Cloudflare Tunnel. The old `wykr.es` URL will continue working.

## Current State Analysis

- App runs in Docker on Mikr.us VPS, uvicorn on `0.0.0.0:8000` inside container, mapped to port `20312` externally
- HTTPS is handled by Mikr.us platform proxy via `srv66-20312.wykr.es`
- CORS origins are configured via `MEVO_CORS_ORIGINS` env var (default: `["http://localhost:5173"]`)
- No custom domain, no Cloudflare, no `cloudflared` installed
- Server: `tadek312` (Mikr.us), SSH port `10312`, app port `20312`

### Key Discoveries:

- `app/config.py:16` — CORS origins are a configurable list, easy to extend
- `docker-compose.yml:5` — port mapping `${MIKRUS_APP_PORT:-20000}:8000`
- `scripts/entrypoint.sh:6` — uvicorn binds to `0.0.0.0:8000` (IPv4 only — Cloudflare Tunnel works with this, AAAA approach would not)
- Server RAM: ~41MB idle out of 768MB limit — plenty of headroom for `cloudflared` (~30-50MB)

## Desired End State

- `https://dailymevo.pl` serves the MevoStats app with automatic HTTPS via Cloudflare
- `https://www.dailymevo.pl` redirects to the root domain
- `https://srv66-20312.wykr.es` continues working as before
- `cloudflared` runs as a systemd service on the VPS, auto-starts on reboot
- CORS config allows requests from the new domain
- Deploy/rollback scripts continue working unchanged

### How to verify:

1. `curl -sI https://dailymevo.pl/health` returns HTTP 200
2. `curl -sI https://www.dailymevo.pl` redirects to `https://dailymevo.pl`
3. `curl -sI https://srv66-20312.wykr.es/health` still returns HTTP 200
4. Frontend loads and API calls work from `https://dailymevo.pl`
5. `systemctl status cloudflared` on the server shows active/running

## What We're NOT Doing

- Removing or disabling the `wykr.es` URL
- Setting up email on the domain
- Configuring Cloudflare WAF, caching rules, or page rules beyond basic SSL
- Changing the Docker/uvicorn setup (Cloudflare Tunnel connects to existing localhost:20312)
- Setting up CI/CD for domain management

## Implementation Approach

Cloudflare Tunnel is the connection method. It installs a lightweight daemon (`cloudflared`) on the server that creates an outbound connection to Cloudflare's edge network. Cloudflare then routes incoming requests for `dailymevo.pl` through this tunnel to `localhost:20312` on the server. This means:
- No firewall changes needed
- No IPv6 binding changes needed
- App keeps serving plain HTTP on localhost — Cloudflare handles TLS
- The tunnel survives server IP changes

## Phase 1: Domain Purchase and Cloudflare Setup

### Overview

Buy `dailymevo.pl` at OVH.pl, create a Cloudflare account, and point the domain's nameservers to Cloudflare. This is all done in web UIs — no server changes yet.

### Changes Required:

#### 1. Register domain at OVH.pl

**Intent**: Purchase `dailymevo.pl` at OVH.pl (~12 PLN brutto for the first year). This gives us ownership and access to nameserver configuration.

**Contract**: OVH account with `dailymevo.pl` registered and active. Nameservers will be changed in the next step.

#### 2. Create Cloudflare account and add domain

**Intent**: Set up Cloudflare as the DNS provider for `dailymevo.pl`. Cloudflare (free tier) will handle DNS, TLS termination, and tunnel routing.

**Contract**: 
- Create account at `dash.cloudflare.com`
- Add `dailymevo.pl` as a site
- Select the **Free** plan
- Cloudflare will provide two nameservers (e.g. `ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`)

#### 3. Update nameservers at OVH

**Intent**: Point `dailymevo.pl` to Cloudflare's nameservers so Cloudflare manages all DNS for the domain.

**Contract**: In OVH panel → domain settings → DNS servers, replace OVH's default nameservers with the two Cloudflare-provided ones. Propagation takes up to 24 hours but usually completes in 1-2 hours.

#### 4. Configure Cloudflare SSL/TLS

**Intent**: Set TLS mode so Cloudflare handles HTTPS for visitors while connecting to the server via the tunnel.

**Contract**: In Cloudflare dashboard → SSL/TLS → set mode to **Full** (not Flexible, not Full Strict — the tunnel provides its own encryption to Cloudflare's edge).

### Success Criteria:

#### Automated Verification:

- `whois dailymevo.pl` shows the domain as registered with your details
- `dig dailymevo.pl NS` returns Cloudflare nameservers (after propagation)

#### Manual Verification:

- OVH panel shows `dailymevo.pl` as active
- Cloudflare dashboard shows `dailymevo.pl` with status "Active"
- SSL/TLS mode is set to Full

**Implementation Note**: Nameserver propagation can take up to 24 hours. Cloudflare will show the domain as "Pending" until propagation completes. Wait for "Active" status before proceeding to Phase 2.

**Status (2026-06-14)**: Domain purchased at OVH (20.53 PLN brutto). Cloudflare account created, domain added (Free plan), SSL/TLS set to Full. Nameservers changed at OVH but propagation not yet confirmed by Cloudflare — status is "Pending". Resume: wait for Cloudflare to show "Active", then verify dig NS and proceed to Phase 2.

---

## Phase 2: Cloudflare Tunnel on Server

### Overview

Install `cloudflared` on the Mikr.us VPS, create a tunnel, and configure it to route `dailymevo.pl` traffic to `localhost:20312`. This is the core connection between the domain and the app.

### Changes Required:

#### 1. Install cloudflared on the VPS

**Intent**: Install the Cloudflare Tunnel daemon so the server can establish an outbound tunnel to Cloudflare's edge network.

**Contract**: SSH into the server and install via deb package:
```bash
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared-linux-amd64.deb
rm cloudflared-linux-amd64.deb
cloudflared --version
```

#### 2. Authenticate cloudflared

**Intent**: Link the cloudflared installation to the Cloudflare account so it can manage tunnels for `dailymevo.pl`.

**Contract**: 
- Run `cloudflared tunnel login` locally (on your Mac, not the server) — this opens a browser for Cloudflare authorization
- Authorize the `dailymevo.pl` domain
- This generates `~/.cloudflared/cert.pem`
- Copy the cert content to `/root/.cloudflared/cert.pem` on the VPS

#### 3. Create and configure the tunnel

**Intent**: Create a named tunnel and set up DNS routing so `dailymevo.pl` points to the app.

**Contract**:
```bash
# On the VPS:
cloudflared tunnel create mevostats
cloudflared tunnel route dns mevostats dailymevo.pl
cloudflared tunnel route dns mevostats www.dailymevo.pl
```

Then create `/etc/cloudflared/config.yml`:
```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: dailymevo.pl
    service: http://localhost:20312
  - hostname: www.dailymevo.pl
    service: http://localhost:20312
  - service: http_status:404
```

The `<TUNNEL_UUID>` is printed by `cloudflared tunnel create` and is also the filename of the credentials JSON.

#### 4. Enable cloudflared as a systemd service

**Intent**: Make the tunnel start automatically on boot and restart on failure.

**Contract**:
```bash
cloudflared service install
systemctl enable --now cloudflared
```

### Success Criteria:

#### Automated Verification:

- `systemctl status cloudflared` shows `active (running)`
- `curl -sI https://dailymevo.pl/health` returns HTTP 200
- `curl -sI https://www.dailymevo.pl` returns a redirect or HTTP 200

#### Manual Verification:

- Open `https://dailymevo.pl` in a browser — the MevoStats frontend loads
- Open `https://dailymevo.pl/health` — health endpoint responds with JSON
- Cloudflare dashboard → Traffic shows requests coming through the tunnel
- `https://srv66-20312.wykr.es/health` still works (old URL unaffected)

**Implementation Note**: If `cloudflared` fails to start, check `journalctl -u cloudflared -f` for errors. Common issues: wrong tunnel UUID in config, cert.pem not copied correctly, or port 20312 not accessible from localhost.

---

## Phase 3: App Configuration Update

### Overview

Update the app's CORS configuration and documentation to include the new domain. This is the only code change in the plan.

### Changes Required:

#### 1. Update production CORS origins

**File**: `.env` (on the Mikr.us server)

**Intent**: Add `https://dailymevo.pl` to the allowed CORS origins so the frontend served from the new domain can make API calls.

**Contract**: Update `MEVO_CORS_ORIGINS` to include both the old and new URLs:
```
MEVO_CORS_ORIGINS=["https://srv66-20312.wykr.es","https://dailymevo.pl","https://www.dailymevo.pl"]
```

#### 2. Update .env.example

**File**: `.env.example`

**Intent**: Document the new domain in the example env file so future developers know about it.

**Contract**: Add a comment showing the production CORS config pattern with the custom domain.

#### 3. Update infrastructure.md

**File**: `context/foundation/infrastructure.md`

**Intent**: Remove "Custom domain setup with Cloudflare" from the Out of Scope section and add a brief reference to the domain setup.

**Contract**: Update the Out of Scope section and add a Domain section noting that `dailymevo.pl` is configured via Cloudflare Tunnel.

#### 4. Restart the app

**Intent**: Apply the new CORS configuration.

**Contract**: On the server: `docker compose restart` (or redeploy via `deploy.sh` if other changes are pending).

### Success Criteria:

#### Automated Verification:

- `curl -sI https://dailymevo.pl/api/v1/stations` returns CORS headers including `dailymevo.pl`
- Existing tests pass: `uv run pytest`
- Linting passes: `uv run ruff check .`

#### Manual Verification:

- Open `https://dailymevo.pl` in browser — frontend loads AND can fetch data from the API (no CORS errors in console)
- Open `https://srv66-20312.wykr.es` — still works correctly
- Search for a station, view its chart — full functionality confirmed on new domain

---

## Phase 4: www Redirect and Cleanup

### Overview

Configure Cloudflare to redirect `www.dailymevo.pl` to `dailymevo.pl` (canonical URL) and close the GitHub issue.

### Changes Required:

#### 1. Configure www redirect in Cloudflare

**Intent**: Redirect `www.dailymevo.pl` → `dailymevo.pl` so there's one canonical URL.

**Contract**: In Cloudflare dashboard → Rules → Redirect Rules, create a rule:
- If hostname equals `www.dailymevo.pl`
- Then redirect (301) to `https://dailymevo.pl` + concat URI path

#### 2. Close GitHub issue

**Intent**: Mark [E-02] as resolved.

**Contract**: `gh issue close 13 --comment "Done — app now available at https://dailymevo.pl"`

### Success Criteria:

#### Automated Verification:

- `curl -sI https://www.dailymevo.pl` returns 301 redirect to `https://dailymevo.pl`
- GitHub issue #13 is closed

#### Manual Verification:

- Typing `www.dailymevo.pl` in browser redirects to `dailymevo.pl`
- All pages and API endpoints work on the canonical domain

---

## Testing Strategy

### Manual Testing Steps:

1. Visit `https://dailymevo.pl` — homepage loads with station search
2. Search for a station, click on it — chart page loads with data
3. Open browser dev tools → Network tab — no CORS errors, API calls go to `/api/v1/`
4. Visit `https://dailymevo.pl/health` — returns JSON with status info
5. Visit `https://www.dailymevo.pl` — redirects to root domain
6. Visit `https://srv66-20312.wykr.es` — still works as before
7. Log in with an existing account — auth flow works on new domain
8. Reboot the VPS — after reboot, `https://dailymevo.pl` comes back automatically

## Performance Considerations

- Cloudflare's edge network acts as a CDN — static assets (frontend JS/CSS) will be served from the nearest PoP, potentially improving load times for Polish users
- `cloudflared` adds ~30-50MB RAM usage on the server — within budget given current ~41MB idle usage out of 768MB limit
- Cloudflare Tunnel adds minimal latency (~1-5ms) for the tunnel hop — negligible vs the ~55ms database latency to Supabase Frankfurt

## Migration Notes

- No data migration needed — this is purely infrastructure
- No downtime required — the old URL keeps working throughout and after the setup
- If the tunnel ever fails, the `wykr.es` URL is an automatic fallback
- Domain renewal at OVH: ~73 PLN/yr — set a calendar reminder

## References

- Research: `context/changes/friendly-domain/research.md`
- Mikr.us wiki — domain via Cloudflare: `wiki.mikr.us/podpiecie_domeny_przez_tunel_cloudflare/`
- Mikr.us wiki — free subdomain: `wiki.mikr.us/darmowa_subdomena_dla_vps/`
- CORS config: `app/config.py:16`
- Entrypoint: `scripts/entrypoint.sh:6`
- Docker port mapping: `docker-compose.yml:5`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain Purchase and Cloudflare Setup

#### Automated

- [x] 1.1 whois dailymevo.pl shows domain as registered
- [x] 1.2 dig dailymevo.pl NS returns Cloudflare nameservers

#### Manual

- [x] 1.3 OVH panel shows dailymevo.pl as active
- [x] 1.4 Cloudflare dashboard shows domain Active with SSL/TLS Full

### Phase 2: Cloudflare Tunnel on Server

#### Automated

- [x] 2.1 systemctl status cloudflared shows active (running)
- [x] 2.2 curl https://dailymevo.pl/health returns HTTP 200
- [x] 2.3 curl https://www.dailymevo.pl returns response

#### Manual

- [x] 2.4 Frontend loads at https://dailymevo.pl in browser
- [x] 2.5 Health endpoint responds at https://dailymevo.pl/health
- [x] 2.6 Old URL https://srv66-20312.wykr.es/health still works

### Phase 3: App Configuration Update

#### Automated

- [x] 3.1 CORS headers include dailymevo.pl on API responses — fb981a9
- [x] 3.2 Existing tests pass (uv run pytest) — fb981a9
- [x] 3.3 Linting passes (uv run ruff check .) — fb981a9

#### Manual

- [x] 3.4 Frontend on new domain can fetch API data (no CORS errors) — fb981a9
- [x] 3.5 Old URL still works correctly — fb981a9

### Phase 4: www Redirect and Cleanup

#### Automated

- [x] 4.1 www.dailymevo.pl returns 301 redirect to dailymevo.pl
- [x] 4.2 GitHub issue #13 is closed

#### Manual

- [x] 4.3 Browser redirect from www to root works
- [x] 4.4 All pages and API endpoints work on canonical domain
