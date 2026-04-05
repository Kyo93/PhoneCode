# Architecture

**Analysis Date:** 2026-04-06

## Pattern Overview

**Overall:** Headless Mirror / Remote Desktop Proxy

**Key Characteristics:**
- **Bridge Pattern**: Acts as a middleware between a desktop Antigravity chat session and a remote mobile client via Chrome DevTools Protocol (CDP)
- **Event-Driven**: WebSocket-based real-time synchronization with 1-second polling interval for snapshot capture
- **Layered Services**: Separation of concerns across CDP communication, snapshot capture, command execution, and web frontend
- **Dual-Target Support**: Can bridge both Antigravity workbench and Claude Code extension simultaneously with target switching
- **Security-First**: Local-first architecture with optional ngrok tunneling and passcode protection

## Layers

**CDP Bridge Layer:**
- Purpose: Manages connections to Chrome DevTools Protocol endpoints and orchestrates remote command execution
- Location: `server.js` (lines 114-217: `discoverCDP()`, `connectCDP()`)
- Contains: WebSocket connections to browser targets, message routing, execution context tracking
- Depends on: Node.js WebSocket library, HTTP client for port discovery
- Used by: All remote command functions, snapshot capture, UI inspection

**Capture & Serialization Layer:**
- Purpose: Extracts current UI state from desktop session and converts it to mobile-optimized HTML/CSS
- Location: `server.js` (lines 221-430: `captureSnapshot()`), `server.js` (lines 1790-1980: `ui-inspect` endpoint)
- Contains: DOM cloning logic, image Base64 conversion (vscode-file:// protocol), CSS extraction, viewport optimization
- Depends on: CDP Runtime evaluation, hash computation for change detection
- Used by: Polling loop, `/snapshot` endpoint, mobile frontend rendering

**Command Execution Layer:**
- Purpose: Translates mobile user actions into desktop interactions
- Location: `server.js` (multiple functions: `injectMessage()`, `setMode()`, `setModel()`, `clickElement()`, `remoteScroll()`, `startNewChat()`, `getChatHistory()`, `selectChat()`, `closeHistory()`)
- Contains: DOM selectors, text-based element targeting, occurrence index tracking, simulated input/clicks
- Depends on: CDP Runtime.evaluate for script injection, Deterministic Targeting Layer
- Used by: Express endpoints `/send`, `/set-mode`, `/set-model`, `/remote-click`, `/remote-scroll`, `/new-chat`, `/select-chat`

**State Synchronization Layer:**
- Purpose: Maintains consistency between desktop and mobile view of application state (mode, model, chat status)
- Location: `server.js` (lines 1343-1428: `getAppState()`), `server.js` (lines 1318-1340: `hasChatOpen()`)
- Contains: Mode/Model detection via DOM text scanning, chat container visibility checks
- Depends on: CDP Runtime evaluation, UI inspection utilities
- Used by: `/app-state` endpoint, polling loop for state sync

**Express API Layer:**
- Purpose: RESTful and WebSocket API for client communication
- Location: `server.js` (lines 1573-2190: `createServer()` and endpoint handlers)
- Contains: HTTP routes, authentication middleware, WebSocket upgrade handling, error responses
- Depends on: Express.js, authentication tokens, CDP Bridge Layer
- Used by: Mobile web frontend via HTTP/WebSocket

**Web Frontend Layer:**
- Purpose: Mobile-optimized UI for viewing and interacting with desktop session
- Location: `public/index.html`, `public/js/app.js`, `public/css/style.css`
- Contains: Chat view rendering, snapshot display, mode/model selector, history modal, input submission
- Depends on: WebSocket connection, REST API calls, CSS styling
- Used by: Mobile browser clients

## Data Flow

**Snapshot Update Cycle:**

1. Server polling loop (every 1s) calls `captureSnapshot()` → injects DOM capture script into desktop via CDP
2. Script clones chat DOM, removes UI chrome (input areas, review bars), converts local images to Base64
3. Returns HTML/CSS as JSON payload → stored in `lastSnapshot` global
4. Hash comparison checks if content changed → if changed, broadcast WebSocket notification to all connected clients
5. Mobile client receives `snapshot_update` message → fetches `/snapshot` endpoint
6. `app.js` renders HTML into `chatContent` container with CSS overrides for mobile

**Remote Command Flow:**

1. User performs action on mobile (e.g., send message, click button, scroll)
2. `app.js` sends HTTP POST/GET request to Express endpoint (e.g., `/send`, `/remote-click`)
3. Express handler retrieves CDP connection for current target → calls appropriate command function
4. Command function injects JavaScript into desktop execution context via CDP `Runtime.evaluate`
5. Desktop browser executes script (simulates user input, triggers click handlers, etc.)
6. Script returns result/error → relayed back to mobile client
7. Next polling cycle captures updated snapshot → broadcasts to clients

**Target Switching Flow:**

1. Mobile client detects two potential targets (Antigravity, Claude Code) via `/targets` endpoint
2. User taps tab to switch target → `/switch-target` POST request
3. Server sets `currentTarget` variable → clears cached snapshot
4. If target not yet connected, attempts `initCDP()` discovery
5. Subsequent polling/commands use new target
6. UI tabs update visual indicator showing connected/disconnected state

**State Sync:**

1. Every 5s, mobile frontend calls `/app-state` endpoint
2. Server executes `getAppState()` → DOM text scanning for Mode/Model indicators
3. Returns current mode (Fast/Planning) and model name → mobile updates UI labels
4. Mobile also calls `/chat-status` to detect if editor/chat is open
5. If status changes (e.g., chat closed), shows appropriate warning to user

**Authentication & Authorization:**

1. Client connects → auth middleware checks:
   - Is it a public path? → allow
   - Is it a local Wi-Fi request? → bypass auth (trust local network)
   - Does request have magic link key (`?key=PASSWORD`)? → set cookie and redirect
   - Does request have valid auth cookie? → proceed
   - Otherwise → redirect to login or return 401
2. Magic link enables frictionless access via QR code scanning
3. ngrok tunnel traffic requires passcode authentication (not local)

## Key Abstractions

**CDP Connection Manager:**
- Purpose: Encapsulates WebSocket lifecycle, message routing, and execution context tracking
- Examples: `connectCDP()` returns object with `{ ws, call, contexts }`
- Pattern: Single centralized message handler with `pendingCalls` Map for request/response matching; 30s timeout per call

**Deterministic Targeting Layer:**
- Purpose: Reliably identifies correct DOM element among identical siblings for clicking
- Examples: Used in `clickElement()` and `remoteScroll()`
- Pattern: Combines selector string, occurrence index (nth matching element), and text content matching to guarantee uniqueness

**Snapshot Hashing:**
- Purpose: Detects UI changes to avoid redundant WebSocket broadcasts
- Examples: `lastSnapshotHash` compared against new hash before broadcasting
- Pattern: Simple djb2 hash function on HTML string for O(n) comparison

**Barrel File Pattern (Public JS):**
- Purpose: Single export point for frontend utilities
- Examples: `public/js/app.js` exports DOM rendering, WebSocket management, API fetching
- Pattern: Monolithic client-side module with global state + helper functions

## Entry Points

**Server Entry (`server.js`):**
- Location: `server.js` (lines 2048-2190: `main()` function)
- Triggers: Node.js process start (via `npm start` or direct `node server.js`)
- Responsibilities: Initialize CDP discovery, start Express server, begin polling loop, set up graceful shutdown

**Client Entry (`public/index.html`):**
- Location: `public/index.html` (loaded by mobile browser)
- Triggers: HTTP GET `/` after authentication
- Responsibilities: Render page structure, load CSS/JS, initialize WebSocket connection

**CDP Discovery Entry:**
- Location: `server.js` (lines 1465-1493: `initCDP()`)
- Triggers: `main()` startup, `/switch-target` endpoint, polling reconnection loop
- Responsibilities: Scan ports 9000-9003 for CDP endpoints, identify Antigravity/Claude targets, establish connections

**Polling Loop Entry:**
- Location: `server.js` (lines 1495-1570: `startPolling()`)
- Triggers: Called once in `main()` after server startup
- Responsibilities: Periodically capture snapshots, detect changes, broadcast updates, auto-reconnect on CDP loss

## Error Handling

**Strategy:** Graceful degradation with detailed logging

**Patterns:**

- **CDP Connection Loss**: Polling loop detects closed WebSocket → logs warning → retries every 2s → continues accepting requests (returns 503 if client calls command endpoint)
- **Snapshot Capture Failure**: Script execution error → logs with context ("chat container not found") → skips broadcast → waits for next poll cycle
- **Command Execution Timeout**: 30s timeout per CDP call → rejects pending call → returns error to client with timeout message
- **Authentication Failure**: Invalid password/cookie → returns 401 for API or redirects to login for HTML
- **Port Already In Use**: `killPortProcess()` forcefully terminates existing process before binding (Windows/Linux/macOS compatible)
- **Invalid Target Switch**: Validates against whitelist `['antigravity', 'claude']` → returns 400 error

## Cross-Cutting Concerns

**Logging:** 
- Strategy: Console-based with emoji prefixes (✅, ⚠️, 🔍, 📸) for visual scanning
- Approach: Every major operation logs to stdout (discovery, connection, polling, errors)
- Location: Throughout `server.js` via `console.log()`, `console.error()`, `console.warn()`

**Validation:** 
- Strategy: Input validation at Express middleware level
- Approach: Auth middleware checks cookies, routes validate request body fields, selectors validated before CDP execution
- Location: `isLocalRequest()` helper, route handlers, `clickElement()` parameter checks

**Authentication:** 
- Strategy: Multi-layer (local network trust, cookie-based, magic link)
- Approach: Auth middleware early in chain, signed cookies with salt, environment-based password
- Location: `server.js` lines 1616-1649, cookie parsing in WebSocket handler (lines 2001-2036)

**Message Safety:** 
- Strategy: Escape user-provided content to prevent CDP injection
- Approach: `injectMessage()` uses `JSON.stringify()` for text escaping before sending
- Location: `server.js` line 465: `msg: \`${JSON.stringify(text)}\``

**Resource Cleanup:** 
- Strategy: Explicit connection closure on shutdown
- Approach: `gracefulShutdown()` closes all CDP WebSockets and HTTP server on SIGINT/SIGTERM
- Location: `server.js` lines 2165-2190

---

*Architecture analysis: 2026-04-06*
