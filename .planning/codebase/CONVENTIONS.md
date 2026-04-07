# Coding Conventions

**Analysis Date:** 2026-04-07

## Language & Module System

**Language:** Plain JavaScript — no TypeScript, no JSDoc type annotations in practice.

**Module System:** ES Modules throughout. `"type": "module"` is set in `package.json`. All files use `import`/`export` syntax. `.js` extensions are required in local import paths.

**Runtime Target:**
- Node.js ≥16 for server-side code: `server.js`, `targets/`, utility scripts
- Vanilla browser JS (no bundler, no transpiler) for `public/js/app.js`

## Naming Patterns

**Files:**
- Multi-word filenames use `snake_case`: `generate_ssl.js`, `ui_inspector.js`, `find_claude_editor.js`, `discovery_claude.js`, `inspect_claude_webview.js`
- Single-word names are lowercase: `server.js`, `launcher.py`
- Target modules: lowercase, no separator: `targets/antigravity.js`, `targets/claude.js`
- Public assets: lowercase: `public/js/app.js`, `public/css/style.css`, `public/index.html`

**Functions:**
- All function declarations use `camelCase`: `killPortProcess`, `getLocalIP`, `discoverCDP`, `connectCDP`, `setMode`, `stopGeneration`, `clickElement`, `hashString`, `isLocalRequest`, `initCDP`, `startPolling`, `createServer`, `main`
- Descriptive verb+noun form: `captureSnapshot`, `injectMessage`, `performAction`, `getToolbarState`, `runInContexts`
- Use named function declarations at module level, not arrow-function assignments
- Mark async functions explicitly with the `async` keyword — never infer from usage

**Variables:**
- Module-level mutable state: `camelCase` — `cdpConnections`, `currentTarget`, `lastSnapshot`, `lastSnapshotHash`
- Module-level configuration / numeric limits: `SCREAMING_SNAKE_CASE` — `TARGETS`, `PORTS`, `POLL_INTERVAL`, `SERVER_PORT`, `APP_PASSWORD`, `AUTH_COOKIE_NAME`, `AUTH_TOKEN`, `CDP_CALL_TIMEOUT`, `SCROLL_SYNC_DEBOUNCE`, `USER_SCROLL_LOCK_DURATION`
- Local function variables: `camelCase` — `idCounter`, `pendingCalls`, `errorSummary`, `opensslPath`

**CDP Expression Variables:**
Inline JavaScript strings sent to the browser via CDP are stored as uppercase `const` variables:

- `EXP` — dominant pattern (used in 10 of 11 CDP-calling functions in `server.js`)
- `EXPRESSION` — used in `remoteScroll` and `injectMessage` in `targets/`
- `CAPTURE_SCRIPT` — used in both `targets/` files for `captureSnapshot`
- `INSPECT_SCRIPT` — used in `ui_inspector.js`

Use `EXP` for new CDP expression variables unless in a target file's `captureSnapshot`.

## Code Style

**Formatting:**
- No formatter config present — no `.prettierrc`, no `biome.json`, no ESLint config
- Indentation: **4 spaces** consistently across all JS files
- Semicolons: always used
- Strings: single quotes for static values, template literals for interpolation or multi-line CDP expressions

**Linting:**
- No ESLint or similar tooling configured
- No pre-commit hooks or CI lint checks
- Style is enforced by convention, not automation

## Import Organization

Imports are not strictly grouped. Observed order in `server.js`:

1. Side-effect imports: `import 'dotenv/config'`
2. Third-party packages (mixed with Node built-ins): `express`, `compression`, `cookieParser`, `ws`
3. Node.js built-ins: `http`, `https`, `fs`, `os`, `child_process`
4. URL/path helpers: `url`, `path`
5. **Local modules last**: `./ui_inspector.js`, `./targets/antigravity.js`, `./targets/claude.js`

Note: built-ins and third-party are not strictly separated — local modules always appear last.

**Import styles:**

Namespace imports for target modules (allows dynamic dispatch via `TARGETS[name]`):
```javascript
import * as antigravity from './targets/antigravity.js';
import * as claude from './targets/claude.js';
```

Named imports for single utilities:
```javascript
import { inspectUI } from './ui_inspector.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
```

No path aliases — all local imports use relative paths with `.js` extensions.

## Exports

Target modules (`targets/antigravity.js`, `targets/claude.js`) export named functions directly:
```javascript
export function discover(list) { ... }
export async function captureSnapshot(cdp) { ... }
export async function injectMessage(cdp, text) { ... }
```

Utility modules (`ui_inspector.js`) export named async functions:
```javascript
export async function inspectUI(cdp) { ... }
```

**No default exports anywhere in the codebase.**

`server.js`, `public/js/app.js`, and the diagnostic scripts (`discovery_claude.js`, `find_claude_editor.js`, `inspect_claude_webview.js`) export nothing — they are entry points or IIFEs.

## Error Handling

**Express route pattern** — validate input, check CDP, delegate, return:
```javascript
app.post('/set-mode', async (req, res) => {
    const { mode } = req.body;
    const cdp = cdpConnections.get(currentTarget);
    if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
    const result = await setMode(cdp, mode);
    res.json(result);
});
```

**CDP context loop pattern** — try each context, silently swallow mismatch errors:
```javascript
for (const ctx of cdp.contexts) {
    try {
        const res = await cdp.call("Runtime.evaluate", {
            expression: EXP,
            returnByValue: true,
            awaitPromise: true,
            contextId: ctx.id
        });
        if (res.result?.value) return res.result.value;
    } catch (e) { }  // intentional: wrong context, not a real error
}
return { error: 'Context failed' };
```

Empty catch blocks in context loops are intentional — failure means the context is not the correct execution environment.

**Return value conventions — two distinct patterns:**

Pattern A: UI action functions (`setMode`, `stopGeneration`, `clickElement`, `setModel`, `startNewChat`, `remoteScroll`, etc.):
```javascript
return { success: true, method: 'data-tooltip-id' };  // success
return { error: 'Element not found' };                 // failure
```

Pattern B: Message injection only (`injectMessage` in both `targets/antigravity.js` and `targets/claude.js`):
```javascript
return { ok: true, method: "click_submit" };   // success
return { ok: false, reason: "busy" };          // failure
```

Use Pattern A for all new CDP-interacting functions. Use Pattern B only when extending `injectMessage`.

**Fatal server errors:**
```javascript
catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
}
```

**Browser-side (app.js):** `try/catch` with `console.error` logging; user-visible `alert()` used only for unrecoverable mode/model set failures.

## Logging

**Server-side — emoji prefix system** in `console.log`/`console.error`/`console.warn`:

| Emoji | Meaning |
|-------|---------|
| `🔍` | Discovering / searching |
| `🔌` | Connecting |
| `✅` | Connected / success |
| `❌` | Fatal failure |
| `⚠️` | Warning / non-fatal issue |
| `📸` | Snapshot updated |
| `📱` | WebSocket client event |
| `🔄` | Reconnecting / switching |
| `🛑` | Shutdown signal |
| `🚀` | Server started |

**Browser-side (app.js) — bracket-tag prefix system:**
```javascript
console.log('[SYNC] State refreshed from Desktop:', data);
console.log('[AUTH] Unauthorized, redirecting to login...');
console.log('[COPY] Success via Clipboard API');
console.log('[TARGET] Switched to', id);
console.log('[WS] Connected');
```

Never log passwords, tokens, or cookie values.

## Comments

**Section separators** in `app.js` delimit logical blocks:
```javascript
// --- Elements ---
// --- State ---
// --- Auth Utilities ---
// --- WebSocket ---
// --- Rendering ---
```

**Inline strategy comments** inside CDP expressions document multi-step heuristics:
```javascript
// STRATEGY: Find the element that IS the current mode indicator.
// Priority 1: Exact selector from user (data-tooltip-id=...)
// Fallback: Use previous heuristics
```

**File-level block comments** in `targets/claude.js` document target differences:
```javascript
/**
 * Claude Code Target
 * Key differences from Antigravity:
 * - UI renders inside <iframe id="active-frame">
 * - Input element is <div contenteditable="plaintext-only">
 */
```

No JSDoc on individual functions. Comments are prose descriptions placed above the function rather than inside doc blocks.

Shebang line on runnable scripts: `#!/usr/bin/env node` (present on `server.js` and `generate_ssl.js`).

## Async Patterns

Standard `async/await` throughout. Promise constructor used only when wrapping callback APIs:
```javascript
function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}
```

**Delay pattern** (used in CDP interaction before scraping):
```javascript
await new Promise(r => setTimeout(r, 600));
```

**Browser rendering sync** (in CDP-injected scripts, ensures React has re-rendered):
```javascript
await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
```

**`__filename` / `__dirname` in ESM context** — use this boilerplate in any script needing filesystem paths:
```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

## Function Design

Express route handlers are thin: validate input → get CDP connection → delegate to named function → return result. Business logic lives in the named function, not inline in the route.

Destructured parameters for multi-option functions:
```javascript
async function clickElement(cdp, { selector, index, textContent }) { ... }
async function remoteScroll(cdp, { scrollTop, scrollPercent }) { ... }
```

Optional chaining (`?.`) and nullish coalescing (`??`) are used throughout. No lodash or utility libraries.

## Module Design (Target Interface Contract)

Each file in `targets/` must export exactly three functions with these signatures:

```javascript
export function discover(list)             // list = CDP /json/list array
export async function captureSnapshot(cdp) // returns { html, css, scrollInfo, stats } | null
export async function injectMessage(cdp, text) // returns { ok: boolean, ... }
```

New targets must implement all three. Register in `server.js`:
```javascript
const TARGETS = { antigravity, claude };  // add new target here
```

---

*Convention analysis: 2026-04-07*
