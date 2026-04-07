# Codebase Structure

**Analysis Date:** 2026-04-07

## Directory Layout

```
Phone-Chat/
├── server.js                    # Main Express server with CDP orchestration
├── package.json                 # Node dependencies and scripts
├── package-lock.json            # Locked dependency versions
├── ui_inspector.js              # Helper module for inspecting remote UI structure
├── generate_ssl.js              # SSL certificate generation script
├── launcher.py                  # Python launcher (deployment/integration)
├── public/                      # Static web assets served by Express
│   ├── index.html               # Main SPA shell with layout and modals
│   ├── login.html               # Authentication form
│   ├── js/
│   │   └── app.js               # Client-side JavaScript (state, WebSocket, UI logic)
│   └── css/
│       └── style.css            # Mobile-responsive styling
├── targets/                     # Target adapter modules (pluggable)
│   ├── antigravity.js           # Antigravity workbench CDP handler
│   └── claude.js                # Claude Code extension CDP handler
├── certs/                       # SSL certificates (generated, not committed)
│   ├── server.key
│   └── server.cert
├── .env                         # Environment configuration (not committed)
├── .env.example                 # Example env vars
├── .planning/                   # GSD planning documents
│   ├── codebase/                # This codebase analysis
│   ├── phases/                  # Phase-specific planning
│   └── references/              # Reference materials
└── node_modules/                # Installed dependencies (not committed)
```

## Directory Purposes

**`public/`:**
- Purpose: Served as static files by Express
- Contains: HTML markup, CSS styling, client-side JavaScript
- Key files: `index.html` (shell), `js/app.js` (logic), `css/style.css` (design)

**`targets/`:**
- Purpose: Target-specific adapter implementations
- Contains: Functions for discovering, capturing, and interacting with remote applications
- Key files: `antigravity.js`, `claude.js` (each is a complete target adapter)

**`certs/`:**
- Purpose: HTTPS/SSL certificate storage
- Generated: Yes (via `generate_ssl.js` script)
- Committed: No (in .gitignore)

**`.planning/`:**
- Purpose: GSD phase planning and analysis documents
- Contains: Architecture docs, testing plans, phase-specific instructions
- Committed: Yes (shared across team)

## Key File Locations

**Entry Points:**
- `server.js`: Backend entry point; imported with `import` (ESM)
- `public/index.html`: Frontend entry point; browser loads first
- `public/js/app.js`: Client-side logic initialization

**Configuration:**
- `.env`: Environment variables (APP_PASSWORD, PORT, SESSION_SECRET, AUTH_SALT)
- `.env.example`: Template for .env setup
- `package.json`: Dependencies, scripts, metadata

**Core Logic:**
- `server.js`: Request routing, CDP management, snapshot polling, authentication
- `targets/antigravity.js`: Antigravity-specific DOM interaction and capture
- `targets/claude.js`: Claude Code-specific DOM interaction and capture
- `public/js/app.js`: Client state machine, WebSocket handler, UI updates
- `ui_inspector.js`: Helper for serializing remote DOM structure (debugging)

**Testing:**
- No test directory currently exists
- Manual testing via browser/device at `http://localhost:3000`

## Naming Conventions

**Files:**
- Server: `server.js` (root level)
- Modules: Descriptive names like `ui_inspector.js`, `generate_ssl.js`
- Targets: Named after application they target: `antigravity.js`, `claude.js`
- Frontend: `app.js` (monolithic), `index.html`, `style.css`

**Directories:**
- kebab-case: `.planning/codebase`, `node_modules` (following npm convention)
- lowercase: `targets/`, `public/`, `certs/`

**Functions:**
- camelCase: `connectCDP()`, `captureSnapshot()`, `injectMessage()`, `selectChat()`
- Prefix with target: `getClaudeChatHistoryFromDOM()` (Claude-specific)
- Verb-first: `discoverCDP()`, `fetchWithAuth()`, `loadSnapshot()`

**Variables:**
- camelCase: `lastSnapshot`, `currentTarget`, `autoRefreshEnabled`
- Constants in CAPS: `TARGETS`, `PORTS`, `POLL_INTERVAL`, `AUTH_COOKIE_NAME`, `USER_SCROLL_LOCK_DURATION`
- Boolean flags: `isLocalRequest`, `chatIsOpen`, `userIsScrolling`

**CSS Classes:**
- kebab-case: `.chat-container`, `.send-btn`, `.modal-overlay`, `.target-tab`
- State modifiers: `.active`, `.connected`, `.disconnected` (appended with classList)

## Where to Add New Code

**New Feature in Server:**
- File: `server.js` (add new `app.get/post()` route handler)
- Pattern: Place after existing routes, before server listen
- Example: For new "pause chat" feature, add `app.post('/pause', authMiddleware, async (req, res) => {...})`

**New Interaction Method (Client):**
- File: `public/js/app.js`
- Pattern: Add new function that calls server endpoint via `fetchWithAuth()`
- Example: `async function pauseChat() { const res = await fetchWithAuth('/pause', ...); }`
- Connect to UI: Add button click listener in appropriate section (after setup functions)

**New Target Application:**
- Files: Create `targets/[appname].js`
- Exports: `discover(list)`, `captureSnapshot(cdp)`, `injectMessage(cdp, text)`, `startNewChat(cdp)`, etc.
- Register: Add to `TARGETS` object in `server.js` line 20: `import * as [appname] from './targets/[appname].js';`
- Then add to TARGETS map

**New UI Component (Frontend):**
- HTML: Add element to `public/index.html` with id
- CSS: Add styles to `public/css/style.css`
- JS: Reference element via `document.getElementById()` and add listeners in `app.js`
- Example: New settings panel would be HTML `<div id="settings">`, CSS `.settings { ... }`, JS event listener setup

**Utilities:**
- Shared helpers: Add to `ui_inspector.js` or create new `utils.js` file
- Server helpers: Add functions near top of `server.js` before route handlers
- Client helpers: Add functions in `app.js` near other utility functions (fetchWithAuth, etc.)

## Special Directories

**`node_modules/`:**
- Purpose: Installed npm packages
- Generated: Yes (via `npm install`)
- Committed: No (in .gitignore)
- Size: ~500MB+

**`certs/`:**
- Purpose: HTTPS certificates for secure WebSocket
- Generated: Yes (via `generate_ssl.js` when user clicks "Enable HTTPS")
- Committed: No (certificates are sensitive)
- Files created: `server.key`, `server.cert`

**`.git/`:**
- Purpose: Version control history
- Committed: Yes (git metadata)

**`.planning/`:**
- Purpose: Phase planning and codebase documentation
- Generated: Partially (phase execution creates phase-specific docs)
- Committed: Yes (shared documentation)

**`.env` File:**
- Purpose: Runtime configuration (secrets and settings)
- Generated: Manual creation from `.env.example`
- Committed: No (contains sensitive data like APP_PASSWORD)
- Required vars: APP_PASSWORD, PORT (optional), SESSION_SECRET (optional)

## Architecture Decision Points

**Monolithic vs Modular:**
- `server.js` is monolithic (~2200 lines) to keep all CDP orchestration in one place
- Target adapters are modular (`targets/*.js`) allowing new targets without touching core server
- `app.js` is monolithic (~2000 lines) for simplicity; state is global (acceptable for single-page app)

**Snapshot-Based UI:**
- Design rationale: Avoids maintaining real DOM state; captures "what the user sees" not "what the app is"
- Trade-off: Slightly delayed updates vs simplicity and no JavaScript framework overhead
- Result: ~50KB HTML + CSS per snapshot, small enough to push via WebSocket in <100ms

**Hash-Based Change Detection:**
- Rationale: Don't broadcast unchanged snapshots; detects UI changes without semantic parsing
- Implementation: Simple string hash on snapshot HTML content
- Limitation: False negatives (visual changes not affecting HTML) are acceptable

**Execution Context Iteration:**
- Pattern: Functions try CDP evaluation across all runtime contexts until one succeeds
- Reason: iframes, workers, and page contexts create multiple execution scopes
- Fallback: If all fail, return error with context info for debugging

---

*Structure analysis: 2026-04-07*
