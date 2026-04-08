---
phase: 05-capture-optimization
verified: 2026-04-08T10:00:00Z
status: gaps_found
score: 12/14 must-haves verified
gaps:
  - truth: "Server never stores css:null in lastSnapshot — GET /snapshot always returns concrete CSS"
    status: partial
    reason: >
      effectiveCSS guard uses `snapshot.css !== null` but does not catch `snapshot.css === undefined`.
      Plan 05-03's MutationObserver early return deliberately omits the css field entirely (the returned
      object has no css property), so snapshot.css is undefined — not null. After a server restart while
      the browser tab keeps its globals, the first poll returns a full MutationObserver cache hit with
      snapshot.css = undefined. Because undefined !== null is true, effectiveCSS = undefined instead of
      the prior lastSnapshot.css. Result: lastSnapshot.css = undefined, and GET /snapshot returns
      { css: undefined } to new clients — no styles injected, visual regression.
    artifacts:
      - path: "server.js"
        issue: "Line 1412: `snapshot.css !== null` passes undefined through. Should be `snapshot.css != null`
          or `snapshot.css ?? (lastSnapshot?.css ?? '')`"
    missing:
      - "Change effectiveCSS guard from `snapshot.css !== null` to `snapshot.css != null` (catches both
        null and undefined) in the polling loop at server.js line 1412"

  - truth: "Cache cleared when CDP context resets or page navigates (REQ-06 criterion 5)"
    status: failed
    reason: >
      invalidateSnapshotCache() is called only on target switch (in /switch-target handler). It is NOT
      called on CDP WebSocket reconnect. In initCDP() and the startPolling() reconnect path, after
      cdpConnections.set() is called with the new connection, no call is made to clear browser-side
      globals. This means after a server restart (which involves CDP reconnection), the browser's
      window.__phoneCodeImgCache, window.__phoneCodeCSSFingerprint, window.__phoneCodeObserver, and
      window.__phoneCodeLastHTML etc. retain their values from the previous server session. This is the
      root cause of the effectiveCSS undefined bug above.
    artifacts:
      - path: "server.js"
        issue: "initCDP() (lines 1327-1355) and the poll() reconnect block (lines 1384-1390) do not call
          invalidateSnapshotCache() after establishing a new CDP connection"
    missing:
      - "In initCDP(), after each successful cdpConnections.set() call, call
        TARGETS[targetKey].invalidateSnapshotCache(conn).catch(() => {}) to clear stale browser globals
        before the first poll of the reconnected session"
human_verification:
  - test: "Verify snapshot capture time <200ms on stable DOM polls"
    expected: "Server log shows imgMs near 0, cssMs near 0, and stats.cached=true on second+ poll with no DOM changes"
    why_human: "Cannot measure CDP round-trip time programmatically without running the server"
  - test: "Verify no visual regression — snapshots render images and correct CSS after cache hits"
    expected: "Mobile iframe shows correct styles and all icons/images on both fresh and cached polls"
    why_human: "Visual rendering requires human inspection of the mobile client output"
  - test: "Confirm server restart scenario causes visible style breakage (to validate the gap is real)"
    expected: "After server restart with browser tab open, connecting mobile client sees unstyled content
      until next HTML mutation triggers full capture with real CSS"
    why_human: "Requires manual server restart and client connection observation"
---

# Phase 5: Capture Pipeline Optimization — Verification Report

**Phase Goal:** Eliminate redundant work inside captureSnapshot() — images are re-fetched and CSS re-collected on every poll even when unchanged. Persistent browser-side caches skip already-processed data on repeat polls.
**Verified:** 2026-04-08
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Images cached from a prior poll are not re-fetched or re-converted | ✓ VERIFIED | `imgCache.has(rawSrc)` cache hit path in both targets (claude.js:128-134, antigravity.js:156-162) |
| 2  | Images >500KB are skipped without crashing the snapshot | ✓ VERIFIED | Content-Length + blob.size dual checks in both targets; `catch(e){}` error handling |
| 3  | Browser-side image cache cleared on target switch | ✓ VERIFIED | server.js:2049-2055 calls `prevTargetModule.invalidateSnapshotCache(prevCdp)` BEFORE `currentTarget = target` |
| 4  | Stats include imgMs and imgCached for optimization observability | ✓ VERIFIED | `imgMs`, `imgCached`, `imgTotal` in stats return object of both targets |
| 5  | CSS not re-collected when stylesheet fingerprint matches previous poll | ✓ VERIFIED | `cssFingerprint === window.__phoneCodeCSSFingerprint && window.__phoneCodeCSSCache` → `allCSS = null` in both targets |
| 6  | External sheet fingerprint includes first-rule content sample | ✓ VERIFIED | `s.cssRules[0].cssText.slice(0, 64)` in fingerprint reduce (claude.js:184, antigravity.js:233) |
| 7  | Server never stores css:null in lastSnapshot | ✗ PARTIAL | Guard uses `!== null` but NOT `!== undefined`; full MutationObserver cache hit returns snapshot.css=undefined, not null; passes through guard incorrectly |
| 8  | Reconnecting clients receive correct styles | ✗ PARTIAL | Depends on truth 7; after server restart, `lastSnapshot.css = undefined` reaches GET /snapshot |
| 9  | Stats show cssCached:true and near-zero cssMs on CSS cache hits | ✓ VERIFIED | `cssMs`, `cssCached: allCSS === null` in stats object; `tCss0` timing wrapper present |
| 10 | DOM clone skipped when MutationObserver reports no changes since last poll | ✓ VERIFIED | Early return at claude.js:66-75, antigravity.js:72-78 — returns before `cascade.cloneNode(true)` |
| 11 | MutationObserver config covers subtree, childList, characterData, and attributes | ✓ VERIFIED | All 4 options present in both targets; claude.js:56-61, antigravity.js:61-66 |
| 12 | First poll always performs full capture regardless of observer state | ✓ VERIFIED | `window.__phoneCodeLastHTML = null` on init makes early-return condition falsy on first poll |
| 13 | Cache cleared on target switch — observer disconnected and all globals reset | ✓ VERIFIED | CLEAR_SCRIPT in both targets clears 9 globals: imgCache, imgCacheBytes, CSSFingerprint, CSSCache, Observer (disconnect+null), ObservedEl, MutDirty, LastHTML, LastMeta |
| 14 | Stats bar shows lightning indicator on cache hits; no indicator during streaming | ✓ VERIFIED | `updateStatsBar()` in app.js:445-452; `stats.cached ? ' · ⚡' : ''`; `stats_update` handler at app.js:419-422 |

**Score:** 12/14 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `targets/claude.js` | LRU image cache inside CAPTURE_SCRIPT | ✓ VERIFIED | `window.__phoneCodeImgCache` Map, LRU delete+re-set, 50MB cap, eviction loop |
| `targets/antigravity.js` | LRU image cache inside CAPTURE_SCRIPT | ✓ VERIFIED | Identical image cache logic confirmed |
| `targets/claude.js` | `invalidateSnapshotCache` export | ✓ VERIFIED | Lines 282-310; CLEAR_SCRIPT clears all 9 globals |
| `targets/antigravity.js` | `invalidateSnapshotCache` export | ✓ VERIFIED | Lines 315-343; identical CLEAR_SCRIPT |
| `targets/claude.js` | CSS fingerprint cache | ✓ VERIFIED | `window.__phoneCodeCSSFingerprint` + `window.__phoneCodeCSSCache`; firstRule sample |
| `targets/antigravity.js` | CSS fingerprint cache | ✓ VERIFIED | Same fingerprint logic; blocked sheet handling |
| `targets/claude.js` | MutationObserver + HTML cache | ✓ VERIFIED | `window.__phoneCodeObserver`; subtree+childList+characterData+attributes |
| `targets/antigravity.js` | MutationObserver with reconnect guard | ✓ VERIFIED | `window.__phoneCodeObservedEl?.isConnected` guard at antigravity.js:51-53 |
| `server.js` | effectiveCSS null guard | ✗ PARTIAL | Guard at line 1412 catches `null` but not `undefined`; Plan 05-03 early return emits `css: undefined` |
| `server.js` | `stats_update` WS broadcast on cache hits | ✓ VERIFIED | Lines 1470-1480; `snapshot?.stats?.cached && lastSnapshot` condition |
| `public/js/app.js` | `updateStatsBar` function with `⚡` indicator | ✓ VERIFIED | `function updateStatsBar(stats)` at line 445; `|| 0` guards; `cacheIndicator` |
| `public/js/app.js` | `stats_update` WS message handler | ✓ VERIFIED | Lines 419-422 in `ws.onmessage` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server.js /switch-target` | `targets/*/invalidateSnapshotCache` | `prevTargetModule.invalidateSnapshotCache(prevCdp)` | ✓ WIRED | Correct order: called before `currentTarget = target` (lines 2049-2057) |
| `targets/claude.js MutationObserver callback` | `window.__phoneCodeMutDirty` | `() => { window.__phoneCodeMutDirty = true }` | ✓ WIRED | Observer callback sets dirty flag; confirmed at lines 53-55 |
| `server.js poll loop` | `wss.clients` | `stats_update` JSON on cache hit | ✓ WIRED | Lines 1470-1479; `snapshot.stats.cached` condition present |
| `app.js ws.onmessage` | `updateStatsBar` | `data.type === 'stats_update'` | ✓ WIRED | Lines 419-422; calls `updateStatsBar(data.stats)` |
| `targets/claude.js CAPTURE_SCRIPT` | `window.__phoneCodeCSSFingerprint` | `cssFingerprint === window.__phoneCodeCSSFingerprint` | ✓ WIRED | Lines 203-205; `allCSS = null` on fingerprint match |
| `server.js poll loop` | `lastSnapshot` | `effectiveCSS` normalization | ✗ PARTIAL | Guard handles `null` but passes `undefined` through; Plan 05-03 cache hits produce `undefined` not `null` |
| `initCDP()` | `invalidateSnapshotCache` | after CDP reconnect | ✗ NOT WIRED | `initCDP()` (lines 1327-1355) does not call `invalidateSnapshotCache` — stale browser globals persist across server restart |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `targets/claude.js` CAPTURE_SCRIPT | `imgCache` | `window.__phoneCodeImgCache` (persists across CDP calls) | Yes | ✓ FLOWING |
| `targets/claude.js` CAPTURE_SCRIPT | `allCSS` | CSS fingerprint check → `null` on cache hit, collected on miss | Yes | ✓ FLOWING |
| `targets/claude.js` CAPTURE_SCRIPT | early-return `html` | `window.__phoneCodeLastHTML` (stored on prior full capture) | Yes — but css field absent | ✓ FLOWING (css field deliberately absent) |
| `server.js` `effectiveCSS` | CSS text for broadcast | `snapshot.css` or `lastSnapshot.css` fallback | Partial — undefined passes guard | ⚠️ STATIC (on server restart with stale browser globals) |
| `app.js` `updateStatsBar` | `stats.cached` | `stats_update` WS message or `loadSnapshot()` data | Yes | ✓ FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED (no runnable entry points without starting server and browser target)

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REQ-06 AC1 | 05-01, 05-02, 05-03 | Image cache stores url→base64 across polls | ✓ SATISFIED | `window.__phoneCodeImgCache` Map in both targets |
| REQ-06 AC2 | 05-01 | Images >500KB skipped | ✓ SATISFIED | Content-Length + blob.size dual guard in both targets |
| REQ-06 AC3 | 05-02 | CSS fingerprint check; returns null; server uses cached value | ✓ SATISFIED | `window.__phoneCodeCSSFingerprint` + `effectiveCSS` normalization |
| REQ-06 AC4 | 05-01, 05-02, 05-03 | Snapshot latency <200ms on stable polls | ? NEEDS HUMAN | Architecture correct (early return before cloneNode); cannot measure without live server |
| REQ-06 AC5 | 05-01, 05-03 | Cache invalidated on CDP context reset | ✗ NOT SATISFIED | `invalidateSnapshotCache()` called on target switch only; NOT called on CDP WebSocket reconnect in `initCDP()` |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `server.js` | 1412 | `snapshot.css !== null` — strict null check misses `undefined` | 🛑 Blocker | Plan 05-03 MutationObserver cache hit returns object with no `css` field (undefined). Guard evaluates `undefined !== null` as `true`, so `effectiveCSS = undefined`. On server restart with stale browser globals, `lastSnapshot.css = undefined` — new clients receive no CSS, styles broken. |
| `server.js` | 1327-1355 | `initCDP()` does not call `invalidateSnapshotCache` after `cdpConnections.set()` | 🛑 Blocker | After server restart (CDP reconnect), stale browser globals persist. MutationObserver early return activates on first poll, returning `css: undefined`. This is the root cause that enables the effectiveCSS guard failure. |

**Stub classification note:** The `snapshot.css !== null` check was correct for Plan 05-02 (where browser signals cache hit with `null`). Plan 05-03 introduced a second cache hit signal (absent `css` field = `undefined`) that Plan 05-02's guard was not updated to handle. This is a cross-plan integration gap.

---

### Human Verification Required

#### 1. Snapshot Capture Time Under 200ms

**Test:** Start server, open mobile client, let a page stabilize (no AI response in progress), observe server console log for at least 3 consecutive polls  
**Expected:** Server log shows `cached: true` and `imgMs: ~0ms, cssMs: ~0ms` on polls 2+ with no DOM changes; overall capture latency well under 200ms  
**Why human:** CDP round-trip time cannot be measured without running the live server and browser target

#### 2. Visual Regression Check (CSS + Images)

**Test:** Use mobile client on both claude and antigravity targets, observe rendering on initial load (cold cache) and after several idle polls (warm cache)  
**Expected:** Icons, logos, and all UI images visible and correct on both polls; page styles match desktop appearance; no unstyled sections  
**Why human:** Visual rendering correctness requires human inspection of the mobile iframe

#### 3. Server Restart Bug Confirmation

**Test:** Start server, open mobile client on claude or antigravity, let it poll for 30 seconds (DOM stable), then restart the server without closing the browser tab, immediately connect a new mobile client  
**Expected (with current code):** New mobile client shows unstyled content — `css: undefined` in GET /snapshot; existing mobile client may retain styles (stale style tag content)  
**Expected (after fix):** `initCDP()` calls `invalidateSnapshotCache`, browser globals cleared, first poll does full capture with real CSS, new client gets correct styles  
**Why human:** Requires manual server restart and simultaneous client connection

---

### Gaps Summary

Two related gaps prevent full goal achievement:

**Gap 1 (mechanism): `effectiveCSS` guard at `server.js` line 1412 uses strict `!== null` instead of loose `!= null`.** Plan 05-03's MutationObserver full cache hit deliberately omits the `css` field from the returned object (per the design comment "Omit css field entirely on cache hits"). This means `snapshot.css === undefined` on MutationObserver cache hits, not `null`. The server's null-CSS guard correctly handles `null` (from CSS fingerprint cache hit), but it passes `undefined` through as if it were valid CSS. When the guard runs during the first poll after server restart (where the browser has stale MutationObserver globals), `effectiveCSS = undefined`, `lastSnapshot.css = undefined`, and new clients receive `{ css: undefined }` — no styles.

**Gap 2 (root cause): `initCDP()` does not call `invalidateSnapshotCache()` on CDP reconnect.** REQ-06 acceptance criterion 5 explicitly requires cache invalidation on CDP context reset. The plans add `invalidateSnapshotCache()` to both targets and wire it to target switch — but not to CDP reconnect. After a server restart (or any CDP WebSocket drop-and-reconnect), the browser's persistent globals (`window.__phoneCodeImgCache`, `window.__phoneCodeCSSFingerprint`, `window.__phoneCodeObserver`, `window.__phoneCodeLastHTML`, etc.) retain values from the previous server session. The only protection is the MutationObserver reconnect guard for Antigravity SPA navigation — which does not cover server restarts.

The two gaps compound: Gap 2 leaves stale browser globals after reconnect; Gap 1 means those stale globals produce `undefined` CSS that bypasses the null guard.

**All 14 plan-level truths are verified for normal operation (target switch, continuous server run, SPA navigation).** The gaps only manifest in the specific scenario of server restart with an open, previously-polled browser tab. In that scenario, a newly connecting mobile client will receive no CSS until the next full HTML+CSS capture (triggered by a DOM mutation or fingerprint change).

---

_Verified: 2026-04-08T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
