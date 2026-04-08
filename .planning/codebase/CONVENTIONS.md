# Coding Conventions

**Analysis Date:** 2026-04-08

## Naming Patterns

**Files:**
- Kebab-case for HTML/CSS files: `index.html`, `style.css`, `login.html`
- camelCase for JavaScript files: `server.js`, `app.js`, `ui_inspector.js`
- PascalCase for module/target exports: `antigravity.js`, `claude.js` (even though lowercase, used as module names)

**Functions:**
- camelCase: `sendMessage()`, `loadSnapshot()`, `fetchWithAuth()`, `connectWebSocket()`
- Async functions use same convention: `fetchAppState()`, `checkChatStatus()`
- Private helper functions sometimes use leading underscore pattern in inline scripts but not strictly enforced

**Variables:**
- camelCase for most variables: `chatContainer`, `messageInput`, `currentMode`, `statusDot`
- Constants in UPPER_SNAKE_CASE: `POLL_INTERVAL`, `USER_SCROLL_LOCK_DURATION`, `SCROLL_SYNC_DEBOUNCE`, `AUTH_COOKIE_NAME`
- Boolean variables prefix with `is`, `has`, `can`, `should`: `isLocalRequest()`, `hasChatOpen()`, `autoRefreshEnabled`, `userIsScrolling`
- Global state variables (module scope): `currentTarget`, `lastSnapshot`, `autoResumeAttempted`

**Types/Interfaces:**
- JavaScript - no formal types, but objects follow consistent patterns:
  - Response objects: `{ success: true, ...details }` or `{ ok: true, ...details }` or `{ error: 'message' }`
  - Data objects: `{ id, name, url, port, ...context }`
  - Config objects in CAPS: `PORTS`, `MODELS`, `TARGETS`

## Code Style

**Formatting:**
- No explicit formatter configured (no .prettierrc, eslint config)
- Indentation: 4 spaces consistently used in server.js
- Indentation: 2-4 spaces in client-side JavaScript
- Line length: No strict limit observed; some lines exceed 100 chars (especially in long template strings)
- String quotes: Double quotes preferred in JavaScript, backticks for template literals

**Linting:**
- No linter configuration found (no .eslintrc, biome.json)
- Code follows implicit conventions rather than enforced rules
- Light style enforcement observed through comments and documentation

## Import Organization

**Order (observed pattern in server.js):**
1. External dependencies (dotenv, express, fs, etc.)
2. Relative imports (./ui_inspector.js, ./targets/claude.js)
3. No formal separation enforced

**Path Aliases:**
- File paths use relative paths: `./ui_inspector.js`, `./targets/antigravity.js`
- No TypeScript path aliases or module resolution config
- ESM imports used throughout: `import express from 'express'`

**Example pattern from server.js (1-17):**
```javascript
import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { inspectUI } from './ui_inspector.js';
import { execSync } from 'child_process';
import * as antigravity from './targets/antigravity.js';
import * as claude from './targets/claude.js';
```

## Error Handling

**Patterns:**
- Try-catch blocks for all async operations and risky calls
- Error objects captured as `e` or `lastErr` and logged selectively
- Three error response patterns:
  1. `{ error: 'message' }` - general errors
  2. `{ ok: false, error: 'message' }` - operation failures
  3. `{ success: false }` - boolean success indicator

**Examples from server.js:**
- Silent failures with comment: `} catch (e) { /* Process may have already exited */ }`
- Accumulated errors: `errors.push(...); throw new Error(errorSummary)`
- Last error capture in loops: `let lastErr; for(...) { try { ... } catch(e) { lastErr=e; } } if(lastErr) console.error(...)`
- Context fallback pattern: Try multiple execution contexts, log last error only if all fail

**Frontend error handling (app.js):**
- Fetch errors logged to console, not shown as alerts
- Network failures trigger retry with snapshot reload
- 401 responses redirect to login
- Silent failures for best-effort features like question detection

## Logging

**Framework:** console object (`console.log`, `console.error`, `console.warn`)

**Patterns:**
- Emoji prefixes for visual categorization:
  - `🚀` - Server startup
  - `🔌` - CDP connection
  - `✅` - Success states
  - `❌` - Fatal errors
  - `⚠️` - Warnings
  - `📸` - Snapshot captures
  - `📱` - Client connection
  - `📨` - Message operations
  - `🔍` - Discovery operations
  - `🛑` - Shutdown events

**Conventions from server.js (lines 1326-1350):**
```javascript
console.log('🔍 Discovering CDP endpoints...');
console.log(`🔌 Connecting to Antigravity on port ${targets.antigravity.port}...`);
console.log(`✅ Connected to Antigravity! (${conn.contexts.length} contexts)`);
console.error(`❌ Failed to connect to Antigravity: ${e.message}`);
console.log(`📸 Snapshot updated(hash: ${hash})`);
```

**Frontend logging (app.js):**
- Bracket prefixes: `[AUTH]`, `[SYNC]`, `[TARGET]`, `[COPY]`, `[CHAT]`
- Few errors shown to user - mostly logged for debugging
- Silent success for most operations

## Comments

**When to Comment:**
- Complex selectors and DOM traversal strategies (extensively commented in claude.js and server.js functions)
- Multi-step algorithms with fallback chains (see `setModel()`, `setMode()`)
- Security-critical operations (auth, cookie handling)
- Browser compatibility notes (iOS-specific code in copyToClipboard)
- Trade-offs and design decisions (scroll behavior, context selection)

**JSDoc/TSDoc:**
- Very minimal usage
- No formal JSDoc blocks at function level
- Inline explanation preferred over formal documentation blocks
- Module-level comments only: `/** Claude Code Target ... */`

**Example style (targets/claude.js header):**
```javascript
/**
 * Claude Code Target
 * Claude Code VS Code extension support.
 * Isolated from Antigravity - changes here do not affect Antigravity stability.
 *
 * Key differences from Antigravity:
 * - UI renders inside <iframe id="active-frame">
 * - Input element is <div contenteditable="plaintext-only">
 * - Snapshot root is document.body
 * - Inline styles must be normalized
 */
```

## Function Design

**Size:**
- Wide range: 20-100 lines typical
- Large functions (100-300+ lines) used for complex DOM manipulation with multiple strategies:
  - `setMode()` - 100+ lines with 3 fallback strategies
  - `clickElement()` - 60 lines with filter logic
  - `detectQuestion()` - 120 lines parsing question structure
- Smaller functions (10-30 lines) for utilities

**Parameters:**
- 1-3 parameters typical
- Objects passed for complex operations: `clickElement(cdp, { selector, index, textContent })`
- Options object pattern used in fetch calls: `fetchWithAuth(url, options = {})`

**Return Values:**
- Consistent result objects: `{ success/ok/detected: boolean, ...details, error?: string }`
- Null returns only in rare cases (mostly from DOM queries)
- Multiple status patterns: `success`, `ok`, `detected` used inconsistently across codebase

## Module Design

**Exports:**
- `targets/claude.js`: Named exports for each function
  ```javascript
  export function discover(list) { ... }
  export async function captureSnapshot(cdp) { ... }
  export async function injectMessage(cdp, text) { ... }
  ```

**Barrel Files:**
- Not used; all imports are direct module imports
- Target registry pattern used instead (server.js line 20): `const TARGETS = { antigravity, claude }`

**File Organization:**
- Monolithic files: `server.js` (2248 lines), `app.js` (1548 lines), `targets/claude.js` (771 lines)
- Each file handles related functionality without sub-modules
- No subdirectories for related features (all targets at top level)

## Inconsistencies & Observations

**Noted variations:**
1. **Response object patterns vary**: `{ error }`, `{ ok, error }`, `{ success }`, `{ detected }` used across different functions
2. **Function naming**: Some utility functions unnamed, defined inline (especially in targets/*.js for CDP expressions)
3. **Async/await vs Promises**: Mostly async/await, some Promises remain
4. **Global state patterns**: Mix of module-scope variables and window-scope (in client code)
5. **Inline scripts**: Large JavaScript expressions as strings for CDP evaluation (necessary for Chrome DevTools Protocol)
6. **Comment density**: Sparse in some files, verbose in complex DOM selectors

## Best Practices Observed

1. **Defensive selectors**: Multiple fallback strategies for finding UI elements (see `setModel()`, `getChatHistory()`)
2. **Context iteration**: Always try multiple execution contexts before failing (see pattern at server.js:586-598)
3. **Timeout management**: Explicit timeout for CDP calls (30s default, see line 156)
4. **Mobile considerations**: Special handling for iOS/Android (clipboard API fallbacks, viewport detection)
5. **Event handling**: Stop propagation and preventDefault used correctly
6. **Data sanitization**: JSON.stringify for safe text injection in CDP expressions
7. **Graceful degradation**: Many features work partially if fully unavailable

