# External Integrations

**Analysis Date:** 2026-04-08

## APIs & External Services

**Chrome DevTools Protocol (CDP):**
- Service: Browser debugging protocol for Antigravity and Claude Code extension
  - Client: WebSocket-based, native to `ws` package
  - Discovery: Polls `/json/list` endpoint on ports 9000-9003
  - Auth: No explicit auth (runs locally on machine, trusted context)

**ngrok (Optional):**
- Service: Public URL tunneling for remote mobile access
  - SDK/Client: External command-line tool (referenced in `.env.example`)
  - Auth: `NGROK_AUTHTOKEN` environment variable
  - Purpose: Enables remote access without 1-hour session limit

## Data Storage

**Databases:**
- None - stateless application (snapshots exist only in memory)

**File Storage:**
- Local filesystem only
  - Static assets: `public/` directory (HTML, CSS, JS, images)
  - Certificates: `certs/` directory (auto-generated SSL certs)
  - Snapshots: Not persisted (in-memory cache only)

**Caching:**
- In-memory snapshots: `lastSnapshot` and `lastSnapshotHash` globals in server.js
- Hash-based deduplication to avoid redundant WebSocket broadcasts

## Authentication & Identity

**Auth Provider:**
- Custom cookie-based authentication
  - Implementation: Password hash stored in `AUTH_TOKEN` (app_password + salt hashed)
  - Cookie name: `ag_auth_token`
  - Signed via: `SESSION_SECRET` environment variable

**Auth Flow:**
1. Client sends password via `/login` POST endpoint
2. Server hashes `APP_PASSWORD + AUTH_SALT` and sets signed cookie
3. Cookie verified on subsequent requests via `cookieParser.signedCookie()`
4. Local Wi-Fi requests (127.0.0.1, internal IPs) exempt from auth

**Local Network Bypass:**
- Function `isLocalRequest()` checks if request is from 127.0.0.1 or private IP ranges (192.168.x.x, 10.x.x.x)
- Local requests skip authentication entirely

## Monitoring & Observability

**Error Tracking:**
- None detected

**Logs:**
- Console logging (`console.log`, `console.error`, `console.warn`)
- Runtime errors logged to stdout
- CDP connection failures logged with diagnostic information
- No external logging service integration

## CI/CD & Deployment

**Hosting:**
- Self-hosted (runs on developer machine or server)
- Accessible via Wi-Fi to mobile devices on same network
- Optional remote access via ngrok

**CI Pipeline:**
- None detected

## Environment Configuration

**Required env vars (app functionality):**
- `APP_PASSWORD` - Mobile interface login password (default: 'antigravity')
- `PORT` - Server port (default: 3000)
- `NGROK_AUTHTOKEN` - Optional, for remote tunneling

**Optional env vars (security):**
- `SESSION_SECRET` - Signed cookie encryption key (default: 'antigravity_secret_key_1337')
- `AUTH_SALT` - Password hashing salt (default: 'antigravity_default_salt_99')

**Secrets location:**
- `.env` file (gitignored, contains secrets)
- Example template: `.env.example`

## Webhooks & Callbacks

**Incoming:**
- None - application is pull-based (polling via HTTP GET)

**Outgoing:**
- None detected

## Target-Specific Integrations

**Antigravity Target** (`targets/antigravity.js`):
- CDP discovery: Looks for `workbench.html` in `/json/list`
- UI interaction: Finds `#conversation`, `#chat`, or `#cascade` containers
- Input injection: Targets `[contenteditable="true"]` elements
- Messages: Sends to Antigravity input area and submits via Enter key or send button click

**Claude Code Target** (`targets/claude.js`):
- CDP discovery: Prioritizes `purpose=webviewView` iframe with `extensionId=Anthropic.claude-code`
- UI interaction: Accesses content within `<iframe id="active-frame">` via `contentDocument`
- Input injection: Targets `<div contenteditable="plaintext-only">` elements
- Toolbar actions: Can toggle auto-edit mode and select Claude AI models
- Special feature: `AskUserQuestion` detection and interaction via `/claude/question/*` endpoints
- Navigation: Support for multi-question navigation (next/prev)

## Real-time Communication

**WebSocket Protocol:**
- Endpoint: `ws://localhost:3000` (or `wss://` for HTTPS)
- Authentication: Same signed cookie validation as HTTP
- Message flow:
  1. Client connects via `connectWebSocket()` in app.js
  2. Server broadcasts snapshots to all connected clients on polling interval
  3. Server polls CDP every 1 second (`POLL_INTERVAL = 1000`)
  4. Snapshot hash-checked to avoid duplicate broadcasts
- Auto-reconnect: Client reconnects every 2 seconds on disconnect
- Snapshot format: `{ type: 'snapshot', snapshot: { html, css, scrollInfo, ... } }`

## HTTP API Endpoints

**Authentication:**
- `POST /login` - Set authentication cookie
- `POST /logout` - Clear authentication cookie

**Core Operations:**
- `GET /snapshot` - Get current cached snapshot
- `GET /chat-status` - Check if chat is open
- `POST /send` - Send message to current target
- `POST /refresh` - Force immediate CDP capture (bypass cache)
- `POST /stop` - Stop text generation

**UI Control:**
- `POST /set-mode` - Switch between Fast/Planning modes (Antigravity)
- `POST /set-model` - Change AI model selection
- `POST /remote-click` - Click elements via CSS selector
- `POST /remote-scroll` - Sync phone scroll to desktop

**Chat Management:**
- `POST /new-chat` - Start new conversation
- `GET /chat-history` - Get list of previous chats
- `POST /select-chat` - Switch to specific chat
- `POST /close-history` - Close history panel

**Claude Code Specific:**
- `POST /claude/action` - Execute toolbar action
- `GET /claude/toolbar-state` - Get edit mode (auto/manual)
- `GET /claude/question` - Detect `AskUserQuestion` overlay
- `POST /claude/question/select` - Select question option by index
- `POST /claude/question/submit` - Submit answer
- `POST /claude/question/other-text` - Set custom text input
- `POST /claude/question/cancel` - Dismiss question (Escape key)
- `POST /claude/question/navigate` - Navigate between questions

**Diagnostics:**
- `GET /health` - Server health check
- `GET /ssl-status` - HTTPS certificate status
- `POST /generate-ssl` - Generate self-signed certificates
- `GET /ui-inspect` - Debug mode: return all buttons as JSON
- `GET /debug-ui` - Legacy debug endpoint
- `GET /cdp-targets` - List discovered CDP endpoints
- `GET /targets` - List available targets and connection status
- `POST /switch-target` - Switch active target (antigravity or claude)
- `GET /app-state` - Get current mode and model info
- `GET /claude/question/debug` - Debug AskUserQuestion DOM structure

---

*Integration audit: 2026-04-08*
