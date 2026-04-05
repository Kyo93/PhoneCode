# Testing Patterns

**Analysis Date:** 2026-04-06

## Test Framework

**Status:** No testing framework configured

- No test runner installed: `jest`, `vitest`, `mocha` absent from `package.json`
- No test files present in codebase: No `.test.js`, `.spec.js` files found
- `package.json` dependencies do not include testing libraries

**Implications:**
- Codebase relies on manual testing and runtime validation
- No automated test suite exists to validate functionality
- Quality assurance depends on developer verification and user testing

## Manual Testing Patterns

**Integration Testing (Runtime):**
The codebase validates itself through runtime checks during normal execution:

1. **CDP Discovery Validation** (`server.js:114-156`):
   ```javascript
   // Tests multiple ports sequentially to find Antigravity
   const list = await getJson(`http://127.0.0.1:${port}/json/list`);
   
   // Filters targets by characteristics
   const workbench = list.find(t => t.url?.includes('workbench.html') || ...);
   const claudeTargets = list.filter(t => t.url?.includes('extensionId=Anthropic.claude-code'));
   ```
   - Validates connection to 4 possible ports (9000-9003)
   - Confirms CDP targets respond with expected structure
   - Returns detailed error summary if discovery fails

2. **WebSocket Connection Validation** (`server.js:159-218`):
   ```javascript
   const ws = new WebSocket(url);
   await new Promise((resolve, reject) => {
       ws.on('open', resolve);
       ws.on('error', reject);
   });
   ```
   - Waits for successful connection before proceeding
   - Rejects immediately on connection error
   - Validates message parsing: `JSON.parse(msg)` inside try-catch

3. **Snapshot Capture Validation** (`server.js:221-430`):
   - Injects test script into CDP context
   - Returns error object if DOM selectors fail: `{ error: 'chat container not found', debug: {...} }`
   - Validates Base64 image conversion: `if (imageUrl.startsWith('data:'))` check
   - Ensures CSS parsing succeeds before sending to client

4. **Client-side Fetch Validation** (`public/js/app.js:39-55`):
   ```javascript
   async function fetchWithAuth(url, options = {}) {
       const res = await fetch(url, options);
       if (res.status === 401) {
           console.log('[AUTH] Unauthorized, redirecting to login...');
           window.location.href = '/login.html';
       }
       return res;
   }
   ```
   - Checks response status codes
   - Redirects on 401 (unauthorized)
   - Returns 503 when snapshot unavailable, client handles gracefully

## Error Checking Patterns

**Defensive Error Handling:**

1. **Silent Failures with Fallback** (`discovery_claude.js:16-25`):
   ```javascript
   for (const port of PORTS) {
       try {
           const list = await getJson(`http://127.0.0.1:${port}/json/list`);
           const target = list.find(t => t.url?.includes('workbench.html'));
           if (target) return target.webSocketDebuggerUrl;
       } catch (e) {}
   }
   return null; // Falls back to null if all ports fail
   ```

2. **Nested Context Try-Catch** (`server.js:397-425`):
   ```javascript
   for (const ctx of cdp.contexts) {
       try {
           const result = await cdp.call("Runtime.evaluate", {
               expression: CAPTURE_SCRIPT,
               returnByValue: true,
               contextId: ctx.id
           });
           if (result.result && result.result.value) {
               return result.result.value;
           }
       } catch (e) { /* Continue to next context */ }
   }
   return 'Failed to inspect'; // Final fallback
   ```

3. **DOM Element Existence Checks** (`server.js:231-239`):
   ```javascript
   let cascade = document.getElementById('conversation') || 
                document.getElementById('chat') || 
                document.getElementById('cascade');
   
   if (!cascade) {
       return { error: 'chat container not found', debug: { ... } };
   }
   ```

## Test Data & Manual Verification

**Discovery Tests** - File: `discovery_claude.js`
- Utility script for manual testing CDP discovery
- Scans all 4 ports and returns available targets
- Can be run manually: `node discovery_claude.js`
- Outputs targets as JSON for inspection

**UI Inspection Tests** - Files: `ui_inspector.js`, `inspect_claude_webview.js`
- Manual inspection utilities to examine DOM structure
- `ui_inspector.js`: Serializes input container DOM
- `inspect_claude_webview.js`: Investigates Claude Code extension targets
- Can be called during runtime via server: `GET /debug-ui`, `GET /ui-inspect`

**SSL Certificate Generation** - File: `generate_ssl.js`
- Can be run independently: `node generate_ssl.js`
- Self-validates by checking file existence before regenerating
- Provides feedback on method used (OpenSSL vs Node.js crypto)
- Includes startup instructions in console output

## Snapshot Validation

**Server-side Snapshot Logic** (`server.js:1530-1560`):
```javascript
// Calculate hash to detect changes
const hash = hashString(html + css).substring(0, 36);

if (hash !== lastSnapshotHash) {
    lastSnapshot = { html, css, stats };
    lastSnapshotHash = hash;
    // Broadcast update to all connected clients
    broadcastSnapshot();
} else {
    // No change - don't broadcast (prevents unnecessary updates)
}
```

**Validation checks:**
- Hash comparison detects content changes
- Only broadcasts updates when content actually changes
- Stats calculation validates DOM structure: counts nodes, measures sizes
- Validates HTTP status for error conditions

**Client-side Rendering Validation** (`public/js/app.js:228-265`):
```javascript
async function loadSnapshot() {
    const response = await fetchWithAuth('/snapshot');
    if (!response.ok) {
        if (response.status === 503) {
            chatIsOpen = false;
            showEmptyState();
            return;
        }
        throw new Error('Failed to load');
    }
    
    chatIsOpen = true;
    const data = await response.json();
    // Validates data structure before rendering
}
```

## Scroll Synchronization Tests

**Lock Duration Tests** (`public/js/app.js:56-257`):
```javascript
const USER_SCROLL_LOCK_DURATION = 3000; // 3 second user lock
let userScrollLockUntil = 0;

// When user scrolls
userScrollLockUntil = Date.now() + USER_SCROLL_LOCK_DURATION;

// Check if locked
const isUserScrollLocked = Date.now() < userScrollLockUntil;

// Auto-scroll only allowed when not locked
if (autoRefreshEnabled && !userIsScrolling && !isUserScrollLocked) {
    // Allow scroll sync from Desktop
}
```

**Scroll Position Calculation** (`public/js/app.js:252-256`):
```javascript
const scrollPos = chatContainer.scrollTop;
const scrollHeight = chatContainer.scrollHeight;
const clientHeight = chatContainer.clientHeight;
const isNearBottom = scrollHeight - scrollPos - clientHeight < 120;
```
- Validates scroll state before updates
- Determines if user is near bottom with 120px threshold

## Authentication Testing

**Server-side Auth Check** (`server.js:authMiddleware`):
```javascript
// Automatically exempts LAN IPs from auth
const isLanIP = (ip) => ip === '127.0.0.1' || 
                        ip.startsWith('192.168.') || 
                        ip.startsWith('10.');

if (isLanIP(req.ip)) {
    // Allow without cookie check
    return next();
}

// Remote access requires valid auth token
const token = req.cookies?.[AUTH_COOKIE_NAME];
if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
}
```

**Client-side Auth Check** (`public/js/app.js:199-201`):
```javascript
if (data.type === 'error' && data.message === 'Unauthorized') {
    window.location.href = '/login.html';
    return;
}
```

## Known Testing Gaps

**Untested Areas:**
- `public/css/style.css` - Styling not validated by code tests
- `launcher.py` - Python launcher process management untested
- `generate_ssl.js` - Certificate validity not checked post-generation
- Context menu installers (`.bat` and `.sh` scripts) - Shell scripts untested
- Edge cases in DOM parsing for different Antigravity versions
- Concurrent WebSocket client connections (only basic connection tested)
- Rate limiting on API endpoints

**Why no tests exist:**
- Project started as prototype/utility rather than production codebase
- Heavy runtime dependency on external systems (Antigravity, CDP, browser DOM)
- Manual integration testing more practical than unit tests
- No test CI/CD pipeline configured in repository

## Validation Through Documentation

**CODE_DOCUMENTATION.md** validates implementation:
- Documents all 22 API endpoints and their expected behavior
- Describes data flow from Antigravity → Server → Phone
- Lists startup sequence requirements with order validation
- Specifies timeout constants (30s CDP call, 3s scroll lock, 5s idle detection)
- References security considerations and input sanitization

## Performance Validation

**Runtime Metrics** (`public/js/app.js:260-264`):
```javascript
if (data.stats) {
    const kbs = Math.round((data.stats.htmlSize + data.stats.cssSize) / 1024);
    const nodes = data.stats.nodes;
    const statsText = document.getElementById('statsText');
    if (statsText) statsText.textContent = `${nodes} Nodes · ${kbs}KB`;
}
```
- Tracks DOM node count
- Measures HTML/CSS size in kilobytes
- Displays metrics to verify snapshot efficiency

---

*Testing analysis: 2026-04-06*
