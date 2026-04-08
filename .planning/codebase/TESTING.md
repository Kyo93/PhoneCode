# Testing Patterns

**Analysis Date:** 2026-04-08

## Test Framework

**Status:** No automated testing framework configured

**Runner:** None
- No Jest, Vitest, Mocha, or other test runner in package.json
- No test scripts in `package.json` (only `start` and `dev`)

**Assertion Library:** None

**Configuration Files:** None found
- No `jest.config.js`, `vitest.config.ts`, `.mocharc.*`

**Current Test Coverage:** 0% - no automated tests exist

## Test File Organization

**Location:** No test files found
- No `*.test.js`, `*.spec.js`, or test directory
- Searched: `**/*.test.js`, `**/*.spec.js` - no results

**Testing approach:** Manual/exploratory testing only

## Manual Testing Strategy (Implied)

Based on code structure, manual testing likely covers:

**Backend (server.js):**
1. CDP discovery and connection on multiple ports (9000-9003)
2. WebSocket client authentication
3. Snapshot capture and refresh cycles
4. Remote click/scroll operations
5. Mode and model switching
6. Chat history retrieval
7. Message injection
8. Target switching (Antigravity vs Claude Code)
9. SSL certificate generation
10. Port cleanup on startup

**Frontend (app.js):**
1. Snapshot rendering and updates
2. Scroll position preservation
3. Chat history display
4. Message sending
5. Code block copy functionality (multi-platform)
6. Mobile keyboard handling
7. Dark mode CSS injection
8. Question overlay detection and interaction
9. Target tab switching
10. Auto-resume last conversation

**Integration:**
1. Mobile device connection (same Wi-Fi or ngrok tunnel)
2. Auth token validation (magic link, cookies)
3. Message flow from phone to desktop app
4. Scroll sync bidirectional
5. Real-time snapshot updates via WebSocket

## Code Structure for Testability

**Observations:**

**Testable patterns:**
1. **Pure utility functions:**
   - `hashString()` (line 1290) - deterministic hash function
   - `getLocalIP()` (line 80) - network interface parsing
   - `isLocalRequest()` (line 1301) - request classification

2. **Injected dependencies:**
   - All CDP operations receive `cdp` parameter (connection object)
   - Functions don't directly access globals; state passed as parameters
   - WebSocket callbacks isolated from business logic

3. **Separated concerns:**
   - Snapshot capture isolated in `targets/*.js` modules
   - Message injection separated from display logic
   - Authentication in middleware, not business functions

**Hard-to-test patterns:**
1. **Heavy DOM manipulation:** Functions rely on specific DOM structure (targets/claude.js lines 220-300)
2. **Inline scripts as strings:** CDP expressions embedded as strings (server.js lines 211-290)
3. **External process calls:** `execSync()` for port cleanup (line 45-68)
4. **Global state mutation:** `currentTarget`, `lastSnapshot`, `cdpConnections` are module-scope
5. **Timing-dependent logic:** Polling intervals, debouncing, retry timeouts
6. **Browser APIs:** No mocking strategy for fetch, WebSocket, clipboard APIs

## Error Handling Patterns (Relevant to Testing)

**Defensive patterns observed:**

1. **Context iteration** (universal pattern across all async functions):
   ```javascript
   let lastErr;
   for (const ctx of cdp.contexts) {
       try {
           const res = await cdp.call(...);
           if (res.result?.value) return res.result.value;
       } catch (e) { lastErr = e; }
   }
   if (lastErr) console.error('[functionName] all contexts failed:', lastErr.message);
   return { error: 'Context failed' };
   ```
   - Multiple execution contexts tried sequentially
   - Last error logged only if all fail (reduces noise)
   - Graceful failure with error object

2. **Selector fallback chains** (DOM manipulation functions):
   ```javascript
   // Strategy 1: Look for data-tooltip-id
   let element = document.querySelector('[data-tooltip-id="specific"]');
   
   // Strategy 2: Search by keywords + icon
   if (!element) { element = findByKeyword(...); }
   
   // Strategy 3: Traverse from text nodes
   if (!element) { element = findByTraversal(...); }
   
   // Return error if all fail
   if (!element) return { error: 'not found' };
   ```

3. **Safe text injection** (prevents code injection):
   ```javascript
   const safeText = JSON.stringify(textContent || '');
   const EXP = `(async () => { ... ${safeText} ... })()`;
   ```

4. **Timeout protection** (prevents hung operations):
   ```javascript
   const CDP_CALL_TIMEOUT = 30000;
   const timeoutId = setTimeout(() => {
       if (pendingCalls.has(id)) {
           pendingCalls.delete(id);
           reject(new Error(`CDP call ${method} timed out`));
       }
   }, CDP_CALL_TIMEOUT);
   ```

## What Should Be Tested

**High priority (critical path):**

1. **CDP Connection & Discovery:**
   - `discoverCDP()` with multiple ports responding
   - `connectCDP()` with valid WebSocket
   - Retry logic when ports don't respond
   - Test: `server.js:119-143`

2. **Message Injection:**
   - Valid message appears in snapshot after send
   - Empty message rejected
   - Large messages truncated or handled gracefully
   - Test: `app.js:679-729`, `targets/claude.js:142-219`

3. **Snapshot Rendering:**
   - CSS injection applied correctly
   - Dark mode overrides present
   - Scroll position preserved
   - No XSS vulnerabilities in HTML
   - Test: `app.js:432-517`, `targets/claude.js:34-137`

4. **Authentication:**
   - Local requests bypass auth
   - Magic link auto-login works
   - Cookie validation
   - 401 redirect to login
   - Test: `server.js:1476-1509`

5. **Mobile Interactions:**
   - Code block copy works on iOS and Android
   - Scroll sync doesn't break on fast scrolling
   - Keyboard doesn't push content off-screen
   - Test: `app.js:610-669`, `app.js:782-815`

**Medium priority (important features):**

6. **Question Detection & Interaction:**
   - AskUserQuestion overlay appears
   - Options can be selected/deselected
   - Multi-question navigation works
   - Cancel dismisses overlay
   - Test: `app.js:842-1078`, `targets/claude.js:373-492`

7. **Chat History:**
   - Most recent chats appear first
   - Session IDs parsed correctly from JSONL
   - Selecting chat loads conversation
   - Test: `server.js:2104-2183`, `app.js:1131-1274`

8. **Target Switching:**
   - Current target tracked correctly
   - Tabs update connection status
   - Snapshot reloads on switch
   - Test: `app.js:283-332`, `server.js:1956-1982`

**Low priority (edge cases):**

9. **Port Cleanup:**
   - Existing process killed on startup
   - Platform-specific (Windows/Linux)
   - Test: `server.js:41-76`

10. **SSL Certificate Generation:**
    - Command executes successfully
    - Certificates written to disk
    - Server restarts with HTTPS
    - Test: `server.js:1600-1615`

## Testing Gaps & Risks

**Critical gaps:**

1. **No automated regression tests** - Cannot verify fixes don't break features
2. **No unit tests** - Pure functions like `hashString()` untested
3. **No integration tests** - Phone→Desktop message flow untested end-to-end
4. **No E2E tests** - Real browser automation not configured
5. **No mock/stub framework** - Cannot isolate CDP layer for testing

**High-risk areas without tests:**

1. **CDP interaction** (35% of codebase) - If connection logic breaks, entire app fails
2. **DOM manipulation** (20% of codebase) - UI changes break selectors
3. **Scroll sync** (5% of codebase) - Complex state management
4. **Authentication** (10% of codebase) - Security-critical, untested
5. **Mobile compatibility** (15% of codebase) - iOS/Android specific code

## Recommended Test Setup

**If tests were to be added:**

1. **Test framework:** Vitest (lightweight, ESM-native)
2. **DOM testing:** jsdom or happy-dom
3. **Assertion library:** Vitest built-in expect()
4. **Mocking:** vi.mock() for fetch, WebSocket, fs
5. **Coverage tool:** Built into Vitest

**Suggested structure:**
```
tests/
├── unit/
│   ├── hashString.test.js
│   ├── isLocalRequest.test.js
│   └── getLocalIP.test.js
├── integration/
│   ├── cdp-connection.test.js
│   ├── snapshot-render.test.js
│   └── message-injection.test.js
├── e2e/
│   ├── auth-flow.test.js
│   └── message-flow.test.js
└── mocks/
    ├── cdp.mock.js
    └── websocket.mock.js
```

## QA Strategy (Current - Manual)

**Based on code comments and structure:**

1. **Platform testing:**
   - Desktop: Antigravity or Claude Code extension running
   - Mobile: Same Wi-Fi network or ngrok tunnel
   - Browsers: Chrome/Chromium for Desktop (CDP requirement), Safari/Chrome for mobile

2. **Environment variables required:**
   - `APP_PASSWORD` - App access password
   - `AUTH_SALT` - Auth token generation
   - `SESSION_SECRET` - Cookie signing
   - `PORT` - Server port (default 3000)

3. **Manual test checklist (implied from code):**
   - [ ] Server starts, discovers CDP on ports 9000-9003
   - [ ] Mobile device can connect and authenticate
   - [ ] Snapshot updates in real-time via WebSocket
   - [ ] Message from mobile appears on desktop
   - [ ] Desktop mode/model changes sync to mobile
   - [ ] Chat history loads for both targets
   - [ ] Code blocks have copy button on mobile
   - [ ] AskUserQuestion prompts work (Claude Code)
   - [ ] Scroll position preserved when switching targets
   - [ ] SSL banner appears on HTTP, can generate certs
   - [ ] Port cleanup happens on restart

## Coverage Status

**Code coverage:** 0% (no tests)
**Feature coverage:** ~60% (most features manually tested, some edge cases untested)
**Risk level:** HIGH - critical path untested, easy to introduce regressions

## Maintenance Notes

**If tests were added:**
- Update tests when changing DOM selectors (happens frequently based on commit history)
- Mock CDP responses when testing message flow
- Use real browser for E2E to catch mobile-specific issues
- Run on multiple Node versions (currently requires >=16.0.0)

