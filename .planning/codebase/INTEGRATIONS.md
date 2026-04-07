# External Integrations

**Analysis Date:** 2026-04-07

## Core Protocol: Chrome DevTools Protocol (CDP)

The entire purpose of this application hinges on CDP. The server connects to locally-running Electron/VS Code apps via their CDP WebSocket endpoints and drives them via JavaScript injection.

**Discovery:**
- On startup (and in the polling loop), server calls `http://127.0.0.1:{port}/json/list` for each port in `[9000, 9001, 9002, 9003]`
- Implementation: `getJson()` in `server.js` using Node.js `http.get`
- Results passed to each target's `discover(list)` function to claim matching targets

**Connection:**
- Raw WebSocket connection to the `webSocketDebuggerUrl` returned by `/json/list`
- Implemented as a custom CDP client in `connectCDP()` in `server.js`
- Tracks pending calls by ID with 30-second timeout (`CDP_CALL_TIMEOUT = 30000`)
- Tracks execution contexts via `Runtime.executionContextCreated` / `Destroyed` / `Cleared` events

**CDP Methods Used:**
- `Runtime.enable` — enables execution context tracking on connect
- `Runtime.evaluate` — the primary operation; injects JavaScript strings into target pages
- `Page.getFrameTree` — enumerates all frames; used by `/ui-inspect` endpoint

**Target: Antigravity**
- File: `targets/antigravity.js`
- Discovery: looks for `t.url?.includes('workbench.html')` or title containing `'workbench'`/`'Antigravity'` in `/json/list`
- Snapshot root: `document.getElementById('conversation')` || `#chat` || `#cascade`
- Message injection: `document.execCommand('insertText')` on `[contenteditable="true"]` element, then clicks `svg.lucide-arrow-right` submit button

**Target: Claude Code VS Code Extension**
- File: `targets/claude.js`
- Discovery: looks for `extensionId=Anthropic.claude-code` in target URL; prefers `purpose=webviewView`
- Snapshot root: `document.body` (no `#cascade` container)
- Message injection: finds `[contenteditable="plaintext-only"]` inside `<iframe id="active-frame">`; submit button found by `aria-label="Send message"` or SVG icon class
- Extra actions: `performAction(cdp, action)` supports `'add-file'`, `'slash-command'`, `'toggle-edit-auto'`, `'bypass'`
- Toolbar state: `getToolbarState(cdp)` reads `aria-pressed` on the Edit Auto toggle button

## Tunneling: ngrok

**Purpose:** Expose the local Express server to the public internet so phones not on the same Wi-Fi can connect.

**Used In:** `launcher.py` only — not referenced in `server.js`

**SDK/Client:** `pyngrok` Python library (auto-installed by `launcher.py` if missing)

**Auth:** `NGROK_AUTHTOKEN` env var — `ngrok.set_auth_token(token)` in launcher; without it, tunnels expire after 1 hour

**Connection pattern:**
```python
tunnel = ngrok.connect(addr, host_header="rewrite")
public_url = tunnel.public_url  # e.g. https://abc123.ngrok.io
```

**Magic link pattern:** public URL is appended with `?key={APP_PASSWORD}` so scanning the QR auto-logs in the user: `server.js` checks `req.query.key === APP_PASSWORD` and sets the auth cookie.

**ngrok bypass header:** All fetch calls in `public/js/app.js` include `'ngrok-skip-browser-warning': 'true'` header; server also sets `res.setHeader('ngrok-skip-browser-warning', 'true')` to prevent ngrok interstitial pages.

## Claude Code Chat History: Local Filesystem

**Purpose:** Read Claude Code conversation history without going through CDP (Claude Code doesn't expose history via its web UI in the same way Antigravity does).

**Path:** `~/.claude/projects/` — read via `os.homedir()` in `server.js`

**Format:** JSONL files (`*.jsonl`) where each line is a JSON object; `type === 'user'` entries contain `message.content` arrays with `{type: 'text', text: '...'}` parts.

**Used in:** `/chat-history` GET endpoint in `server.js` when `currentTarget === 'claude'`

**Filtering:** Skips system-injected lines starting with `<ide_`, `<local-command`, `<system`, `<user-prompt`, `<command-`

## Google Fonts CDN

**Purpose:** Load UI typography for the mobile web interface.

**Fonts:**
- `Inter` (weights 400, 500, 600) — body/UI text
- `JetBrains Mono` (weights 400, 500) — code blocks rendered from chat snapshots

**URL:** `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap`

**In:** `public/index.html` — `<link rel="preconnect">` for `fonts.googleapis.com` and `fonts.gstatic.com`

**Note:** Requires internet connectivity at mobile client load time; no self-hosted fallback.

## SSL Certificate Generation

**Purpose:** Enable HTTPS so that the browser Clipboard API works on mobile (requires secure context).

**Tool:** `generate_ssl.js` — called via `node generate_ssl.js` or via the `/generate-ssl` POST endpoint in `server.js`

**Strategy (in priority order):**
1. System `openssl` on `$PATH`
2. `C:\Program Files\Git\usr\bin\openssl.exe` (Git for Windows)
3. `C:\Program Files (x86)\Git\usr\bin\openssl.exe`
4. Node.js `crypto.generateKeyPairSync('rsa')` + manual ASN.1 certificate construction (no SAN support — shows URL mismatch warning on mobile)

**Output:** `certs/server.key` and `certs/server.cert` (gitignored)

## Authentication & Sessions

**Auth Provider:** Custom — no third-party identity service

**Mechanism:**
- Password hashing: `hashString(APP_PASSWORD + AUTH_SALT)` — a fast djb2-style integer hash (not bcrypt/argon2)
- Sessions: HMAC-signed cookie `ag_auth_token` via `cookie-parser`; secret from `SESSION_SECRET` env var
- Cookie lifetime: 30 days (`maxAge: 30 * 24 * 60 * 60 * 1000`)

**Bypass rules:**
- Local Wi-Fi requests (192.168.x.x, 10.x.x.x, 172.16–31.x.x, loopback) skip auth entirely — detected in `isLocalRequest(req)` by checking `req.ip` and absence of `x-forwarded-for` header
- Magic link via `?key={APP_PASSWORD}` query param sets the cookie and redirects to `/`

**Login endpoints:**
- `POST /login` — JSON body `{password}`; sets signed cookie on success
- `POST /logout` — clears the cookie

## Data Storage

**Databases:** None — no SQL, NoSQL, or ORM

**Runtime State (in-memory, lost on restart):**
- `cdpConnections` Map: `targetKey → {port, url, ws, call, contexts}` — active CDP WebSocket connections
- `lastSnapshot` / `lastSnapshotHash` — most recent captured HTML+CSS snapshot
- `currentTarget` — which target (`'antigravity'` or `'claude'`) is actively polled

**Browser-side Persistence:**
- `localStorage.getItem('sslBannerDismissed')` — single boolean; tracks if SSL upgrade banner was dismissed

**File System:**
- `certs/server.key`, `certs/server.cert` — self-signed SSL certs (read at startup)
- `server_log.txt` — written by `launcher.py` with stdout/stderr from node process (gitignored)
- `~/.claude/projects/**/*.jsonl` — read-only access for Claude Code history

## Monitoring & Observability

**Error Tracking:** None — no Sentry, Datadog, or similar

**Logging:**
- `console.log` / `console.warn` / `console.error` in `server.js` for CDP discovery, connection events, snapshot polling, and send results
- `server_log.txt` — file written by `launcher.py` redirecting Node.js stdout/stderr

**Health Check:**
- `GET /health` — returns `{status, cdpConnected, uptime, timestamp, https}`
- `GET /ssl-status` — returns cert presence and HTTPS active status
- `GET /cdp-targets` — returns raw `/json/list` results from all scanned ports

## CI/CD & Deployment

**Hosting:** Local developer machine — not deployed to cloud

**CI Pipeline:** None detected — no GitHub Actions workflows, no `.travis.yml`, no `Dockerfile`

**Startup methods (in order of typical use):**
1. `python launcher.py --mode local` or `--mode web` — full launcher with dependency checks, ngrok, and QR code
2. `start_ag_phone_connect.sh` / `start_ag_phone_connect.bat` — runs `launcher.py --mode local`
3. `start_ag_phone_connect_web.sh` / `start_ag_phone_connect_web.bat` — runs `launcher.py --mode web`
4. `npm start` / `node server.js` — bare server start (no ngrok, no QR)

## Environment Configuration

**Required:**
- `APP_PASSWORD` — mobile dashboard password (default: `'antigravity'`)
- `PORT` — server listen port (default: `3000`)

**Strongly recommended:**
- `NGROK_AUTHTOKEN` — prevents 1-hour tunnel expiry in web mode

**Optional (hardcoded fallbacks exist but are insecure for production):**
- `SESSION_SECRET` — HMAC key for signed cookies
- `AUTH_SALT` — password hash salt

**Secrets location:** `.env` file (gitignored); template at `.env.example`

## Webhooks & Callbacks

**Incoming webhooks:** None — no external service calls into this app

**Outgoing webhooks:** None — app is entirely local/pull-based

**Internal real-time push:** Server → mobile client via WebSocket `snapshot_update` messages; polling interval `POLL_INTERVAL = 1000ms` in `server.js`

---

*Integration audit: 2026-04-07*
