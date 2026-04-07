# Coding Conventions

**Analysis Date:** 2026-04-07

## Naming Patterns

**Files:**
- Camel case for utility/module files: `server.js`, `ui_inspector.js`
- Kebab case for script entry points: `generate_ssl.js`, `discovery_claude.js`
- Target modules use snake_case: `targets/antigravity.js`, `targets/claude.js`
- JS files grouped in `public/js/` and root directory based on purpose
- Example: `/c/Users/Ocean/.gemini/antigravity/scratch/Phone-Chat/server.js`, `/c/Users/Ocean/.gemini/antigravity/scratch/Phone-Chat/public/js/app.js`

**Functions:**
- Use `camelCase` for all function declarations and method names
- Async functions prefixed with `async`: `async function captureSnapshot(cdp)`, `async function fetchWithAuth(url, options = {})`
- Helper functions in modules exported as named functions: `export function discover(list)`, `export async function captureSnapshot(cdp)`
- Event handlers prefixed with descriptive verbs: `clickElement()`, `remoteScroll()`, `startNewChat()`
- Example from `server.js` lines 106-116: `function getJson(url)`, `function isLocalRequest(req)`

**Variables:**
- Use `const` by default for all variables except loop counters or state that must be reassigned
- Module-level state uses `let`: `let cdpConnections = new Map()`, `let currentTarget = 'antigravity'`
- DOM element references end with descriptive names: `chatContainer`, `messageInput`, `sendBtn`, `statusDot`
- Flags use `is`/`has` prefix: `hasChat`, `isLocalRequest()`, `autoRefreshEnabled`
- State values use descriptive names with intent comments: `userScrollLockUntil = 0 // Timestamp until which we respect user scroll` (app.js line 29)
- Configuration constants in UPPER_SNAKE_CASE: `PORTS`, `POLL_INTERVAL`, `SERVER_PORT`, `APP_PASSWORD`, `AUTH_COOKIE_NAME`
- Example from `app.js` lines 2-24: `const chatContainer`, `let autoRefreshEnabled`, `let userIsScrolling`

**Types:**
- No TypeScript - pure JavaScript (ES6 modules)
- Use JSDoc-style comments for complex functions (see Claude target: `/** Claude Code Target */`)
- Objects returned as plain `{ }` with descriptive property names: `{ error: 'message' }`, `{ success: true, method: 'attempt' }`

## Code Style

**Formatting:**
- No linting config detected (no `.eslintrc`, `.prettierrc`)
- Apparent default formatting: 4-space indentation
- Long lines often exceed 80 characters but maintain readability
- Ternary operators used for concise conditional logic
- Example from `server.js` line 92-94: Multi-line conditionals with proper indentation

**Linting:**
- Not detected - no linting configuration files present
- Code style appears ad-hoc but consistent within each file

## Import Organization

**Order:**
1. Built-in Node.js modules first: `import 'dotenv/config'`, `import express`, `import fs`, `import http`
2. Third-party npm packages: `import compression`, `import cookieParser`, `import { WebSocketServer } from 'ws'`
3. Local modules/utilities: `import { fileURLToPath } from 'url'`, `import { inspectUI } from './ui_inspector.js'`
4. Named imports from target modules: `import * as antigravity from './targets/antigravity.js'`

**Path Aliases:**
- No path aliases detected - all imports use relative paths: `'./ui_inspector.js'`, `'./targets/antigravity.js'`
- Absolute paths from project root not used

**Module System:**
- ES6 `import`/`export` syntax (configured via `"type": "module"` in package.json)
- Named exports for target modules: `export function discover()`, `export async function captureSnapshot()`
- Default handler pattern for utility modules

## Error Handling

**Patterns:**
- Errors caught silently with `catch (e) { }` for non-critical operations (network discovery, UI inspection)
- Example from `server.js` line 183: `} catch (e) { }` in message handlers
- Error objects returned as `{ error: 'description' }` from functions, never thrown
- Example from `server.js` line 209: `if (!['Fast', 'Planning'].includes(mode)) return { error: 'Invalid mode' };`
- CDP call timeouts with explicit timeout IDs tracked in Map: `pendingCalls = new Map()` (server.js line 154)
- Timeout rejection with descriptive message: `reject(new Error('CDP call ${method} timed out after ${CDP_CALL_TIMEOUT}ms'))` (server.js line 193)
- Network errors bubble up with `reject(e)` in Promise chains (server.js line 114)
- Client-side errors logged to console without throwing: `console.error('[SYNC] Failed to sync state', e)`
- Graceful degradation common: missing elements return null, continue to next context (server.js line 301: `if (res.result?.value) return res.result.value;`)

## Logging

**Framework:** 
- Native `console.*` methods (no external logging library)
- `console.log()` for info: `console.log('🚀 [PHONE-CHAT] Server running...')`
- `console.error()` for errors: `console.error('❌ Failed to connect...')`
- `console.warn()` for warnings: `console.warn('⚠️ Snapshot capture issue')`

**Patterns:**
- Prefix logs with emoji + bracketed context: `[PHONE-CHAT]`, `[TARGET]`, `[AUTH]`, `[SYNC]`
- Example from `app.js` line 249: `console.log('[AUTH] Unauthorized, redirecting to login...')`
- Server logs include status indicators: `🔍`, `🔌`, `✅`, `❌`, `⚠️`
- Client-side logs use bracketed prefixes: `[SYNC]`, `[TARGET]`, `[AUTH]`
- Verbose logging in debug endpoints for development inspection

## Comments

**When to Comment:**
- Complex CDP expressions wrapped in inline JS strings get block comments explaining strategy
- Example from `server.js` lines 211-290: Multi-line JS expression in string has `// STRATEGY:` comment
- Inline comments explain non-obvious conditionals: `// Prefers real network IPs...` (line 79)
- Cross-cutting concerns documented: `// Single centralized message handler (fixes MaxListenersExceeded warning)` (line 158)
- TODO/FIXME comments sparse - only used for critical path issues

**JSDoc/TSDoc:**
- Minimal JSDoc usage - only on target modules with `/** Module description */`
- Example: `/** Antigravity Target - Original logic - do not modify without testing thoroughly. */` (targets/antigravity.js line 1-3)
- No function-level JSDoc - types inferred from usage

## Function Design

**Size:**
- Most functions 20-80 lines
- Complex UI automation functions 50-150 lines (unavoidable due to DOM traversal logic)
- Single responsibility per function: `getJson()` fetches HTTP, `discoverCDP()` discovers targets, etc.
- Example from `server.js` lines 80-103: `getLocalIP()` is ~25 lines, focused on network detection

**Parameters:**
- Minimal parameters (usually 1-3)
- Objects for options/config: `async function fetchWithAuth(url, options = {})`
- CDP connection object passed through most functions: `cdp` parameter standard
- Destructuring used for complex parameters: `async function clickElement(cdp, { selector, index, textContent })`

**Return Values:**
- Functions return objects with status/data: `{ success: true, method: 'method' }`, `{ error: 'message' }`
- Consistent property names: `success`, `error`, `method`, `details`
- Null returned for failed lookups (CDP contexts, UI elements)
- Promises used for all async operations - no callback style

## Module Design

**Exports:**
- Target modules export multiple named functions: `export function discover()`, `export async function captureSnapshot()`
- Server uses wildcard imports for target modules: `import * as antigravity from './targets/antigravity.js'`
- Registry pattern for targets: `const TARGETS = { antigravity, claude };` maps string IDs to modules (server.js line 20)
- Browser/Client side uses anonymous IIFE for initialization: `(function initStaticStyles() { ... })()`

**Barrel Files:**
- Not used - single entry point per module
- Targets are accessed by module name in registry

## Implementation Patterns

**State Management:**
- Global state at module/server level: `let cdpConnections = new Map()`, `let currentTarget = 'antigravity'`
- Client-side state with `let` declarations at top of scope
- HTML page state via DOM class toggles: `classList.add('active')`, `classList.remove('connected')`
- LocalStorage for user preferences: `localStorage.getItem('sslBannerDismissed')`

**Async Operations:**
- All network operations wrapped in `try-catch`
- Promise chains with `.then()` or `async-await`
- Timeouts implemented with `setTimeout()` and tracked IDs
- Example from `server.js` lines 186-199: Manual Promise wrapper with timeout cleanup

**Event Handling:**
- Direct `.addEventListener()` calls on DOM elements
- Button actions trigger async fetch calls: `sendBtn.addEventListener('click', sendMessage)`
- WebSocket events handled with `ws.on()` callbacks
- No event delegation - direct element binding
