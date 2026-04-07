# Requirements: PhoneCode

## REQ-01: Test Infrastructure

**Priority**: High
**Phase**: 1 (Testing Foundation)

The project must have a functioning test setup that developers can run locally and in CI.

### Acceptance Criteria
- `npm test` runs and exits with code 0 when all tests pass
- Test framework is configured (Jest, Vitest, or equivalent)
- Test files are co-located with source or in a `tests/` directory
- CI-compatible (no interactive prompts, no hard-coded local paths)

---

## REQ-02: Critical Path Test Coverage

**Priority**: High
**Phase**: 1 (Testing Foundation)

The most fragile and high-stakes code paths must have test coverage before any refactoring begins.

### Acceptance Criteria
- CDP discovery logic (`discoverCDP`, target `discover()` functions) is unit tested
- Snapshot hash change detection is tested (same content → no broadcast, different → broadcast)
- Auth middleware is tested: LAN bypass, cookie validation, magic link auto-login
- `injectMessage` for both Antigravity and Claude Code targets has basic smoke tests

---

## REQ-03: Server Modularization

**Priority**: Medium
**Phase**: 2 (Tech Debt Refactoring)

`server.js` at 1940 lines is difficult to navigate and test. It must be split into focused modules.

### Acceptance Criteria
- `server.js` is ≤200 lines — entry point only (creates server, starts polling, registers routes)
- CDP bridge logic is in a dedicated module (`lib/cdp.js` or equivalent)
- Route handlers are grouped by domain (auth, snapshot, targets, actions)
- Target adapter interface is unchanged — `targets/antigravity.js` and `targets/claude.js` are not restructured
- All Phase 1 tests continue to pass after refactor

---

## REQ-04: Mobile UX Polish

**Priority**: Medium
**Phase**: 3 (Mobile UX Improvements)

The mobile experience must remain smooth during long sessions and feel responsive on both iOS Safari and Android Chrome.

### Acceptance Criteria
- Scroll sync delay is ≤300ms from phone scroll event to desktop scroll update
- Connection state badge accurately reflects live / reconnecting / disconnected states in real time
- No visual degradation or memory growth after 4 hours of continuous use (verified by manual session test)
- Mobile copy buttons render correctly and are tappable (44px minimum touch target) in iOS Safari 16+ and Android Chrome 110+
- Quick action chips work reliably (no race conditions with snapshot reloads)

---

## Non-Functional Requirements

### Performance
- Snapshot polling: 1s interval (hardcoded, acceptable for single-user tool)
- Snapshot update broadcast: only when HTML hash changes — no unnecessary client work
- Server memory: stable for overnight runs (no accumulating state beyond `lastSnapshot`)

### Security
- Remote access via ngrok requires passcode authentication
- Auth cookies: signed, HttpOnly, 30-day expiry
- LAN clients: auto-trusted (no auth required)
- CDP JS injection: user input always escaped via `JSON.stringify` before injection

### Compatibility
- Server: Node.js ≥16, Windows 10 + Linux + macOS
- Mobile client: iOS Safari 16+, Android Chrome 110+
- Target apps: Any Electron/Chromium app exposing `--remote-debugging-port`
