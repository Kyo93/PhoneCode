# Architecture

**Analysis Date:** 2026-04-07

## Pattern Overview

**Overall:** Real-time remote UI monitoring and interaction hub with multi-target support

**Key Characteristics:**
- Client-server model with Express backend and vanilla JS frontend
- CDP (Chrome DevTools Protocol) as the control plane for remote browser interaction
- Multi-target architecture supporting Antigravity and Claude Code extensions
- Snapshot-based UI rendering streamed from remote targets
- WebSocket for real-time push updates of UI state changes

## Layers

**Server (Backend):**
- Purpose: Express HTTP/HTTPS server with WebSocket support
- Location: `server.js`
- Contains: Route handlers, CDP connection management, target switching logic, authentication
- Depends on: Express, `ws` library, CDP endpoints via HTTP
- Used by: Mobile web client via HTTP/WebSocket

**Target Adapter Layer:**
- Purpose: Abstraction for different target applications (Antigravity, Claude Code)
- Location: `targets/antigravity.js`, `targets/claude.js`
- Contains: Discovery logic, snapshot capture strategies, interaction methods
- Depends on: CDP connection objects
- Used by: Server route handlers for target-specific operations

**Client (Frontend):**
- Purpose: Mobile web interface for viewing and controlling remote UI
- Location: `public/js/app.js`
- Contains: UI state management, WebSocket handling, snapshot rendering, user interactions
- Depends on: HTML (index.html), CSS (style.css), Express API endpoints
- Used by: Users accessing web interface on mobile/desktop

**Static Assets:**
- Purpose: UI markup and styling
- Location: `public/index.html`, `public/css/style.css`
- Contains: Layout structure, responsive design, modal dialogs
- Depends on: CSS stylesheet
- Used by: Browser to render the interface shell

## Data Flow

**Snapshot Capture and Update Cycle:**

1. Server discovers CDP targets on startup via `discoverCDP()` (checks ports 9000-9003)
2. Server connects to target via `connectCDP()` and maintains WebSocket connection to target's browser
3. Poll interval (every 1 second) calls `TARGETS[currentTarget].captureSnapshot(cdp)`
4. Snapshot function executes JavaScript in remote browser context to:
   - Clone the DOM (#conversation, #chat, #cascade containers for Antigravity; document.body for Claude)
   - Extract inline styles from document.styleSheets
   - Convert local images to base64 data URLs
   - Strip interaction elements (input areas, file panels)
   - Normalize positioning styles for mobile scrolling
5. Server hashes snapshot HTML to detect changes; only broadcasts if hash differs
6. WebSocket pushes `{ type: 'snapshot_update' }` to connected clients
7. Client receives update, fetches `/snapshot` endpoint, replaces `chatContent` innerHTML
8. Client injects dynamic CSS and mobile copy buttons

**State Synchronization:**

- Desktop is source of truth for mode (Fast/Planning) and model selection
- Client periodically fetches `/app-state` endpoint
- Server extracts current mode/model from remote UI via CDP JavaScript evaluation
- Client displays synced values in header chips

**Interaction Flow (User Clicks Mobile UI):**

1. Mobile user clicks element in rendered snapshot
2. Client sends `POST /remote-click` with selector and optional text filter
3. Server executes `clickElement(cdp, { selector, index, textContent })` 
4. Function runs JavaScript in remote contexts to find and click matching element
5. Remote UI state changes trigger new snapshot capture
6. Updated snapshot pushed to clients via WebSocket

**Chat History Navigation:**

1. Client clicks History button → triggers `getChatHistory(cdp)` on server
2. Server runs JavaScript in remote contexts to extract chat titles from DOM
3. Returns array of `{ title, date, sessionId? }` objects
4. Client displays modal with chat list
5. User selects chat → `POST /select-chat` with chatTitle parameter
6. Server runs `selectChat(cdp, chatTitle)` which:
   - Finds history button in remote UI
   - Searches for element matching chat title
   - Clicks it, waits for chat to load
7. New snapshot renders in client

**State Management:**

- **Server State:** `currentTarget` (string), `cdpConnections` (Map of target → CDP connection), `lastSnapshot` (object), `lastSnapshotHash` (string)
- **Client State:** `autoRefreshEnabled`, `userIsScrolling`, `userScrollLockUntil`, `forceScrollBottomOnLoad`, `currentMode`, `chatIsOpen`
- **Ephemeral:** User scroll position preserved during updates; percentage-based restoration after content changes

## Key Abstractions

**CDP Connection Object:**
- Purpose: Wraps WebSocket connection to remote browser
- Examples: Created in `connectCDP()` function
- Pattern: Contains `{ ws, call, contexts }` where `call` is async function for RPC-style CDP method invocation
- Timeout: 30 seconds per call with memory leak protection (pending calls cleaned up)

**Target Discovery:**
- Purpose: Identify correct tab/window for target application
- Examples: `antigravity.discover()` finds tab with workbench.html; `claude.discover()` finds Claude Code extension iframe
- Pattern: Each target exports `discover(list)` that searches Chrome DevTools `/json/list` response

**Snapshot Format:**
- Purpose: Transferrable HTML + CSS representation of remote UI
- Structure: `{ html: string, css: string, backgroundColor, color, fontFamily, scrollInfo, stats }`
- Used for: Rendering in `<div id="chatContent">` without needing DOM references to original

**Target Module Pattern:**
- Purpose: Pluggable target implementations
- Exports: `discover()`, `captureSnapshot()`, `injectMessage()`, `startNewChat()`, `getChatHistory()`, `selectChat()`, etc.
- Differences: Antigravity looks for #cascade container; Claude targets document.body and normalizes inline styles

## Entry Points

**Server Start:**
- Location: `server.js` root level
- Triggers: `node server.js` or `npm start`
- Responsibilities: Kill existing port process, discover targets, establish CDP connections, start HTTP/HTTPS server, poll for snapshots

**Client Load:**
- Location: `public/index.html` → `public/js/app.js`
- Triggers: User navigates to `http://localhost:3000` or deployed URL
- Responsibilities: Initialize UI, connect WebSocket, check authentication, load first snapshot, set up event listeners

**API Routes:**
- **GET /snapshot:** Returns current cached snapshot
- **POST /refresh:** Force capture new snapshot immediately
- **POST /send:** Inject message into remote chat
- **POST /set-mode:** Click mode button (Fast/Planning) in remote UI
- **POST /set-model:** Click model selector in remote UI
- **POST /stop:** Click stop/cancel button in remote generation
- **POST /remote-click:** Click arbitrary element by selector
- **POST /remote-scroll:** Scroll remote chat container
- **POST /new-chat:** Start new conversation in remote
- **GET /chat-history:** Scrape chat history from remote UI
- **POST /select-chat:** Navigate to specific chat by title
- **POST /switch-target:** Change current target (antigravity ↔ claude)
- **GET /targets:** Get list of available targets and connection status

## Error Handling

**Strategy:** Graceful degradation with client-side fallbacks

**Patterns:**

- **CDP Connection Failures:** If target discovery fails on startup, error logs and exits; if connection drops during runtime, reconnection attempts every 1 second
- **Snapshot Capture Failures:** Returns null; client shows "Waiting for snapshot" loading state
- **JavaScript Evaluation Failures:** Tries all execution contexts (Runtime.executionContexts); returns error object with message
- **Authentication Failures:** Client redirects to `/login.html` on 401 response
- **Missing Elements:** Returns error describing what wasn't found (e.g., "Element not found at index 0 among 5 matches")

## Cross-Cutting Concerns

**Logging:** 
- Server uses `console.log()` with prefixes: `[AUTH]`, `[TARGET]`, `[CDP]`, `[SYNC]`, `[SNAPSHOT]`
- Client uses `console.log()` with same prefixes for correlation
- No persistent logging layer; output to stdout/browser console

**Validation:**
- Passwords checked against `APP_PASSWORD` env var
- Mode parameter validated against `['Fast', 'Planning']`
- Model names passed through to remote UI search (user-provided strings)
- Authentication enforced via middleware for all routes except `/login`, `/login.html`, `/css/*`, `/health`

**Authentication:**
- Hybrid: Local Wi-Fi requests (127.0.0.1, 192.168.x.x, 10.x.x.x) bypass auth
- Remote/external requests require signed cookie `ag_auth_token`
- Magic link support: `?key=APP_PASSWORD` auto-sets cookie
- Session duration: 30 days if password provided

**SSL/HTTPS:**
- Optional; generates certs if requested via `/generate-ssl` endpoint
- Runtime check determines whether to use `https.createServer()` or `http.createServer()`
- Certs stored in `certs/` directory (not committed to git)

**Real-time Synchronization:**
- Hash-based change detection on snapshot HTML; only broadcasts update if different
- User scroll lock (3 seconds) prevents auto-scroll during user interaction
- Percentage-based scroll restoration for better UX during frequent updates

---

*Architecture analysis: 2026-04-07*
