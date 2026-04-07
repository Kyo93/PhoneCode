# Architecture

**Analysis Date:** 2026-04-07

## Pattern Overview

**Overall:** CDP Bridge + REST/WebSocket Proxy ("Wireless Viewport")

This system is not a browser extension or standalone client. It bridges a running desktop AI tool's live DOM to a mobile browser by:
1. Connecting to the desktop tool's Chrome DevTools Protocol (CDP) endpoint over WebSocket
2. Executing JavaScript inside the tool's renderer process to capture DOM snapshots and perform actions
3. Serving captured snapshots to a mobile web client over HTTP/WebSocket
4. Relaying mobile user interactions back to the desktop tool via more CDP JS injection

**Key Characteristics:**
- No modification to the desktop AI tool — uses CDP remote debugging, which tools expose via `--remote-debugging-port`
- 1-second polling interval; WebSocket used only for push notifications (not payload delivery — snapshots always fetched via HTTP GET)
- Plugin-style multi-target design: `targets/` directory contains one module per supported desktop tool
- Authentication is bypassed entirely for same-LAN clients; signed-cookie auth for remote (ngrok) access
- No frontend build pipeline — mobile SPA is plain HTML/CSS/JS served directly

## Layers

**Target Adapter Layer:**
- Purpose: Encapsulates all DOM knowledge about a specific AI tool — how to find it via CDP, how to capture its UI, how to inject messages and clicks
- Location: `targets/antigravity.js`, `targets/claude.js`
- Exports: `discover(list)`, `captureSnapshot(cdp)`, `injectMessage(cdp, text)`. Claude additionally exports `performAction(cdp, action)`, `getToolbarState(cdp)`
- Depends on: CDP connection object (`cdp.call`, `cdp.contexts`)
- Used by: `server.js` via `const TARGETS = { antigravity, claude }` registry and direct `claude.*` calls for Claude-specific endpoints

**CDP Bridge Layer:**
- Purpose: Manages WebSocket connections to desktop tool DevTools endpoints; tracks execution contexts; routes `Runtime.evaluate` calls
- Location: `server.js` — `discoverCDP()`, `connectCDP()`, `initCDP()` (~lines 119–205, 1136–1163)
- Contains: `cdpConnections` Map (target key → `{port, url, ws, call, contexts}`), context lifecycle tracking via `Runtime.executionContextCreated/Destroyed` events, 30s call timeout via `pendingCalls` Map
- Depends on: `ws` npm package
- Used by: Polling loop, all HTTP route handlers

**Polling Loop:**
- Purpose: Continuously captures snapshots from the active target and broadcasts change notifications
- Location: `server.js` `startPolling()` (~line 1166)
- Contains: 1s `setTimeout` loop, `hashString()` change detection, WebSocket broadcast of `{ type: 'snapshot_update' }`
- Depends on: CDP bridge layer, active target's `captureSnapshot()`
- Used by: Started once in `main()` after server starts; auto-reconnects on CDP loss (retries every 2s)

**HTTP/WebSocket Server Layer:**
- Purpose: Exposes REST endpoints for mobile client actions, serves static UI files, manages authenticated WebSocket connections
- Location: `server.js` `createServer()` (~line 1244) and endpoints registered in `main()` (~line 1734+)
- Contains: Express app, ~20 REST routes, WebSocket server, authentication middleware, SSL detection, compression, ngrok header bypass
- Depends on: express, ws, cookie-parser, compression, CDP bridge layer, target adapters
- Used by: Mobile web client

**Mobile UI Layer:**
- Purpose: Renders AI tool UI snapshots on a phone; relays user interactions back to the server
- Location: `public/index.html`, `public/js/app.js`, `public/css/style.css`
- Contains: WebSocket client, snapshot renderer, static dark-mode CSS injected once at startup, dynamic CSS from snapshots, action handlers (send, stop, mode, model, history, scroll sync, remote click)
- Depends on: Server REST API + WebSocket
- Used by: Mobile browser directly

## Data Flow

**Snapshot Capture and Display:**

1. `startPolling()` fires every 1000ms via `setTimeout`
2. Calls `TARGETS[currentTarget].captureSnapshot(cdp)` — iterates `cdp.contexts`, runs `Runtime.evaluate` with a JS string in each context until one succeeds
3. JS runs inside the desktop tool's renderer process: clones the chat container DOM, strips interaction areas and `position:fixed` rules, converts `vscode-file://` image paths to base64, extracts all CSS rules
4. Returns `{ html, css, scrollInfo, stats }` over the CDP WebSocket back to the server
5. Server computes `hashString(snapshot.html)`; if hash changed, stores snapshot in module-level `lastSnapshot` and broadcasts `{ type: 'snapshot_update', timestamp }` to all connected WebSocket clients
6. Mobile client receives WS notification, calls `fetchWithAuth('/snapshot')` via HTTP GET
7. Mobile injects `data.css` into `<style id="cdp-dynamic-styles">` (only if CSS content hash changed, to avoid layout recalc)
8. Mobile sets `chatContent.innerHTML = data.html` to render the snapshot; adds mobile copy buttons to `<pre>` blocks

**User Message Send:**

1. User types in `#messageInput`, taps Send
2. `app.js` `sendMessage()` POSTs `{ message }` to `/send`
3. Server calls `TARGETS[currentTarget].injectMessage(cdp, message)`
4. CDP JS in desktop renderer: finds `contenteditable` editor, inserts text via `execCommand('insertText')` or `textContent` fallback, locates and clicks the submit button (multi-strategy: aria-label → SVG icon → rightmost candidate)
5. Server returns `{ success, method, details }` — always HTTP 200
6. Mobile schedules snapshot reloads at 300ms and 800ms to catch the AI response appearing

**Remote Click (Thought Expansion / Run / Reject):**

1. User taps an element in the rendered snapshot
2. `chatContainer` click listener in `app.js` identifies the action: "Thought/Thinking" block → `remote-click`; "Run"/"Reject" button → `remote-click`
3. Determines occurrence index by scanning matching elements in the local snapshot DOM (leaf-node deduplication)
4. POSTs `{ selector, index, textContent }` to `/remote-click`
5. Server's `clickElement()` (in `targets/antigravity.js`) runs CDP JS: queries desktop DOM with selector, filters by textContent first-line match, applies leaf-node filter to avoid clicking containers, clicks at `index`
6. Mobile schedules 3 snapshot reloads at 400ms / 800ms / 1500ms to catch animation completion

**Scroll Synchronization:**

1. Mobile `chatContainer` scroll event fires, debounced to 150ms
2. `syncScrollToDesktop()` POSTs `{ scrollPercent }` to `/remote-scroll`
3. Server's `remoteScroll()` (in `targets/antigravity.js`) via CDP JS computes `maxScroll * scrollPercent` and sets `scrollTop` on the desktop scroll container
4. A snapshot reload is triggered since Antigravity uses virtualized scrolling (only visible messages are in DOM)

**State Sync (Mode/Model):**

1. Mobile calls `GET /app-state` on load and every 5 seconds via `setInterval`
2. Server runs CDP JS (`getAppState()` in `server.js`): traverses leaf text nodes to find "Fast"/"Planning" (mode) and "Gemini"/"Claude"/"GPT" (model) in a clickable ancestor context
3. Mobile updates mode/model chips in the settings bar; desktop is always source of truth

**Target Switching:**

1. Mobile polls `GET /targets` every 5 seconds; tab state updated accordingly
2. User taps a target tab → `switchTarget(id)` → POSTs to `/switch-target`
3. Server sets `currentTarget`, clears `lastSnapshot`/`lastSnapshotHash`, attempts `initCDP()` if target not yet connected
4. Mobile clears chat content and schedules a fresh `loadSnapshot()`

## Key Abstractions

**Target Interface:**
- Purpose: Uniform API for each supported desktop AI tool
- Files: `targets/antigravity.js`, `targets/claude.js`
- Required exports: `discover(list)` → `{ url, title } | null`, `captureSnapshot(cdp)` → snapshot object, `injectMessage(cdp, text)` → `{ ok, method? }`
- Optional exports (Claude only): `performAction(cdp, action)`, `getToolbarState(cdp)`

**CDP Object (`cdp`):**
- Purpose: Active connection to a single desktop tool rendering process
- Shape: `{ ws, call(method, params): Promise, contexts: Array<{id, name, origin, auxData}> }`
- Pattern: `call()` wraps CDP WebSocket into Promise with 30s timeout + `pendingCalls` Map to prevent leaks. Contexts tracked via `Runtime.executionContextCreated/Destroyed` events. All target operations iterate `cdp.contexts` and return the first non-error result

**Target Registry (`TARGETS`):**
- Purpose: Maps target IDs to adapter modules — the only place a new target needs to be registered
- Location: `server.js` line 20: `const TARGETS = { antigravity, claude }`
- Pattern: To add a new target: create `targets/newtarget.js` with required interface → import → add to `TARGETS` → add connection logic to `initCDP()`

**Snapshot Object:**
- Purpose: Serialized point-in-time representation of the desktop AI tool's UI
- Shape: `{ html, css, backgroundColor, color, fontFamily, scrollInfo: { scrollTop, scrollHeight, clientHeight, scrollPercent }, stats: { nodes, htmlSize, cssSize } }`
- Produced by: `captureSnapshot()` in each target adapter
- Stored in: Module-level `lastSnapshot` in `server.js`
- Consumed by: `GET /snapshot` route → mobile client

**Context Iteration Pattern:**
- Purpose: Handles that CDP targets may have multiple execution contexts (main frame, iframes, extensions)
- Pattern used in: Every target adapter function — `for (const ctx of cdp.contexts) { try { ... } catch (e) {} }` — returns first successful result, swallows per-context errors

## Entry Points

**Server Entry:**
- Location: `server.js` `main()` function (~line 1719)
- Triggers: `node server.js` (via `npm start`)
- Responsibilities: Attempts initial CDP discovery (non-fatal on failure), creates HTTP/HTTPS server, starts polling loop, registers all routes, registers SIGINT/SIGTERM graceful shutdown

**Mobile UI Entry:**
- Location: `public/index.html` → loads `public/js/app.js`
- Triggers: Browser loads the authenticated page
- Responsibilities: Injects static dark-mode CSS once, connects WebSocket, fetches initial snapshot, starts 5s state/target sync intervals

**Python Launcher Entry:**
- Location: `launcher.py`
- Triggers: `start_ag_phone_connect.sh` / `.bat` (local) or `start_ag_phone_connect_web.sh` / `.bat` (ngrok)
- Responsibilities: Checks Node/Python deps, creates `.env` if missing, optionally starts ngrok tunnel, prints QR code and magic link URL, starts `node server.js` subprocess

## Error Handling

**Strategy:** Silent degradation — most failures are logged but do not surface to the mobile client. The periodic polling self-corrects transient issues.

**Patterns:**
- CDP call timeout: 30s, implemented via `setTimeout` + `pendingCalls` Map in `connectCDP()` — prevents memory leaks from unresolved promises
- WebSocket disconnect: Mobile auto-reconnects every 2s via `ws.onclose` handler
- CDP connection loss: Polling loop detects `ws.readyState !== OPEN` → calls `initCDP()` every 2s; returns 503 on any action endpoint call while disconnected
- Snapshot errors: Logged at most once per 10s (`lastErrorLog` debounce) to avoid log spam; mobile client shows last valid snapshot
- Context failures: Each CDP `Runtime.evaluate` call is tried in all contexts; if all fail, functions return structured error (`{ ok: false, reason }`) rather than throwing
- Port conflict: `killPortProcess()` runs before `server.listen()` using `netstat`/`lsof` platform detection

## Authentication

**Model:** Cookie-based signed session, bypassed for LAN clients

**Flow:**
1. `isLocalRequest(req)` checks for proxy headers (`x-forwarded-for`) and private IP ranges — same-LAN devices skip auth entirely
2. Remote clients (via ngrok) authenticate via:
   - `POST /login` with `APP_PASSWORD` body → sets signed `HttpOnly` cookie (30-day expiry)
   - Magic link: `GET /?key=APP_PASSWORD` query param → auto-sets cookie, redirects to `/`
3. WebSocket connections verify the signed cookie manually in the `wss.on('connection')` handler (WS upgrade bypasses Express middleware)
4. `AUTH_TOKEN` is derived as `hashString(APP_PASSWORD + AUTH_SALT)` — the cookie value is never the raw password

## Cross-Cutting Concerns

**Logging:** `console.log/warn/error` with emoji prefixes (`✅`, `⚠️`, `🔍`, `📸`). No structured logging library. Polling errors are rate-limited to once per 10s.

**Validation:** Minimal. Route handlers check only that required body params are present. CDP JS execution errors are caught per-context and do not propagate.

**SSL:** Auto-detected from `certs/server.key` + `certs/server.cert`. If present, `https.createServer()` is used; otherwise `http.createServer()`. Generation via `generate_ssl.js` (OpenSSL if available, Node `crypto` fallback).

**Compression:** `compression` middleware applied globally to all HTTP responses.

**Port Conflict Resolution:** `killPortProcess()` runs before `server.listen()` using platform-specific commands (`netstat /findstr` on Windows, `lsof -ti` on Unix). Returns a 500ms delay Promise to let the port release.

**CSS Strategy (Mobile Client):** Two-layer injection:
- `STATIC_DARK_CSS` constant (~200 lines) injected once at page load into `<style id="cdp-static-styles">` — never rebuilt
- Dynamic CSS from each snapshot injected into `<style id="cdp-dynamic-styles">` — only updated when content hash changes (length + first 64 chars check)

---

*Architecture analysis: 2026-04-07*
