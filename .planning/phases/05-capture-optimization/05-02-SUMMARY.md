---
phase: 05-capture-optimization
plan: 02
subsystem: capture-pipeline
tags: [css, fingerprint, cache, cdp, performance, browser-script]

# Dependency graph
requires:
  - phase: 05-01
    provides: LRU image cache + invalidateSnapshotCache() with CSS globals cleared
  - phase: 04-02
    provides: snapshot_diff broadcast + lastBroadcastCssHash in server.js
provides:
  - CSS fingerprint cache in both CAPTURE_SCRIPTs (skips re-collection when stylesheets unchanged)
  - window.__phoneCodeCSSFingerprint + window.__phoneCodeCSSCache globals
  - effectiveCSS null-guard in server.js (null CSS normalized before broadcast and lastSnapshot)
  - cssMs timing + cssCached flag in snapshot stats
affects:
  - 05-03 (MutationObserver builds on same CAPTURE_SCRIPT structure)
  - server.js polling loop — effectiveCSS normalization is permanent contract

# Tech tracking
tech-stack:
  added: []
  patterns:
    - CSS fingerprint: href+ruleCount+firstRule(64ch) for external sheets; djb2 content hash for inline
    - null-guard contract: browser returns allCSS=null on cache hit; server normalizes to prior CSS
    - double-backslash in template literal regexes to avoid \s becoming literal 's'

key-files:
  created: []
  modified:
    - targets/claude.js
    - targets/antigravity.js
    - server.js

key-decisions:
  - "First-rule content sample (64 chars) added to external sheet fingerprint to catch in-place CSS variable changes that ruleCount alone misses"
  - "allCSS=null signals cache hit; server effectiveCSS contract ensures null never reaches lastSnapshot or broadcast"
  - "Cross-origin (SecurityError) sheets use stable |blocked:N fingerprint — their CSS contribution is always empty so cache hit is safe"
  - "Pre-existing regex escaping bug fixed in claude.js: \\s/\\d double-backslash inside template literal (single \\s was silently broken)"

patterns-established:
  - "CSS fingerprint pattern: reduce(acc, sheet, i) across styleSheets returning pipe-separated segments"
  - "Cache-hit null pattern: allCSS=null from browser, effectiveCSS fallback in server before any processing"

requirements-completed: [REQ-06]

# Metrics
duration: 15min
completed: 2026-04-08
---

# Phase 5 Plan 02: CSS Collection Cache Summary

**CSS fingerprint cache using href+ruleCount+firstRule(64ch) avoids re-collecting thousands of rules on unchanged polls; server effectiveCSS null-guard ensures reconnecting clients never receive blank styles**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-08T00:00:00Z
- **Completed:** 2026-04-08T00:15:00Z
- **Tasks:** 4
- **Files modified:** 3

## Accomplishments

- Both `targets/claude.js` and `targets/antigravity.js` CAPTURE_SCRIPTs now compute a CSS fingerprint before attempting collection — cache hit returns `allCSS = null` in ~0ms instead of iterating all stylesheet rules
- `server.js` polling loop normalizes `snapshot.css = null` to the prior `lastSnapshot.css` via `effectiveCSS`, ensuring `GET /snapshot` always returns concrete CSS text even after N consecutive cache-hit polls
- `stats.cssMs` and `stats.cssCached` added to snapshot return in both targets, enabling observable cache efficiency metrics
- Pre-existing regex escaping bug fixed in `targets/claude.js`: CSS transform regexes used `\s`/`\d` (single backslash inside template literal = literal character), now use `\\s`/`\\d`

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix server null-CSS contract** - `fbeee51` (feat)
2. **Task 2: Add CSS fingerprint cache to targets/claude.js** - `d20c314` (feat)
3. **Task 3: Apply CSS fingerprint cache to targets/antigravity.js** - `84f7200` (feat)

_Note: Task 4 (cssMs/cssCached/null-guard stats) was applied atomically within Tasks 2 and 3 as required by the plan's critical ordering note._

## Files Created/Modified

- `server.js` — effectiveCSS null-guard: normalize snapshot.css=null before hash, broadcast, and lastSnapshot assignment
- `targets/claude.js` — CSS fingerprint cache block replacing raw rules loop; also fixes \\s/\\d escaping bug
- `targets/antigravity.js` — CSS fingerprint cache block replacing raw rules loop

## Decisions Made

- First-rule content sample (64 chars) strengthens external sheet fingerprint beyond rule count alone — catches CSS variable changes without adding or removing rules
- `allCSS = null` on cache hit (rather than returning cached string) keeps CDP transfer minimal; server is the authority for the prior CSS value
- Cross-origin blocked sheets fingerprinted as `|blocked:N` (stable by index) — their CSS contribution is always empty so a cache hit produces identical output to a cache miss
- Regex escaping bugfix in claude.js treated as correctness fix (Rule 1) per plan documentation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Merged dev branch — worktree missing 05-01 prerequisite commits**
- **Found during:** Task 1 (pre-execution check)
- **Issue:** The worktree `agent-ae514083` was branched from an older state and did not have the 05-01 image cache changes (`invalidateSnapshotCache`, LRU cache, `imgMs` stats). Plan 05-02 depends on 05-01.
- **Fix:** Fast-forward merged `dev` into the worktree branch to bring in all 05-01 commits
- **Files modified:** All files updated from dev merge
- **Verification:** `grep -n "invalidateSnapshotCache" targets/claude.js` confirmed present after merge
- **Committed in:** Fast-forward merge (no merge commit created)

---

**Total deviations:** 1 auto-fixed (blocking prerequisite)
**Impact on plan:** Required to meet plan preconditions. No scope creep.

## Issues Encountered

None during execution after prerequisite merge.

## Known Stubs

None. All CSS cache paths are fully wired: browser returns null on cache hit, server normalizes via effectiveCSS, clients receive valid CSS on both diff and full snapshot paths.

## Next Phase Readiness

- CSS cache is deployed and integrated — 05-03 (MutationObserver polling) can build on this CAPTURE_SCRIPT structure
- `invalidateSnapshotCache()` already clears both CSS globals, so target switches correctly reset the cache
- `stats.cssCached` + `stats.cssMs` observable in server console logs for verification

---
*Phase: 05-capture-optimization*
*Completed: 2026-04-08*
