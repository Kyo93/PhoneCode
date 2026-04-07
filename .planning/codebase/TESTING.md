# Testing Patterns

**Analysis Date:** 2026-04-07

## Test Framework

**Status: No automated test framework exists.**

- No test runner installed — `jest`, `vitest`, `mocha`, `tap`, `ava` are absent from `package.json`
- No test files — no `*.test.js`, `*.spec.js`, or `__tests__/` directory anywhere in the project
- No `test` script in `package.json`
- No CI pipeline (`.github/workflows/` does not contain test steps — only `FUNDING.yml`)
- No coverage tooling configured

```json
// package.json scripts — no test entry
"scripts": {
    "start": "node server.js",
    "dev": "node server.js"
}
```

The project has no automated test suite. All verification is manual or runtime-embedded.

## Manual Diagnostic Scripts

The project ships standalone scripts for manual inspection and debugging. These are not tests — they are operational investigation tools run on demand against a live system.

**`discovery_claude.js`** — manually verifies CDP discovery of the Antigravity workbench:
```bash
node discovery_claude.js
```
Scans ports 9000–9003, connects to the workbench CDP target, runs JavaScript to list iframes and known VS Code sidebar IDs. Outputs JSON to console. Run when debugging connection issues.

**`find_claude_editor.js`** — verifies Claude Code CDP targets are reachable and have accessible editors:
```bash
node find_claude_editor.js
```
Connects to each Claude Code CDP target at port 9000, evaluates a script to find `contenteditable` and `textarea` elements. Outputs JSON. Used to confirm the `injectMessage` path will work.

**`inspect_claude_webview.js`** — inspects a specific hardcoded WebSocket URL:
```bash
node inspect_claude_webview.js
```
Contains a hardcoded CDP WebSocket URL — requires manual updating before use. Dumps all editable DOM elements from the webview. One-off diagnostic, not maintained as a reusable tool.

**`generate_ssl.js`** — self-validating certificate generator:
```bash
node generate_ssl.js
```
Checks if certificates already exist before generating. Tries OpenSSL first, falls back to Node.js crypto. Prints method used and file paths on success. Run once during setup.

## Runtime Verification Endpoints

The running server exposes endpoints that serve as manual integration probes:

**`GET /health`** — confirms server and CDP connection are alive:
```json
{
    "status": "ok",
    "cdpConnected": true,
    "uptime": 42.3,
    "timestamp": "2026-04-07T10:00:00.000Z",
    "https": true
}
```

**`GET /debug-ui`** — calls `inspectUI()` from `ui_inspector.js` and returns serialized DOM of the input container. Use to verify the correct DOM context is being found.

**`GET /ui-inspect`** — exhaustive scan across all CDP contexts; returns button inventory, Lucide icon positions, and context metadata. Used to debug why UI actions fail.

**`GET /cdp-targets`** — lists all raw CDP targets across all 4 ports. Use to confirm which Electron/VS Code windows are discoverable.

**`GET /app-state`** — returns the currently detected mode and model from the desktop UI. Use to verify state-reading works after making changes to `getAppState`.

**`GET /snapshot`** — returns the last captured snapshot JSON (`html`, `css`, `scrollInfo`, `stats`). Use to inspect what the phone is actually rendering.

## Embedded Validation Patterns

The codebase validates its own correctness at runtime through several patterns:

**CDP context loop with structured error objects:**
Every function that interacts with the browser via CDP returns either a structured success object or `{ error: 'message' }`. This makes failures visible at the HTTP layer:
```javascript
// Caller in server.js route
const result = await setMode(cdp, mode);
res.json(result); // { success: true } or { error: '...' }
```
The phone client can display these errors; they surface integration failures without crashing.

**Hash-based change detection** (`server.js: startPolling`):
```javascript
const hash = hashString(snapshot.html);
if (hash !== lastSnapshotHash) {
    lastSnapshot = snapshot;
    lastSnapshotHash = hash;
    // broadcast
}
```
Acts as a content integrity check — only content that actually changed triggers a client update. Prevents spurious re-renders.

**DOM element existence guards** inside CDP-injected scripts:
```javascript
const cascade = document.getElementById('conversation') ||
                document.getElementById('chat') ||
                document.getElementById('cascade');
if (!cascade) {
    return { error: 'chat container not found', debug: { hasBody: !!body, availableIds: childIds } };
}
```
Returns debug info (available IDs) when the expected container is absent, making root cause identification faster.

**`exceptionDetails` inspection** for CDP evaluation failures:
```javascript
const result = await cdp.call("Runtime.evaluate", { expression, returnByValue: true, ... });
if (result.exceptionDetails) continue; // skip this context
if (result.result?.value) return result.result.value;
```
Distinguishes between a JS exception inside the injected script and a null return value.

## Test Types

**Unit Tests:** Not used.

**Integration Tests:** Not used as automated tests. Manual equivalents are the diagnostic scripts and HTTP endpoints listed above.

**End-to-End Tests:** Not used. The equivalent is running the server, opening a chat in Antigravity or Claude Code, navigating to the phone UI, and manually verifying each feature works.

**Browser Tests (Playwright, Cypress, etc.):** Not used.

## Coverage

**Requirements:** None enforced.

**Current state:** 0% automated coverage. No tooling configured to measure it.

## What to Test if Adding Tests

If automated tests are introduced, the highest-value areas to cover first:

**`targets/antigravity.js` and `targets/claude.js` — `discover(list)`:**
Pure functions that filter a CDP `/json/list` array. Easily unit-tested with fixture data arrays. No external dependencies required.

**`server.js` — `hashString(str)`:**
Pure function. Trivially testable. Used for change-detection integrity.

**`server.js` — `isLocalRequest(req)`:**
Pure function given a mock `req` object. Tests should cover all IP range prefixes: `127.0.0.1`, `::1`, `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, and external IPs that must return false.

**`server.js` — `getLocalIP()`:**
Side-effectful (reads `os.networkInterfaces()`). Testable by mocking `os.networkInterfaces` return value.

**`public/js/app.js` — `escapeHtml(text)`:**
Pure DOM-based function. Testable in a jsdom environment. Critical to XSS safety in history rendering.

**`public/js/app.js` — `addMobileCopyButtons()`:**
DOM manipulation. Testable in jsdom. Should verify: skip if already present, single-line detection, copy button insertion.

## Known Gaps

There are no automated guards against:
- Regression in `injectMessage` when target UIs update their DOM structure
- `captureSnapshot` returning `null` when chat containers change IDs
- Broken auth cookie validation after `SESSION_SECRET` changes
- Concurrent WebSocket clients producing race conditions in `lastSnapshot`
- `startNewChat` / `selectChat` failing silently when Antigravity's toolbar changes

All of these currently rely on the developer running the app and observing behavior.

---

*Testing analysis: 2026-04-07*
