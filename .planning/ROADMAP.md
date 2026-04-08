# Roadmap: PhoneCode

## Overview

PhoneCode is a mature, working tool. The roadmap focuses on hardening the existing implementation: adding a test baseline, reducing technical debt in the server monolith, and improving the mobile experience. No major architectural changes are planned.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (1.1, etc.): Urgent insertions (marked with INSERTED)

- [ ] **Phase 0.1: Claude Code Navigation** [INSERTED] - Fix broken conversation navigation for Claude Code target
- [ ] **Phase 1: Testing Foundation** - Establish test infrastructure and baseline coverage for critical paths
- [ ] **Phase 2: Tech Debt Refactoring** - Modularize server.js and improve code structure
- [ ] **Phase 3: Mobile UX Improvements** - Better scroll sync, gesture support, and UI polish
- [ ] **Phase 4: Snapshot Diffing** - Incremental diff-based snapshot updates to cut bandwidth 80–95%
- [ ] **Phase 5: Capture Pipeline Optimization** - Cache images and CSS inside browser context to cut snapshot capture time 60–90%

## Phase Details

### Phase 0.1: Claude Code Navigation [INSERTED]
**Goal**: Fix broken conversation navigation for Claude Code target — chat history selection does nothing, new chat button untested, no auto-resume of most recent conversation.
**Depends on**: Nothing (hotfix)
**Requirements**: N/A
**Success Criteria** (what must be TRUE):
  1. Clicking a chat in the history panel navigates Claude Code to that conversation
  2. "New Chat" button works for Claude Code target
  3. On connect, Claude Code shows the most recent conversation (not blank)
**Plans:** 2 plans

Plans:
- [ ] 00.1-01-PLAN.md — Backend: add selectChat + startNewChat to targets/claude.js and wire server.js endpoints
- [ ] 00.1-02-PLAN.md — Frontend: fix history card onclick for Claude + add auto-resume on empty state

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

### Phase 4: Snapshot Diffing
**Goal**: Replace full-HTML snapshot broadcasts (500KB–2MB each) with incremental diff-based updates so the mobile client only receives changed nodes, reducing bandwidth by 80–95% and improving responsiveness on slow connections.
**Depends on**: Phase 2 (modular server makes diffing logic easier to isolate)
**Requirements**: REQ-05
**Success Criteria** (what must be TRUE):
  1. Server computes a structural diff between consecutive snapshots and sends only changed nodes
  2. Client applies patches to its local DOM copy instead of replacing the full iframe content
  3. First-load still receives full snapshot; subsequent updates are diffs
  4. Bandwidth per update drops to <20KB on typical sessions (vs. current 500KB–2MB)
  5. Visual output on mobile is identical to current full-replace approach
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md — Server: install diff-dom+jsdom, `lib/snapshot-diff.js`, seq counter, broadcast patch or fallback
- [ ] 04-02-PLAN.md — Client: load diff-dom, `applySnapshotDiff()`, seq tracking, reconnect/target-switch reset

### Phase 5: Capture Pipeline Optimization
**Goal**: Eliminate redundant work inside `captureSnapshot()` — images are re-fetched and CSS re-collected on every poll even when unchanged. Persistent browser-side caches skip already-processed data on repeat polls.
**Depends on**: Nothing (targets files only, standalone)
**Requirements**: REQ-06
**Success Criteria** (what must be TRUE):
  1. Images already converted in a prior poll are not re-fetched or re-converted
  2. CSS re-collected only when stylesheets actually change (fingerprint check)
  3. Snapshot capture time <200ms on polls where content is stable (vs. current 1–5s)
  4. No visual regression — snapshots still contain all images and correct CSS
  5. Cache cleared when CDP context resets or page navigates
**Plans**: 3 plans

Plans:
- [x] 05-01-PLAN.md — Image cache: `window.__phoneCodeImgCache`, skip >500KB, `invalidateSnapshotCache()` export
- [x] 05-02-PLAN.md — CSS cache: strengthened fingerprint, null CSS server contract fix, `window.__phoneCodeCSSFingerprint`
- [ ] 05-03-PLAN.md — MutationObserver cache: skip clone when DOM unchanged, `stats_update` WS, `⚡` indicator

**Goal**: Improve the mobile interaction quality — faster scroll sync, better visual feedback for connection state, and smoother handling of long sessions.
**Depends on**: Phase 2 (cleaner codebase makes frontend changes safer)
**Requirements**: REQ-04
**Success Criteria** (what must be TRUE):
  1. Scroll sync latency is visibly reduced or eliminated for typical use
  2. Connection state (connecting / live / reconnecting) is clearly communicated in the UI
  3. Long sessions (4+ hours) do not degrade scroll or snapshot performance
  4. Mobile copy buttons and quick actions work reliably across iOS Safari and Android Chrome
**Plans**: TBD
