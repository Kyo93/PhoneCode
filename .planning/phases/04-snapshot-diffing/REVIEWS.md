# Phase 4 Reviews: Snapshot Diffing

**Reviewed**: 2026-04-08  
**Plans**: 04-01 (Server-Side Diff), 04-02 (Client-Side Patch Apply)  
**Reviewers**: Gemini 2.5 Pro, Claude Opus 4.5

---

## Gemini 2.5 Pro

**VERDICT: APPROVE_WITH_CONCERNS**

### Key Concerns
- **Server Performance:** Using `jsdom` to parse up to 2MB of HTML from a string on every 1-second poll is a critical performance bottleneck. This will likely lead to high server CPU usage and polling latency.
- **Diff Size Unpredictability:** The ≤20KB target is ambitious. If the source application re-renders large container elements instead of making small, targeted changes, the resulting diff will be large, frequently forcing a fallback to a full snapshot.
- **CSS Handling:** The plan includes sending `css` with every diff, but doesn't specify if this is the full CSS content. If so, it could easily negate the bandwidth savings from the DOM diff.
- **Fallback Threshold:** The 80% threshold is arbitrary. A large diff that is still smaller than a full snapshot (e.g., 81% of 2MB) is still a win that would be missed. The network overhead of a new HTTP request vs. a larger WebSocket message should be considered.

### Specific Suggestions
- **Mitigate `jsdom` Overhead:** Keep the `jsdom` document object of the previous snapshot in memory between polls. This halves the parsing work by only needing to parse the new HTML string. Profile this approach; if still too slow, a more fundamental change is needed.
- **Refine Fallback Logic:** Make the 80% threshold configurable. Add logging to compare `diff_size` vs. `full_html_size`. Consider a fixed size cap (e.g., `>250KB`) as part of the heuristic.
- **Improve Client Robustness:** Ensure `dd.apply()` is wrapped in `try...catch`. On failure, log the diff that caused the error before triggering resync.
- **Clarify CSS Strategy:** CSS should not be sent in full with every diff. Send it only when it has actually changed, independent of the HTML snapshot.

---

## Claude Opus 4.5

**VERDICT: APPROVE_WITH_CONCERNS**

### Key Concerns
1. **jsdom performance is a blocker** — Parsing 500KB-2MB HTML every 1s poll will introduce significant latency and CPU overhead. jsdom is heavy. Switch to `linkedom` (10-50x faster) or cache the previous parsed DOM tree instead of re-parsing.
2. **80% threshold defeats the goal** — 80% of 1MB = 800KB. You want 20KB max. Threshold should be absolute: `if (diffBytes < 30KB) sendDiff else sendFull`. Percentage-based logic doesn't track with fixed bandwidth targets.
3. **CSS sent in full every diff** — Plan mentions `{diff, css, seq}` but CSS isn't diffed. If CSS is large or changes often, you'll miss your target. Either diff CSS separately or omit if unchanged.
4. **Partial apply corruption** — If `dd.apply()` throws mid-application, the DOM is in an inconsistent state. The fallback triggers after partial corruption. Need to either clone before apply or accept full resync as recovery.
5. **No measurement instrumentation** — Plan logs `diffStats` but not specific enough. Add: `{fullBytes, diffBytes, reduction%, seq, latencyMs}` to know if you're hitting 20KB and to tune thresholds.

### Suggestions
- Replace jsdom with `linkedom` — same API, dramatically faster
- Change threshold: `diffBytes < 30000 && diffBytes < fullBytes * 0.5`
- Add hash check for CSS — only include if changed
- Wrap `dd.apply()` in try/catch that triggers full resync, log the failure for debugging
- Add client-side telemetry to report actual received sizes back to server

Architecture is sound. These are implementation-level fixes, not redesign.

---

## Synthesis: Shared Issues (Both Reviewers Agree)

| Issue | Severity | Fix |
|-------|----------|-----|
| `jsdom` too slow for 1s poll | **Critical** | Replace with `linkedom` or cache prev DOM tree |
| CSS sent in full every diff | **High** | Only include CSS if hash changed vs last sent CSS |
| 80% threshold wrong | **High** | Use absolute: `diffBytes < 30_000` |
| `dd.apply()` partial corruption | **Medium** | Clone DOM before apply, or accept resync as recovery |
| Insufficient diff logging | **Low** | Log `{fullBytes, diffBytes, reduction%, latencyMs}` |

---

---

## Round 2 Review — v2 Plans (post-fix)

**Reviewed**: 2026-04-08  
**Plans**: 04-01 v2 (linkedom, 30KB threshold, CSS hash), 04-02 v2 (DOM clone rollback)

### Gemini 2.5 Pro — **APPROVE**
- linkedom `parseHTML` API confirmed correct; diff-dom compatible
- Rollback edge case: use null-check on `parentNode` before `replaceChild` (low risk but cheap fix)
- CSS `undefined` protocol (JSON.stringify drops key, client checks `data.css !== undefined`) is clean
- DOM cache invalidation on target switch and 30KB cap are the right calls

### Claude Opus 4.5 — **APPROVE_WITH_CONCERNS**
- Same rollback edge case: `if (chatContent.parentNode)` guard required — `dd.apply()` may detach element before throwing
- linkedom + server-side DOM caching is solid performance improvement
- Protocol is robust; absolute threshold + full-fetch fallback is safe design

### Fix Applied
- `chatContent.parentNode.replaceChild(...)` now guarded with `if (chatContent.parentNode)` in 04-02 Task 5

### Final Status: **APPROVED — ready for `/gsd:execute-phase 4`**


These changes should be applied to the plans before execution (via `/gsd:plan-phase 4 --reviews`):

1. **Plan 04-01 Task 1**: `npm install diff-dom linkedom` (replace `jsdom` with `linkedom`)
2. **Plan 04-01 Task 2**: Use `linkedom` import instead of `jsdom`; cache previous snapshot's parsed DOM in memory
3. **Plan 04-01 Task 4**: Change threshold to `result.sizeBytes < 30_000` (absolute cap); CSS: only include in message if CSS hash changed vs `lastBroadcastCssHash`
4. **Plan 04-01 Task 6**: Log `{fullBytes, diffBytes, reduction: Math.round((1 - diffBytes/fullBytes)*100), seq, latencyMs}`
5. **Plan 04-02 Task 5**: Clone `chatContent` before `dd.apply()` as rollback snapshot; on throw, restore clone + trigger resync
