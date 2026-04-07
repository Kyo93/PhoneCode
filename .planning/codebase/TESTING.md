# Testing Patterns

**Analysis Date:** 2026-04-07

## Test Framework

**Runner:**
- Not detected - no testing framework configured
- No test config files: no `jest.config.js`, `vitest.config.js`, `karma.conf.js`
- No testing dependencies in `package.json` (only: compression, cookie-parser, dotenv, express, ws)

**Assertion Library:**
- Not detected - no test assertions present

**Run Commands:**
- No test commands defined in `package.json` scripts
- Current scripts: `"start": "node server.js"`, `"dev": "node server.js"`

## Test File Organization

**Location:**
- No test files found in codebase
- Searched pattern: `*.test.js`, `*.spec.js`, `*.test.ts`, `*.spec.ts` returned 0 results
- No separate `test/` or `__tests__/` directories

**Naming:**
- Not applicable - no tests present

**Structure:**
- Not applicable - no tests present

## Test Coverage

**Requirements:**
- Not enforced - no coverage config detected
- No coverage tools installed (no nyc, c8, jest coverage config)

## Test Types

**Unit Tests:**
- Not present

**Integration Tests:**
- Not present

**E2E Tests:**
- Not present
- Manual testing indicated by hand-written error scenarios in UI code
- Example: `clickElement()` function tests multiple DOM traversal strategies inline (server.js lines 341-396)

## Testing Approach Observed

**Manual Validation Pattern:**
Instead of automated tests, the codebase uses inline validation and fallback strategies:

**DOM Element Location:**
Multiple strategies tested in order within single CDP expressions:
```javascript
// From server.js lines 217-243 (setMode function)
// Strategy 1: Look for data-tooltip-id patterns (most reliable)
modelBtn = document.querySelector('[data-tooltip-id*="model"], ...');

// Strategy 2: Look for buttons/elements containing model keywords
if (!modelBtn) {
    const candidates = Array.from(document.querySelectorAll('button, ...'))
        .filter(el => { ... });
    modelBtn = candidates.find(el => { ... }) || candidates[0];
}

// Strategy 3: Traverse from text nodes up to clickable parents
if (!modelBtn) {
    const allEls = Array.from(document.querySelectorAll('*'));
    const textNodes = allEls.filter(el => { ... });
    // Walk up 5 levels looking for clickable parent
    for (const el of textNodes) {
        let current = el;
        for (let i = 0; i < 5; i++) {
            if (!current) break;
            if (current.tagName === 'BUTTON' || ...) {
                modelBtn = current;
                break;
            }
            current = current.parentElement;
        }
    }
}
```

**Error Response Pattern:**
Functions return error objects for validation, allowing callers to decide handling:
```javascript
// From server.js line 391
if (res.result?.value?.success) return res.result.value;
// If we found it but click didn't return success (unlikely with this script), continue to next context
```

**Context Fallback Pattern:**
Multiple execution contexts tried sequentially, allowing graceful degradation:
```javascript
// From server.js lines 383-394
for (const ctx of cdp.contexts) {
    try {
        const res = await cdp.call("Runtime.evaluate", { ... });
        if (res.result?.value?.success) return res.result.value;
    } catch (e) { }
}
return { error: 'Click failed in all contexts...' };
```

**Input Validation Inline:**
```javascript
// From server.js line 209
if (!['Fast', 'Planning'].includes(mode)) return { error: 'Invalid mode' };

// From server.js line 1634
if (!message) {
    return res.status(400).json({ error: 'Message required' });
}
```

**Snapshot Verification Pattern:**
Hash-based change detection to avoid unnecessary DOM updates:
```javascript
// From app.js lines 472-482
const newCssHash = data.css ? data.css.length + ':' + data.css.slice(0, 64) : '';
if (newCssHash !== lastDynamicCssHash) {
    // Only update if CSS changed
    styleTag.textContent = data.css || '';
    lastDynamicCssHash = newCssHash;
}
```

## Testing Recommendations

**Current State:**
- No automated test infrastructure
- Manual UI testing through Chrome DevTools/CDP inspection
- Reliability depends on multiple fallback strategies and error handling

**Risk Areas Without Tests:**
- `captureSnapshot()` functions in targets - complex DOM manipulation
- `injectMessage()` - message injection into multiple targets
- WebSocket reconnection logic - connection state machine
- Authentication middleware - cookie parsing and validation

**Adding Tests:**
To implement testing, add to `package.json`:
```json
{
  "devDependencies": {
    "jest": "^29.0.0",
    "node-mocks-http": "^1.13.0"
  },
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

**Test File Locations (If Added):**
- `__tests__/server.test.js` - Server route handlers
- `__tests__/targets/antigravity.test.js` - Antigravity target functions
- `__tests__/targets/claude.test.js` - Claude target functions
- `public/__tests__/app.test.js` - Client-side app functions

## Mocking Strategy

**Would Use:**
- Mock CDP connections via Jest mocks for context evaluation
- Mock WebSocket for client testing
- Mock HTTP responses with node-mocks-http
- Mock file system for snapshot tests

**Example Mock Pattern (Not Currently Used):**
```javascript
// Would mock cdp.call() to test captureSnapshot without real CDP
jest.mock('../cdp', () => ({
    call: jest.fn().mockResolvedValue({
        result: { value: { html: '<div>test</div>', css: '' } }
    })
}));
```

## Debug/Inspection Endpoints

**Manual Testing Points:**
- `/debug-ui` (server.js line 1593) - Full UI tree inspection via CDP
- `/ui-inspect` (server.js line 1657) - Button scanning and frame analysis
- `/cdp-targets` (server.js line 1852) - Lists all discovered CDP targets
- `/health` (server.js line 1550) - Server/CDP connection health
- `/ssl-status` (server.js line 1562) - HTTPS certificate status

These endpoints serve as manual test hooks for development.

## Error Scenario Testing

**Implicit Test Scenarios in Code:**

1. **CDP Connection Loss** (server.js lines 1336-1359):
   - Monitors connection state, logs reconnection attempts
   - Triggers `initCDP()` on connection loss

2. **Missing DOM Elements** (server.js lines 341-396):
   - Tests multiple selector strategies
   - Returns error with element count found

3. **Timeout Handling** (server.js lines 186-199):
   - 30-second timeout on CDP calls
   - Cleans up pending calls to prevent memory leaks

4. **Auth Failures** (server.js lines 1452-1485):
   - 401 response on invalid cookie
   - Auto-redirect to login on client

5. **Network Recovery** (app.js lines 414-415):
   - WebSocket reconnects every 2 seconds on disconnect
   - Maintains state across reconnections

---

**Summary:** This is a **manual-testing** codebase with no automated test suite. Reliability is achieved through:
- Multiple DOM traversal strategies with fallbacks
- Error object returns instead of exceptions
- Context-level fault tolerance (try next execution context)
- Hash-based deduplication
- Explicit validation on entry points
