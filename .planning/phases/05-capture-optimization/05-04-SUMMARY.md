---
phase: 05-capture-optimization
plan: "04"
subsystem: capture-pipeline
tags: [cdp, snapshot, css, cache-invalidation, bug-fix]

# Dependency graph
requires:
  - phase: 05-03
    provides: MutationObserver HTML cache with early-return that omits css field
  - phase: 05-02
    provides: CSS fingerprint cache with null-CSS server contract
  - phase: 05-01
    provides: invalidateSnapshotCache method on target modules

provides:
  - Loose effectiveCSS guard (snapshot.css != null) catches both null and undefined
  - initCDP() clears stale browser globals after each CDP reconnect
  - REQ-06 AC5 satisfied for CDP reconnect path (not only target switch)

affects: [05-capture-optimization, server-restart-regression]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Loose != null guard to catch both null and undefined from optional fields"
    - "invalidateSnapshotCache called immediately after cdpConnections.set() in initCDP"

key-files:
  created: []
  modified:
    - server.js

key-decisions:
  - "Loose != null replaces strict !== null for effectiveCSS guard — defense-in-depth for any future code path that omits css field"
  - "invalidateSnapshotCache called after BOTH antigravity and claude cdpConnections.set() in initCDP — not only /switch-target"
  - "Optional chaining (TARGETS[key]?.invalidateSnapshotCache?.) guards targets that predate 05-01 deployment"
  - "Gap 2 fix (CDP reconnect cache clear) prevents Gap 1 (undefined css) from manifesting; Gap 1 fix is defense-in-depth"

patterns-established:
  - "effectiveCSS guard uses loose != null: catches null (CSS fingerprint cache hit) and undefined (MutationObserver cache hit)"
  - "After cdpConnections.set(), always call invalidateSnapshotCache to clear stale browser globals from prior session"

requirements-completed: [REQ-06]

# Metrics
duration: 15min
completed: 2026-04-08
---

# Phase 5 Plan 04: Gap Closure — effectiveCSS Undefined Guard + CDP Reconnect Cache Invalidation Summary

**Loose != null effectiveCSS guard + invalidateSnapshotCache in initCDP close server-restart CSS regression where stale MutationObserver globals caused undefined css to reach lastSnapshot**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-08T00:00:00Z
- **Completed:** 2026-04-08T00:15:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Fixed effectiveCSS guard from strict `!== null` to loose `!= null` — undefined from MutationObserver early-return now falls back to lastSnapshot.css instead of propagating as undefined
- Added `TARGETS['antigravity']?.invalidateSnapshotCache?.(conn).catch(() => {})` call after each `cdpConnections.set()` in `initCDP()` for both antigravity and claude targets
- Server-restart regression closed: first poll after reconnect now clears stale `__phoneCodeLastHTML` / `__phoneCodeObserver` globals, forcing full capture with real CSS
- REQ-06 AC5 (cache invalidated on CDP context reset) satisfied for CDP reconnect path, previously only satisfied for `/switch-target`

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix effectiveCSS guard — strict !== to loose != (catches undefined)** - `c5028cc` (fix)
2. **Task 2: Call invalidateSnapshotCache in initCDP() after each CDP connection** - `85522a1` (feat)

## Files Created/Modified

- `server.js` — effectiveCSS loose guard + invalidateSnapshotCache in initCDP for antigravity and claude

## Decisions Made

- Loose `!= null` replaces strict `!== null` for effectiveCSS guard to catch both null (CSS fingerprint cache hit, 05-02) and undefined (MutationObserver early-return omits css field, 05-03)
- Gap 2 fix (invalidateSnapshotCache in initCDP) prevents Gap 1 (undefined css leaking to lastSnapshot) from manifesting; Gap 1 fix is defense-in-depth for any future code path that omits the css field
- Optional chaining (`?.invalidateSnapshotCache?.()`) guards targets that predate the 05-01 deployment

## Deviations from Plan

None - plan executed exactly as written. Dev branch was merged into worktree branch before execution to bring in 05-01/02/03 changes that this plan depends on.

## Issues Encountered

Worktree branch `worktree-agent-ac14040f` was created from a commit predating the 05-01, 05-02, and 05-03 plan changes. Merged `dev` into the worktree branch before applying this plan's changes so that the effectiveCSS code from 05-02 and MutationObserver code from 05-03 were present for patching.

## Known Stubs

None - both code changes are complete, functional guards with no placeholder values.

## Next Phase Readiness

- Phase 5 gap closure complete — all 4 plans (05-01 through 05-04) executed
- Server-restart regression with browser tab retained is now closed
- Ready for Phase 1 (Testing Foundation) or Phase 2 (Tech Debt Refactoring)

---
*Phase: 05-capture-optimization*
*Completed: 2026-04-08*
