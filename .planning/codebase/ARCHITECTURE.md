# Architecture

**Analysis Date:** 2026-04-08

## Pattern Overview

**Overall:** Real-time remote UI monitoring and interaction hub with multi-target support

**Key Characteristics:**
- Client-server model with Express backend and vanilla JS frontend
- CDP (Chrome DevTools Protocol) as the control plane for remote browser interaction
- Multi-target architecture supporting Antigravity and Claude Code extensions
- Snapshot-based UI rendering streamed from remote targets
- WebSocket for real-time push updates of UI state changes
- Hybrid interaction: DOM manipulation for complex queries, CDP Input API for keyboard events

## Layers

**Server (Backend):**
- Purpose: Express HTTP/HTTPS server with WebSocket support
- Location: `server.js` (2247 lines)
- Contains: Route handlers, CDP connection management, target switching logic, authentication, polling loop
- Depends on: Express, `ws` library, CDP endpoints via HTTP on ports 9000-9003
- Used by: Mobile web client via HTTP/WebSocket

**Target Adapter Layer:**
- Purpose: Abstraction for different target applications (Antigravity, Claude Code)
- Location: `targets/antigravity.js` (legacy), `targets/claude.js` (771 lines)
- Contains: Discovery logic, snapshot capture strategies, interaction methods, AskUserQuestion detection
- Depends on: CDP connection objects, target-specific UI knowledge
- Used by: Server route handlers for target-specific operations

**Client (Frontend):**
- Purpose: Mobile web interface for viewing and controlling remote UI
- Location: `public/js/app.js` (1548 lines)
- Contains: UI state management, WebSocket handling, snapshot rendering, user interactions, question overlay, scroll sync
- Depends on: HTML (index.html), CSS (style.css), Express API endpoints
- Used by: Users accessing web interface on mobile/desktop

**Static Assets:**
- Purpose: UI markup and styling
- Location: `public/index.html`, `public/css/style.css` (1193 lines)
- Contains: Layout structure, responsive design, modal dialogs, target tabs, question overlays
- Depends on: CSS stylesheet, semantic HTML5
- Used by: Browser to render the interface shell

## Data Flow

**Snapshot Capture and Update Cycle:**

1. Server discovers CDP targets on startup via `discoverCDP()` (checks ports 9000-9003)
2. Server connects to target via `connectCDP()` and maintains WebSocket connection to target's browser
3. Poll interval (every 1 second) calls `TARGETS[currentTarget].captureSnapshot(cdp)`
4. For Antigravity: Captures #cascade or #chat or #conversation containers
5. For Claude Code: Captures document.body and normalizes inline styles
6. Snapshot function:
   - Clones the DOM
   - Extracts inline styles from document.styleSheets
   - Converts local images to base64 data URLs
   - Normalizes positioning styles (fixed/absolute → relative) for mobile scrolling
   - Returns `{ html, css, scrollInfo, stats }`
7. Server hashes snapshot HTML to detect changes; only broadcasts if hash differs
8. WebSocket pushes `{ type: 'snapshot_update' }` to connected clients
9. Client receives update, fetches `/snapshot` endpoint, replaces `chatContent` innerHTML
10. Client injects dynamic CSS and mobile copy buttons

**State Synchronization:**

- Desktop is source of truth for mode (Fast/Planning) and model selection
- Client periodically fetches `/app-state` endpoint
- Server extracts current mode/model from remote UI via CDP JavaScript evaluation
- Client displays synced values in header chips
- Claude Code has special toolbar state (`editAuto` toggle)

**Interaction Flow (User Clicks Mobile UI):**

1. Mobile user clicks element in rendered snapshot
2. Client sends `POST /remote-click` with selector and optional text filter
3. Server executes `clickElement(cdp, { selector, index, textContent })`
4. Function runs JavaScript in remote contexts to find and click matching element
5. Strategy: Find all matching elements, filter by text if provided, handle nesting
6. Remote UI state changes trigger new snapshot capture
7. Updated snapshot pushed to clients via WebSocket

**Chat History Navigation:**

1. Client clicks History button → triggers `getChatHistory(cdp)` on server
2. For Antigravity: Runs JavaScript in remote contexts to extract chat titles from sidebar DOM
3. For Claude Code: Reads filesystem at `~/.claude/projects/` and parses `.jsonl` session files
4. Returns array of `{ title, date, sessionId?, mtime }` objects
5. Client displays modal with chat list
6. User selects chat → `POST /select-chat` with chatTitle parameter
7. Server runs target-specific `selectChat()` which finds and clicks matching chat
8. New snapshot renders in client

**AskUserQuestion Detection (Claude Code):**

1. Client periodically calls `GET /claude/question` to check for active question UI
2. Server runs `detectQuestion(cdp)` which searches for "Submit answers" button
3. Returns structured data: `{ detected, question, options[], tabs, activeTab }`
4. Client renders overlay with radio/checkbox options
5. User selects option → `POST /claude/question/select` with index
6. User submits → `POST /claude/question/submit`
7. Option for multi-question flow with tab navigation

**State Management:**

- **Server State:** `currentTarget` (string), `cdpConnections` (Map of target → CDP connection), `lastSnapshot` (object), `lastSnapshotHash` (string)
- **Client State:** `autoRefreshEnabled`, `userIsScrolling`, `userScrollLockUntil`, `forceScrollBottomOnLoad`, `currentMode`, `chatIsOpen`, `questionOverlayVisible`
- **Ephemeral:** User scroll position preserved during updates; percentage-based restoration after content changes

## Key Abstractions

**CDP Connection Object:**
- Purpose: Wraps WebSocket connection to remote browser
- Examples: Created in `connectCDP()` function for each target
- Pattern: Contains `{ port, url, ws, call, contexts }` where `call` is async function for RPC-style CDP method invocation
- Timeout: 30 seconds per call with memory leak protection (pending calls cleaned up)
- Context Tracking: Maintains array of `{ id, name, origin, auxData }` for Runtime.executionContext* events

**Target Discovery:**
- Purpose: Identify correct tab/window for target application
- Examples: `antigravity.discover(list)` finds tab with workbench.html; `claude.discover(list)` finds Claude Code extension iframe
- Pattern: Each target exports `discover(list)` that searches Chrome DevTools `/json/list` response
- Returns: `{ port, url, title, webSocketDebuggerUrl }`

**Snapshot Format:**
- Purpose: Transferrable HTML + CSS representation of remote UI
- Structure: `{ html: string, css: string, backgroundColor, color, fontFamily, scrollInfo, stats }`
- Used for: Rendering in `<div id="chatContent">` without needing DOM references to original
- Size: ~50-100KB per snapshot; kept in memory as `lastSnapshot`

**Target Module Pattern:**
- Purpose: Pluggable target implementations
- Exports: `discover()`, `captureSnapshot()`, `injectMessage()`, `performAction()`, `hasChatOpen()`, `getToolbarState()`, `detectQuestion()`, etc.
- Differences:
  - Antigravity: Looks for #cascade container, uses simpler selector strategies
  - Claude Code: Targets document.body inside active-frame iframe, normalizes absolute/fixed positioning, detects nested question UI

**Runtime.evaluate Expressions (IIFE Pattern):**
- Purpose: Complex DOM queries and manipulations executed in remote context
- Pattern: Async IIFE `(async () => { try { ... } catch(e) { return { error: e.toString() } } })()` that returns JSON via returnByValue
- Safety: Text parameters sanitized via JSON.stringify to prevent injection
- Fallback: Tries all execution contexts; breaks on first success

## Entry Points

**Server Start:**
- Location: `server.js` root level `main()` function
- Triggers: `node server.js` or shell scripts (`start_ag_phone_connect.sh`, etc.)
- Responsibilities: Kill existing port process, discover targets, establish CDP connections, start HTTP/HTTPS server, poll for snapshots

**Client Load:**
- Location: `public/index.html` → `public/js/app.js`
- Triggers: User navigates to `http://localhost:3000` or deployed URL
- Responsibilities: Initialize UI, connect WebSocket, check authentication, load first snapshot, set up event listeners

**API Routes (Primary):**
- `GET /snapshot` — Returns current cached snapshot with HTML, CSS, stats
- `POST /send` — Inject message into remote chat, auto-create chat if needed
- `POST /set-mode` — Click mode button (Fast/Planning) in remote UI
- `POST /set-model` — Click model selector in remote UI
- `POST /stop` — Click stop/cancel button in remote generation
- `POST /remote-click` — Click arbitrary element by selector + text filter
- `POST /remote-scroll` — Scroll remote chat container by percentage
- `POST /new-chat` — Start new conversation in remote
- `GET /chat-history` — Scrape chat history from remote UI
- `POST /select-chat` — Navigate to specific chat by title
- `POST /switch-target` — Change current target (antigravity ↔ claude)
- `GET /targets` — Get list of available targets and connection status

**Claude Code Specific Routes:**
- `GET /claude/question` — Detect if AskUserQuestion overlay is visible
- `POST /claude/question/select` — Select an option by index
- `POST /claude/question/submit` — Submit selected answers
- `POST /claude/question/other-text` — Set "Other" text input value
- `POST /claude/question/navigate` — Move between multi-question tabs
- `POST /claude/question/cancel` — Dismiss question (sends Escape)
- `GET /claude/question/debug` — Dump DOM structure for debugging
- `GET /claude/toolbar-state` — Get Edit Auto toggle state
- `POST /claude/action` — Trigger toolbar actions (add-file, slash-command, etc.)

## Error Handling

**Strategy:** Graceful degradation with client-side fallbacks

**Patterns:**

- **CDP Connection Failures:** If target discovery fails on startup, error logs and exits; if connection drops during runtime, reconnection attempts every 1 second via `startPolling()` loop
- **Snapshot Capture Failures:** Returns null; client shows "Waiting for snapshot" loading state, continues with last valid snapshot
- **JavaScript Evaluation Failures:** Tries all execution contexts (Runtime.executionContexts); returns error object with message if all fail
- **Authentication Failures:** Client redirects to `/login.html` on 401 response
- **Missing Elements:** Returns error describing what wasn't found (e.g., "Element not found at index 0 among 5 matches")
- **Timeout Protection:** CDP calls have 30-second timeout; pending calls cleaned up to prevent memory leaks

## Cross-Cutting Concerns

**Logging:**
- Server uses `console.log()` with emoji prefixes: 🔍, 🔌, ✅, ❌, 📸, 📨, ⚠️, 🛑
- Client uses `console.log()` with [PREFIX] tags for correlation
- No persistent logging layer; output to stdout/browser console
- Error messages include context: file path, element count, available options

**Validation:**
- Passwords checked against `APP_PASSWORD` env var using simple comparison
- Mode parameter validated against `['Fast', 'Planning']` whitelist
- Model names passed through to remote UI search (user-provided strings, not validated)
- Authentication enforced via middleware for all routes except `/login`, `/login.html`, `/css/*`, `/health`, `/ssl-status`
- HTML escaping in client via `escapeHtml()` utility function using div.textContent trick

**Authentication:**
- Hybrid: Local Wi-Fi requests (127.0.0.1, 192.168.x.x, 10.x.x.x) bypass auth
- Remote/external requests require signed cookie `ag_auth_token`
- Magic link support: `?key=APP_PASSWORD` auto-sets cookie (used for QR codes)
- Session duration: 30 days if password provided
- Token = hashString(APP_PASSWORD + AUTH_SALT) for consistency

**SSL/HTTPS:**
- Optional; generates certs if requested via `/generate-ssl` endpoint
- Runtime check determines whether to use `https.createServer()` or `http.createServer()`
- Certs stored in `certs/` directory (not committed to git)
- Endpoint returns status and instructions for restart

**Real-time Synchronization:**
- Hash-based change detection on snapshot HTML; only broadcasts update if different
- User scroll lock (3 seconds) prevents auto-scroll during user interaction
- Percentage-based scroll restoration for better UX during frequent updates
- Debounced scroll sync to desktop (150ms debounce) to avoid excessive remote calls

---

*Architecture analysis: 2026-04-08*
