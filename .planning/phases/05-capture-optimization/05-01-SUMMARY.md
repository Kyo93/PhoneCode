---
phase: 05-capture-optimization
plan: "01"
subsystem: capture-pipeline
tags: [performance, caching, cdp, image-optimization]
dependency_graph:
  requires: []
  provides: [window.__phoneCodeImgCache, invalidateSnapshotCache, imgMs-stats]
  affects: [targets/claude.js, targets/antigravity.js, server.js]
tech_stack:
  added: []
  patterns: [LRU-Map-cache, browser-context-persistent-globals, fire-and-forget-invalidation]
key_files:
  created: []
  modified:
    - targets/claude.js
    - targets/antigravity.js
    - server.js
decisions:
  - URL-only cache key acceptable for static VS Code/Claude Code icons
  - 50MB base64 budget (~37MB binary effective ceiling)
  - Silent error handling — no negative caching, images retry on next poll
  - CLEAR_SCRIPT includes CSS globals with null-safe guards (prep for 05-02)
metrics:
  duration_minutes: 11
  completed_date: "2026-04-08"
  tasks_completed: 5
  tasks_total: 5
  files_changed: 3
---

# Phase 5 Plan 01: Image Conversion Cache Summary

**One-liner:** LRU image cache in browser context eliminates redundant per-poll fetch+convert for VS Code/Claude UI icons using window.__phoneCodeImgCache Map with 50MB cap and silent error handling.

---

## What Was Built

Image conversion in both target capture scripts previously fetched and FileReader-converted every `<img>` on every 1-second poll — pure waste for static icons/logos. This plan adds a persistent browser-side LRU cache that survives across CDP `Runtime.evaluate` calls.

### Changes by file

**targets/claude.js** and **targets/antigravity.js** (identical changes):
- `window.__phoneCodeImgCache` (Map) and `window.__phoneCodeImgCacheBytes` (counter) initialized once in browser context
- LRU hit path: delete+re-set pattern moves entry to Map tail; sets `img.src` directly
- LRU miss path: fetch → Content-Length check (>500KB skip) → blob.size check → FileReader → evict-to-cap
- Eviction loop removes Map head entries until under 50MB base64 budget
- Silent errors: `catch(e){}` on fetch, `reader.onerror = () => r()` on FileReader — image omitted, no crash, retried next poll
- `t0`/`imgMs` timing wrapper around entire image block
- `stats` return extended with `imgMs`, `imgCached`, `imgTotal`
- `export async function invalidateSnapshotCache(cdp)` added — runs CLEAR_SCRIPT across all contexts; clears img globals and CSS fingerprint globals (null-safe, safe before 05-02)

**server.js**:
- `/switch-target` handler: `prevTargetModule.invalidateSnapshotCache(prevCdp)` called with fire-and-forget `.catch(() => {})` BEFORE `currentTarget = target` assignment

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add image cache to targets/claude.js CAPTURE_SCRIPT | d3c7cf6 | targets/claude.js |
| 2 | Apply identical image cache to targets/antigravity.js | dae01a1 | targets/antigravity.js |
| 3 | Export invalidateSnapshotCache from both targets | b2da6a7 | targets/claude.js, targets/antigravity.js |
| 4 | Call invalidateSnapshotCache on target switch in server.js | eeea83f | server.js |
| 5 | Add imgMs/imgCached/imgTotal timing stats to both targets | b506563 | targets/claude.js, targets/antigravity.js |

---

## Deviations from Plan

None - plan executed exactly as written.

---

## Key Decisions

1. **URL-only cache key** — cache key is `rawSrc` string only. Dynamic images with stable URLs return stale base64 until cache cleared. Acceptable: VS Code/Claude Code images are static icons/logos. Documented in code comment.

2. **50MB base64 cap** — `__phoneCodeImgCacheBytes` tracks base64 string length, not binary size. Base64 is ~33% larger, so effective binary ceiling is ~37MB. Noted in eviction loop comment.

3. **No negative caching** — fetch/FileReader errors omit the image silently. Image retried on next poll. Transient errors self-heal.

4. **CSS globals in CLEAR_SCRIPT** — `__phoneCodeCSSFingerprint` and `__phoneCodeCSSCache` cleared with `!== undefined` guard. No-ops until 05-02 deploys. Avoids needing a second invalidation call after 05-02.

5. **Fire-and-forget invalidation in server.js** — `.catch(() => {})` ensures target switch never blocks on a failed CDP call.

---

## Known Stubs

None. All functionality is wired. The CSS globals in CLEAR_SCRIPT are intentional forward-compatibility stubs for Plan 05-02, guarded with null-safe checks so they have zero runtime impact until 05-02 is deployed.

---

## Self-Check: PASSED

Files verified:
- `targets/claude.js`: FOUND
- `targets/antigravity.js`: FOUND
- `server.js`: FOUND

Commits verified:
- d3c7cf6: FOUND
- dae01a1: FOUND
- b2da6a7: FOUND
- eeea83f: FOUND
- b506563: FOUND
