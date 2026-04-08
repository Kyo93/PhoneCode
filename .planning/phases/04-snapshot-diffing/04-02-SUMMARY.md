---
phase: "04"
plan: "02"
subsystem: "client"
tags: ["diff-dom", "websocket", "snapshot", "patching", "performance"]
dependency_graph:
  requires: ["04-01"]
  provides: ["snapshot-diff-apply"]
  affects: ["public/js/app.js", "public/index.html", "public/js/diff-dom.min.js"]
tech_stack:
  added: ["diff-dom@5.2.1 (browser IIFE wrapper)"]
  patterns: ["DOM clone rollback", "seq-based ordering", "CJS-to-browser IIFE shim"]
key_files:
  created:
    - public/js/diff-dom.min.js
  modified:
    - public/js/app.js
    - public/index.html
decisions:
  - "Wrap diff-dom CJS build in IIFE shim since v5 ships no UMD build"
  - "Use document.getElementById('chatContent') in loadSnapshot and addMobileCopyButtons to survive rollback replacing the chatContent const ref"
  - "snapshotSeq reset in connectWebSocket (before new WebSocket) rather than onclose to cover initial connect as well"
metrics:
  duration_minutes: 15
  completed: "2026-04-08T04:36:48Z"
  tasks_completed: 7
  files_changed: 3
---

# Phase 04 Plan 02: Client-Side Patch Application Summary

**One-liner:** DOM diff patching via diff-dom@5 with seq-ordered application, clone-based rollback, and full-resync fallback.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Serve diff-dom locally + index.html script tag | 8ea0692 | public/js/diff-dom.min.js, public/index.html |
| 2 | Add DiffDOM instance and seq globals | 81749b3 | public/js/app.js:41-44 |
| 3 | Track seq in loadSnapshot() | 81749b3 | public/js/app.js:477-480 |
| 4 | Replace ws.onmessage to route snapshot_diff | 81749b3 | public/js/app.js:410-431 |
| 5 | Implement applySnapshotDiff() with rollback | 81749b3 | public/js/app.js:550-632 |
| 6 | Fix loadSnapshot/addMobileCopyButtons to use getElementById | 81749b3 | public/js/app.js:499,544 |
| 7 | Reset seq on reconnect (connectWebSocket) | 81749b3 | public/js/app.js:399-401 |
| 8 | Reset seq on target switch (switchTarget) | 81749b3 | public/js/app.js:327-328 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] diff-dom v5 ships CJS only, no UMD browser build**
- **Found during:** Task 1
- **Issue:** The plan URL `https://cdn.jsdelivr.net/npm/diff-dom@5/dist/diff-dom.min.js` returns a 404. diff-dom v5 renamed the output to `dist/index.min.js` and dropped the UMD format, shipping only CJS (`exports.DiffDOM = ...`).
- **Fix:** Downloaded `dist/index.min.js` (diff-dom@5.2.1) and wrapped it in a browser IIFE: `(function(root){var exports={};...;root.DiffDOM=exports.DiffDOM;})(window)`. The library has zero `require()` calls so wrapping works without a bundler.
- **Files modified:** `public/js/diff-dom.min.js`
- **Commit:** 8ea0692

**2. [Rule 2 - Missing] addMobileCopyButtons also referenced stale chatContent const**
- **Found during:** Task 5 sub-step review
- **Issue:** Plan Task 5 notes that `loadSnapshot()` must switch to `getElementById` for rollback safety. `addMobileCopyButtons()` on line 522 also queried `chatContent` directly and would fail with a detached node after rollback.
- **Fix:** Changed `chatContent.querySelectorAll('pre')` to `document.getElementById('chatContent').querySelectorAll('pre')`.
- **Files modified:** `public/js/app.js`
- **Commit:** 81749b3

## Decisions Made

1. **IIFE browser shim** — diff-dom v5 has no browser UMD distribution. Rather than pinning to v4 or pulling from esm.sh (which requires ES modules or import maps), we download the CJS build and wrap it in 2 lines of IIFE boilerplate. Zero external runtime dependency, works as a plain `<script>` tag.

2. **getElementById over const ref everywhere** — `chatContent` is `const` so it cannot be reassigned after a rollback replaces the node. All code that writes to or queries `chatContent` after a potential rollback path (loadSnapshot, addMobileCopyButtons) now uses `document.getElementById('chatContent')`. Read-only accesses in `applySnapshotDiff` still use the `const` because those run before any replacement.

3. **Seq reset in connectWebSocket before new WebSocket()** — Placing the reset at the top of `connectWebSocket()` covers both the initial connection and all reconnects, rather than only in `onclose`.

## Known Stubs

None. All wired to live data.

## Self-Check: PASSED

- `public/js/diff-dom.min.js` exists: FOUND (31469 bytes, wrapped IIFE)
- `public/js/app.js` contains `snapshotSeq`, `applySnapshotDiff`, `DiffDOM`: FOUND (grep output verified)
- Commits 8ea0692 and 81749b3: FOUND in git log
