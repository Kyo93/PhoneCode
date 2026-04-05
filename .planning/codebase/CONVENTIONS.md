# Coding Conventions

**Analysis Date:** 2026-04-06

## Naming Patterns

**Files:**
- `kebab-case` for server/utility files: `server.js`, `generate_ssl.js`, `discovery_claude.js`, `ui_inspector.js`
- `camelCase` for client-side files: `app.js` in `public/js/`
- HTML files: `kebab-case`: `index.html`, `login.html`
- CSS files: `snake_case` for directory: `public/css/style.css`

**Functions:**
- `camelCase` for function names throughout the codebase
- Examples: `killPortProcess()`, `getLocalIP()`, `discoverCDP()`, `connectCDP()`, `captureSnapshot()`
- Utility functions follow same convention: `getJson()`, `fetchAppState()`, `loadSnapshot()`
- Event handlers use `on` prefix: `connectWebSocket()`, `onopen`, `onmessage`, `onclose`

**Variables:**
- `camelCase` for all variable declarations: `chatContainer`, `messageInput`, `statusDot`, `userIsScrolling`
- State variables: `camelCase`: `autoRefreshEnabled`, `userScrollLockUntil`, `lastScrollPosition`, `currentTarget`
- Constants in `UPPER_SNAKE_CASE`: `PORTS`, `POLL_INTERVAL`, `SERVER_PORT`, `AUTH_COOKIE_NAME`, `USER_SCROLL_LOCK_DURATION`, `CDP_CALL_TIMEOUT`
- Private/internal variables: `camelCase` with underscore prefix discouraged; use scope instead

**Types & Classes:**
- No TypeScript in use; JavaScript only with JSDoc comments
- Function parameters documented inline with comments
- Map and object keys: `camelCase` (e.g., `cdpConnections = new Map()` with keys like `'antigravity'`)

## Code Style

**Formatting:**
- No explicit linting config found (`.eslintrc` or `.prettierrc` absent)
- Indentation: 4 spaces (observed in server.js and public/js/app.js)
- Line length: No hard limit enforced, but most lines stay under 100 characters
- Semicolons: Always used to terminate statements
- Quotes: Single quotes `'` for strings (observed in majority of codebase)

**Linting:**
- No active linting framework configured
- No ESLint or Prettier config present
- Code style is consistent by convention rather than automated enforcement

## Import Organization

**Order (server.js - Node.js modules):**
1. Built-in modules first: `import 'dotenv/config'`
2. Node.js core modules: `import express from 'express'`, `import http from 'http'`, `import fs from 'fs'`
3. Third-party packages: `import compression from 'compression'`, `import { WebSocketServer } from 'ws'`
4. Local modules: `import { inspectUI } from './ui_inspector.js'`

**Order (public/js/app.js - Browser environment):**
1. No imports needed; globals used via DOM selectors
2. Remote fetches via `fetch()` API
3. WebSocket connection: `new WebSocket()`

**Path Aliases:**
- No path aliases configured
- Relative imports used throughout: `'./ui_inspector.js'`, `'/snapshot'`, `'/app-state'`
- Absolute URLs for API calls: `'/login'`, `'/logout'`, `'/health'`

## Error Handling

**Patterns:**
- **Try-catch blocks**: Used extensively for network/CDP operations and file operations
  - Example: `try { const list = await getJson(...); } catch (e) { errors.push(...); }`
  - Catch blocks often left empty `catch (e) {}` to suppress errors gracefully
- **Promise error handling**: `.catch()` chains used for some async operations
  - Example: `.catch(reject)` in `connectCDP()` function
- **Graceful degradation**: Missing snapshots return `503` status instead of throwing
  - Example: `if (response.status === 503) { showEmptyState(); return; }`
- **Error messages**: Descriptive error messages passed to console/logs
  - Example: `throw new Error('CDP call ${method} timed out after ${CDP_CALL_TIMEOUT}ms')`
- **Silent failures**: Some operations catch errors but log context info
  - Example in `captureSnapshot()`: `catch (e) { /* Process may have already exited */ }`

**Error Recovery:**
- WebSocket reconnection: Auto-reconnects after 2 second delay `setTimeout(connectWebSocket, 2000)`
- Network fallback: Tries multiple CDP ports (9000-9003) before failing
- CDP context fallback: Attempts multiple execution contexts in order until one succeeds

## Logging

**Framework:** `console` object (no logging library)

**Patterns:**
- **Info logs**: Prefixed with emoji for visual scanning: `console.log('🔍 Discovering CDP endpoints...')`
- **Success logs**: Green check emoji: `console.log('✅ Connected to Antigravity!')`
- **Error logs**: Red X emoji: `console.error('❌ Failed to connect to Antigravity...')`
- **Warning logs**: Yellow warning emoji: `console.warn('⚠️ Snapshot capture issue...')`
- **Context logs**: Indented with notes: `console.log('   Ensure an active chat is open')`

**Log levels:**
- `console.log()`: General information and state changes
- `console.error()`: Critical failures and exceptions
- `console.warn()`: Non-critical issues and degradation states
- `console.debug()`: Rarely used; usually commented out

**Client-side logging (public/js/app.js):**
- Prefixed with bracket notation: `console.log('[AUTH] Unauthorized...')`, `console.log('[SYNC] State refreshed...')`
- Structured prefixes: `[AUTH]`, `[TARGET]`, `[WS]` for source identification
- Silent failures: Some errors not logged: `catch (e) { console.error('[TARGET] Failed...', e); }`

## Comments

**When to Comment:**
- Explain "why" not "what": Comments describe intent, not code syntax
- Example: `// Prefers real network IPs (192.168.x.x, 10.x.x.x) over virtual adapters (172.x.x.x from WSL/Docker)`
- Complex algorithm explanations: Multi-step logic processes documented with numbered steps
- Example in `captureSnapshot()`: Explains DOM cloning strategy and filtering approach
- Warning comments for non-obvious behavior: `// ⚠️ The order of these steps matters!`
- Comments for state that contradicts code: `// Desktop is Always Priority`, `// Desktop is source of truth`

**JSDoc/TSDoc:**
- Not systematically used
- Minimal inline documentation
- Complex functions have header comments explaining parameters and behavior
- Example from `generate_ssl.js`: `/**\n * Generate self-signed SSL certificates for local HTTPS\n */`

## Function Design

**Size:** 
- Functions vary from 5 lines to 100+ lines
- No strict size limits enforced
- Large functions: `captureSnapshot()` (100+ lines), `connectCDP()` (50 lines), `createServer()` (600+ lines)
- Small utility functions: `getLocalIP()`, `updateStatus()`

**Parameters:**
- Functions accept 0-3 parameters typically
- Complex operations use object destructuring for options
- Example: `captureSnapshot(cdp, targetType = 'antigravity')` with optional parameter
- No spread operators used

**Return Values:**
- Async functions return Promises
- Example: `async function discoverCDP() { ... return results; }`
- Synchronous functions return values or objects
- Many functions return `Promise<void>` for side-effect operations
- Handler functions return early on errors/success conditions

## Module Design

**Exports:**
- **server.js**: Default export pattern avoided; single main file
- **ui_inspector.js**: Named export: `export async function inspectUI(cdp) { ... }`
- **public/js/app.js**: No exports; runs as global script in HTML context
- **Other utils**: Files treated as scripts with side effects (discovery_claude.js runs IIFE)

**Barrel Files:**
- No barrel files used
- Each utility has single responsibility
- Direct imports from individual files

**Organization:**
- **server.js**: Contains all server logic (100+ helper functions inline)
- **public/js/app.js**: All client-side logic (1256 lines in single file)
- **public/index.html**: UI markup with script tags
- **utility files**: Single-purpose discovery and inspection scripts

## Special Patterns

**Async/Await:**
- Used throughout for CDP operations and network calls
- Example: `async function connectCDP(url) { ... await new Promise(...) ... }`
- Promise chains: Rarely used; preference for async/await
- Callback hell avoided by using async patterns

**Map & Set Usage:**
- `cdpConnections = new Map()` for managing multiple CDP connections
- `pendingCalls = new Map()` for tracking CDP call state with timeout IDs
- `const pids = new Set()` for deduplication in port cleanup

**DOM Querying:**
- `document.getElementById()` for specific elements
- `document.querySelector()` for CSS selector queries
- `document.querySelectorAll()` for multiple element selection
- No jQuery or DOM libraries used

**String Templating:**
- Template literals with backticks: `` `${variable}` ``
- Example: `` `http://127.0.0.1:${port}/json/list` ``
- HTML template concatenation: String concatenation with `+` operator

**Event Handling:**
- Direct event listeners: `ws.on('message', handler)` for Node.js WebSocket
- DOM events: `element.addEventListener('click', handler)`
- Inline onclick handlers in HTML: `<button onclick="location.reload()">Reload</button>`

---

*Convention analysis: 2026-04-06*
