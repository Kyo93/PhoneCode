# External Integrations

**Analysis Date:** 2026-04-06

## APIs & External Services

**Chrome DevTools Protocol (CDP):**
- Debugger protocol - Communicates with Antigravity Workbench and Claude Code Extension
  - Discovery: Polls ports 9000-9003 for `/json/list` endpoint (`http://127.0.0.1:{port}/json/list`)
  - WebSocket connection to debugger URL for DOM manipulation and screenshot capture
  - Methods used: `Runtime.enable`, `Runtime.evaluate` for JavaScript execution, DOM traversal

**ngrok Tunneling Service:**
- Internet tunneling - Exposes local server to public internet
  - SDK/Client: `pyngrok` (Python library used in `launcher.py`)
  - Auth: `NGROK_AUTHTOKEN` environment variable
  - Purpose: Allows mobile phones to access the application remotely without port forwarding
  - Connection: `ngrok.connect(addr, host_header="rewrite")` in launcher
  - Token configuration: `ngrok.set_auth_token(token)` to prevent 1-hour session limit

**Google Fonts API:**
- Font delivery - CDN for typography
  - Fonts loaded: Inter (wght 400, 500, 600), JetBrains Mono (wght 400, 500)
  - URL: `https://fonts.googleapis.com/css2?family=...`
  - Preconnect: `https://fonts.googleapis.com`, `https://fonts.gstatic.com`

## Data Storage

**Databases:**
- None. Application is stateless; no persistent database required.
- State stored in: Memory (server), Session cookies (browser), localStorage (browser)

**File Storage:**
- Local filesystem only
  - Static assets: `./public/` (HTML, CSS, JS)
  - SSL certificates: `./certs/server.key`, `./certs/server.cert`
  - No remote file storage

**Caching:**
- HTTP compression: gzip via `compression` middleware
- Browser caching: No explicit cache headers configured
- In-memory: Server caches CDP connections in `cdpConnections` Map

## Authentication & Identity

**Auth Provider:**
- Custom password-based
  - Implementation: Password stored in `.env` as `APP_PASSWORD`
  - Hashing: SHA-256 hash of `APP_PASSWORD + AUTH_SALT`
  - Cookie-based sessions: `ag_auth_token` cookie set on successful login
  - Exemption: Local Wi-Fi devices (same subnet) bypass authentication

**Session Management:**
- `SESSION_SECRET` environment variable for session signing
- Cookie: `ag_auth_token` (httpOnly, secure, same-site)
- Lifetime: No explicit session timeout configured

**Login Flow:**
- POST `/login` with password
- Redirected to `/login.html` if unauthorized (401)
- Client header: `ngrok-skip-browser-warning` added to all requests to suppress ngrok browser warning

## Monitoring & Observability

**Error Tracking:**
- None configured. No third-party error tracking.
- Errors logged to console only

**Logs:**
- Console output (`console.log`, `console.error`)
- Log file: `server_log.txt` (server writes to file)
- Example lines: CDP discovery, connection status, polling loop activity

**Debugging:**
- Chrome DevTools Protocol inspector: `ui_inspector.js`, `inspect_claude_webview.js`
- Network monitoring: ngrok provides tunnel status and HTTP activity logs
- Client-side: Browser DevTools for WebSocket traffic and client state

## CI/CD & Deployment

**Hosting:**
- Local machine (development) or cloud VM (production)
- ngrok tunnel for internet access (optional)
- Runs on Node.js process managed by Python launcher (`launcher.py`)

**CI Pipeline:**
- None detected. No GitHub Actions, Travis CI, or similar.
- FUNDING.yml present but minimal CI/CD setup

**Startup:**
- `launcher.py` - Main entry point (checks dependencies, generates SSL, starts Node.js, creates ngrok tunnel, generates QR code)
- `npm start` or `node server.js` - Direct server start
- Batch files for convenience: `start_ag_phone_connect.bat`, `start_ag_phone_connect_web.bat`
- Shell scripts for Unix: `start_ag_phone_connect.sh`, `start_ag_phone_connect_web.sh`

## Environment Configuration

**Required env vars:**
- `APP_PASSWORD` - Password for login (default: 'antigravity')
- `PORT` - Server port (default: 3000)
- `NGROK_AUTHTOKEN` - Optional but recommended for stable tunnels (without it, tunnel expires after 1 hour)

**Optional env vars:**
- `SESSION_SECRET` - Session signing secret (default provided)
- `AUTH_SALT` - Password hashing salt (default provided)

**Secrets location:**
- `.env` file (Git-ignored, template provided as `.env.example`)

## Webhooks & Callbacks

**Incoming:**
- No webhook endpoints. Application polls for state changes instead.
- Polling intervals:
  - Chat snapshots: `POLL_INTERVAL = 1000` (1 second) in server.js
  - Target information: 5-second interval in client (`setInterval(fetchTargets, 5000)`)

**Outgoing:**
- None. Application is pull-based, not push-based to external services.
- Internal WebSocket messages to connected clients for real-time updates

## Network Architecture

**Client Connections:**
- Browser connects to server via HTTP(S) on configured PORT
- WebSocket upgrade for real-time chat snapshots and commands
- Local network: Direct connection (Wi-Fi)
- Remote network: Via ngrok tunnel (encrypted end-to-end)

**Server Connections:**
- Connects to Antigravity Workbench on localhost:9000-9003 (CDP)
- Connects to Claude Code Extension WebView on localhost:9000-9003 (CDP)
- Optional connection to ngrok API for tunnel management

---

*Integration audit: 2026-04-06*
