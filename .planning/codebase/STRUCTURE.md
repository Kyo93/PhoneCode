# Codebase Structure

**Analysis Date:** 2026-04-08

## Directory Layout

```
PhoneCode/
├── server.js                    # Main Express server (2247 lines)
├── package.json                 # Node dependencies and scripts
├── package-lock.json            # Locked dependency versions
├── ui_inspector.js              # Helper module for inspecting remote UI structure
├── generate_ssl.js              # SSL certificate generation script
├── launcher.py                  # Python launcher (deployment/integration)
├── discovery_claude.js          # Claude Code discovery helper
├── public/                      # Static web assets served by Express
│   ├── index.html               # Main SPA shell with layout and modals (195 lines)
│   ├── login.html               # Authentication form
│   ├── js/
│   │   └── app.js               # Client-side JavaScript (1548 lines)
│   └── css/
│       └── style.css            # Mobile-responsive styling (1193 lines)
├── targets/                     # Target adapter modules (pluggable)
│   ├── antigravity.js           # Antigravity workbench CDP handler
│   └── claude.js                # Claude Code extension CDP handler (771 lines)
├── certs/                       # SSL certificates (generated, not committed)
│   ├── server.key
│   └── server.cert
├── .env                         # Environment configuration (not committed)
├── .env.example                 # Example env vars (APP_PASSWORD, PORT, SESSION_SECRET, AUTH_SALT)
├── .planning/                   # GSD planning documents
│   ├── codebase/                # Codebase analysis (ARCHITECTURE.md, STRUCTURE.md, etc.)
│   ├── phases/                  # Phase-specific planning
│   └── references/              # Reference materials
├── .git/                        # Version control history
└── node_modules/                # Installed dependencies (not committed)
```

## Directory Purposes

**`public/`:**
- Purpose: Served as static files by Express via `app.use(express.static())`
- Contains: HTML markup, CSS styling, client-side JavaScript
- Key files: `index.html` (shell with all interactive elements), `js/app.js` (2000+ lines of logic), `css/style.css` (design system)
- Security: Gzip compression applied via middleware

**`targets/`:**
- Purpose: Target-specific adapter implementations (pluggable architecture)
- Contains: Functions for discovering, capturing, and interacting with remote applications
- Key files:
  - `antigravity.js`: Captures #cascade container, detects mode/model buttons, handles chat history
  - `claude.js` (771 lines): Captures document.body, normalizes inline styles for mobile, detects AskUserQuestion UI
- Pattern: Each exports `discover()`, `captureSnapshot()`, `injectMessage()`, and target-specific methods

**`certs/`:**
- Purpose: HTTPS/SSL certificate storage for secure WebSocket
- Generated: Yes (via `generate_ssl.js` script when user clicks "Enable HTTPS")
- Committed: No (in .gitignore, certificates are environment-specific)
- Runtime: Checked on startup; uses HTTP or HTTPS based on cert presence

**`.planning/`:**
- Purpose: GSD phase planning and codebase documentation
- Contains: Architecture docs, testing plans, phase-specific instructions
- Committed: Yes (shared documentation for team coordination)

## Key File Locations

**Entry Points:**
- `server.js`: Backend entry point (ESM, runs with `node server.js`)
  - ~2247 lines: CDP orchestration, route handlers, polling loop, authentication
  - Main responsibilities: Keep CDP connections alive, broadcast snapshots, execute remote actions
- `public/index.html`: Frontend entry point (195 lines of HTML)
  - Shell structure: header, settings bar, target tabs, chat container, modals, input section
  - No inline JavaScript; all logic in app.js
- `public/js/app.js`: Client-side initialization (1548 lines)
  - Entry: `connectWebSocket()`, `fetchAppState()`, `checkChatStatus()` called on page load
  - State machine: Tracks WebSocket connection, auto-refresh, user scroll, question overlay state

**Configuration:**
- `.env`: Runtime environment variables (created from .env.example)
  - Required: None (all have defaults)
  - Important: APP_PASSWORD (default 'antigravity'), PORT (default 3000)
- `.env.example`: Template showing all available options
- `package.json`: Dependencies, scripts, metadata
  - Main dependencies: express, ws, compression, cookie-parser, dotenv
  - Scripts: `start` (runs server.js)

**Core Logic:**
- `server.js`: Main orchestrator
  - Functions: `discoverCDP()`, `connectCDP()`, `initCDP()`, `startPolling()`, route handlers
  - Targets object: `{ antigravity, claude }` imported from targets/
  - State: `cdpConnections` (Map), `currentTarget`, `lastSnapshot`, `lastSnapshotHash`
- `targets/antigravity.js`: Antigravity-specific (legacy format)
  - Exports: `discover()`, `captureSnapshot()`, `injectMessage()`, plus legacy methods
- `targets/claude.js`: Claude Code-specific (771 lines)
  - Exports: `discover()`, `captureSnapshot()`, `injectMessage()`, `performAction()`, `hasChatOpen()`, `detectQuestion()`, `selectOption()`, `submitAnswer()`, `navigateQuestion()`, `setOtherText()`, `cancelQuestion()`, `debugQuestionDOM()`, `getToolbarState()`
  - Special handling: iframe access via `document.getElementById('active-frame').contentDocument`
- `public/js/app.js`: Client state machine (1548 lines)
  - Key functions: `loadSnapshot()`, `sendMessage()`, `checkForQuestion()`, `selectChat()`, event listeners
  - State variables: `autoRefreshEnabled`, `userIsScrolling`, `userScrollLockUntil`, `currentQuestionData`
  - WebSocket handler: Listens for `snapshot_update`, fetches `/snapshot`, re-renders
- `ui_inspector.js`: Helper for serializing remote DOM structure (debugging via `/debug-ui` endpoint)

**Testing:**
- No test directory currently exists
- Manual testing via browser/device at `http://localhost:3000`
- Debug endpoints: `/debug-ui`, `/ui-inspect`, `/cdp-targets` for troubleshooting

## Naming Conventions

**Files:**
- Server: `server.js` (root level, ESM format)
- Modules: Descriptive names like `ui_inspector.js`, `generate_ssl.js`, `discovery_claude.js`
- Targets: Named after application they target: `antigravity.js`, `claude.js`
- Frontend: `app.js` (monolithic, 1548 lines), `index.html` (195 lines), `style.css` (1193 lines)

**Directories:**
- kebab-case: `.planning/codebase`, `node_modules` (following npm convention)
- lowercase: `targets/`, `public/`, `certs/`

**Functions:**
- camelCase: `connectCDP()`, `captureSnapshot()`, `injectMessage()`, `selectChat()`
- Prefix with target: `getClaudeChatHistoryFromDOM()`, `selectClaudeChat()` (Claude-specific)
- Verb-first: `discoverCDP()`, `fetchWithAuth()`, `loadSnapshot()`
- In target modules: `performAction()`, `detectQuestion()`, `navigateQuestion()`

**Variables:**
- camelCase: `lastSnapshot`, `currentTarget`, `autoRefreshEnabled`
- Constants in CAPS: `TARGETS`, `PORTS` (array [9000,9001,9002,9003]), `POLL_INTERVAL`, `AUTH_COOKIE_NAME`, `USER_SCROLL_LOCK_DURATION` (3000ms)
- Boolean flags: `isLocalRequest()`, `chatIsOpen`, `userIsScrolling`, `questionOverlayVisible`
- CDP-related: `cdpConnections` (Map), `cdp.contexts` (array), `idCounter` (internal to connectCDP)

**CSS Classes:**
- kebab-case: `.chat-container`, `.send-btn`, `.modal-overlay`, `.target-tab`, `.question-overlay`
- State modifiers: `.active`, `.connected`, `.disconnected`, `.show`, `.selected` (appended with classList)
- Component groups: `.chat-*`, `.modal-*`, `.question-*`, `.history-*`, `.action-*`

**HTML IDs:**
- kebab-case: `#chatContainer`, `#messageInput`, `#sendBtn`, `#modalOverlay`, `#questionOverlay`
- Section-based: `#header`, `#settingsBar`, `#targetTabs`, `#historyLayer`
- State targets: `#statusDot`, `#statusText`, `#modeText`, `#modelText`

## Where to Add New Code

**New Feature in Server:**
- File: `server.js`
- Pattern: Add new `app.get/post()` route handler after existing routes (before `server.listen()`)
- Location: Insert after authentication middleware checks
- Example for new "pause chat" feature:
  ```javascript
  app.post('/pause', async (req, res) => {
    const cdp = cdpConnections.get(currentTarget);
    if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
    const result = await TARGETS[currentTarget].pauseChat(cdp);
    res.json(result);
  });
  ```

**New Interaction Method (Client):**
- File: `public/js/app.js`
- Pattern: Add async function that calls server endpoint via `fetchWithAuth()`
- Location: Group with similar functions (after other action functions)
- Example:
  ```javascript
  async function pauseChat() {
    try {
      const res = await fetchWithAuth('/pause', { method: 'POST' });
      const data = await res.json();
      if (data.success) setTimeout(loadSnapshot, 500);
    } catch (e) { console.error('pauseChat error:', e); }
  }
  ```
- UI Connection: Add button click listener in event setup section

**New Target Application:**
- Files: Create `targets/[appname].js`
- Required Exports:
  - `discover(list)` — Find debug port
  - `captureSnapshot(cdp)` — Return `{ html, css, scrollInfo, stats }`
  - `injectMessage(cdp, text)` — Send message to chat input
  - `hasChatOpen(cdp)` — Check if chat exists
- Optional Exports: `performAction()`, `getToolbarState()`, `detectQuestion()`, etc.
- Register in server.js:
  ```javascript
  import * as [appname] from './targets/[appname].js';
  // Then in TARGETS object at line 20:
  const TARGETS = { antigravity, claude, [appname] };
  ```

**New UI Component (Frontend):**
- HTML: Add element to `public/index.html` with unique id
- CSS: Add styles to `public/css/style.css` (variables, responsive, dark theme)
- JS: Reference element via `document.getElementById()` and add listeners in `app.js`
- Example for new settings panel:
  - HTML: `<div id="settingsPanel" class="settings-panel">...</div>`
  - CSS: `.settings-panel { ... }` with dark theme variables
  - JS: `const settingsBtn = document.getElementById('settingsBtn'); settingsBtn.addEventListener('click', () => { ... });`

**Utilities:**
- Server-side shared: Add functions in `server.js` before route handlers (after imports)
- Client-side shared: Add in `public/js/app.js` near other utility functions (after `fetchWithAuth`, `escapeHtml`)
- Cross-platform: Consider creating `utils.js` file if multiple helpers needed

## Special Directories

**`node_modules/`:**
- Purpose: Installed npm packages
- Generated: Yes (via `npm install`)
- Committed: No (in .gitignore)
- Size: ~500MB+
- Key packages: express, ws, compression, cookie-parser, dotenv

**`certs/`:**
- Purpose: HTTPS certificates for secure WebSocket
- Generated: Yes (via `generate_ssl.js` when user clicks "Enable HTTPS")
- Committed: No (certificates are environment-specific and sensitive)
- Files created: `server.key`, `server.cert`
- Lifetime: Checked on every server start; persists across restarts

**`.git/`:**
- Purpose: Version control history
- Committed: Yes (git metadata)

**`.planning/`:**
- Purpose: Phase planning and codebase documentation
- Generated: Partially (phase execution creates phase-specific docs)
- Committed: Yes (shared documentation)
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md

**`.env` File:**
- Purpose: Runtime configuration (secrets and settings)
- Generated: Manual creation from `.env.example` during setup
- Committed: No (in .gitignore, contains sensitive data like APP_PASSWORD)
- Required vars: None (all have defaults in server.js)
- Important vars:
  - `APP_PASSWORD`: Authentication password (default 'antigravity')
  - `PORT`: Server port (default 3000)
  - `SESSION_SECRET`: Cookie signing secret (default 'antigravity_secret_key_1337')
  - `AUTH_SALT`: Salt for token generation (default 'antigravity_default_salt_99')

## Architecture Decision Points

**Monolithic vs Modular:**
- `server.js` is monolithic (~2247 lines) to keep all CDP orchestration in one place
  - Benefits: All connection logic visible, single source of truth for state
  - Trade-off: Large file but logically grouped (discovery, connection, polling, routes)
- Target adapters are modular (`targets/*.js`) allowing new targets without touching core server
  - Benefits: Easy to add support for new chat applications
  - Pattern: Each exports same interface, plugged into TARGETS object
- `app.js` is monolithic (~1548 lines) for simplicity; state is global (acceptable for single-page app)
  - Justification: No framework overhead, straightforward event flow
  - Alternative: Could split into modules but would add complexity without benefit

**Snapshot-Based UI:**
- Design rationale: Avoids maintaining real DOM state; captures "what the user sees" not "what the app is"
- Trade-off: Slightly delayed updates (~1-2 second polling) vs simplicity and no JavaScript framework overhead
- Result: ~50-100KB HTML + CSS per snapshot, small enough to push via WebSocket in <100ms
- Performance: Hash-based change detection prevents unnecessary re-renders

**Hash-Based Change Detection:**
- Rationale: Don't broadcast unchanged snapshots; detects UI changes without semantic parsing
- Implementation: Simple string hash on snapshot HTML content (not cryptographic)
- Limitation: False negatives (visual changes not affecting HTML) are acceptable
- Benefit: Reduces network traffic and client re-renders significantly

**Execution Context Iteration:**
- Pattern: Functions try CDP evaluation across all runtime contexts until one succeeds
- Reason: iframes, workers, and page contexts create multiple execution scopes
- Fallback: If all fail, return error with context info for debugging
- Example: `for (const ctx of cdp.contexts) { try { ... } catch (e) { lastErr = e; } }`

**Dual-Target Support:**
- Architecture: Single server can connect to either target via `/switch-target` endpoint
- Client UI: Target tabs at top show connection status for both
- Data source: Each target has separate CDP connection maintained independently
- Why: Users may want to switch between Antigravity and Claude Code without restarting

---

*Structure analysis: 2026-04-08*
