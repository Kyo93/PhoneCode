# Roadmap: PhoneCode

## Overview

PhoneCode is a mature, working tool. The roadmap focuses on hardening the existing implementation: adding a test baseline, reducing technical debt in the server monolith, and improving the mobile experience. No major architectural changes are planned.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (1.1, etc.): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Testing Foundation** - Establish test infrastructure and baseline coverage for critical paths
- [ ] **Phase 2: Tech Debt Refactoring** - Modularize server.js and improve code structure
- [ ] **Phase 3: Mobile UX Improvements** - Better scroll sync, gesture support, and UI polish

## Phase Details

### Phase 1: Testing Foundation
**Goal**: Stand up a test framework and write tests covering the most critical and fragile parts of the system — CDP bridge, snapshot pipeline, and auth middleware.
**Depends on**: Nothing (can start immediately)
**Requirements**: REQ-01, REQ-02
**Success Criteria** (what must be TRUE):
  1. A test runner is configured and `npm test` runs without error
  2. CDP discovery and connection logic has unit/integration test coverage
  3. Snapshot capture and hash change detection are tested
  4. Auth middleware (LAN bypass, cookie validation, magic link) is tested
  5. Tests run on Windows and Linux (CI-compatible)
**Plans**: TBD

### Phase 2: Tech Debt Refactoring
**Goal**: Break `server.js` (1940 lines) into focused modules. Improve error messages, logging, and code clarity without changing external behavior.
**Depends on**: Phase 1 (tests provide regression safety net)
**Requirements**: REQ-03
**Success Criteria** (what must be TRUE):
  1. `server.js` is reduced to a thin entry point — route handlers, CDP logic, and polling are in separate modules
  2. All existing functionality still passes Phase 1 tests after refactor
  3. No new external API surface — same endpoints, same behavior
  4. Logging is structured and consistently formatted
**Plans**: TBD

### Phase 3: Mobile UX Improvements
**Goal**: Improve the mobile interaction quality — faster scroll sync, better visual feedback for connection state, and smoother handling of long sessions.
**Depends on**: Phase 2 (cleaner codebase makes frontend changes safer)
**Requirements**: REQ-04
**Success Criteria** (what must be TRUE):
  1. Scroll sync latency is visibly reduced or eliminated for typical use
  2. Connection state (connecting / live / reconnecting) is clearly communicated in the UI
  3. Long sessions (4+ hours) do not degrade scroll or snapshot performance
  4. Mobile copy buttons and quick actions work reliably across iOS Safari and Android Chrome
**Plans**: TBD
