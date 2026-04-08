---
phase: 5
reviewers: [gemini, claude, codex]
reviewed_at: 2026-04-08T00:00:00Z
plans_reviewed: [05-01-PLAN.md, 05-02-PLAN.md, 05-03-PLAN.md]
---

# Cross-AI Plan Review — Phase 5: Capture Pipeline Optimization

---

## Gemini Review

Chuỗi kế hoạch (05-01 đến 05-03) thể hiện tư duy tối ưu hóa phân lớp rất logic: bắt đầu từ việc giảm tải tài nguyên nặng (hình ảnh), đến giảm tải dữ liệu lặp lại (CSS), và cuối cùng là đóng băng toàn bộ quá trình xử lý khi không có thay đổi (MutationObserver). Việc sử dụng các biến global trong ngữ cảnh trình duyệt (`window.__phoneCode*`) là một giải pháp thực dụng và hiệu quả cho các công cụ dựa trên CDP injection.

**Strengths:**
- Chiến lược LRU (50MB) dựa trên `Map` insertion-order là chuẩn xác, ngăn ngừa memory leak trong phiên dài
- Giảm thiểu băng thông CDP: trả về `null` cho CSS và bỏ qua hoàn toàn trường `css` khi DOM không đổi
- `invalidateSnapshotCache` + gọi nó khi chuyển target đảm bảo trạng thái cache luôn sạch
- Plan 05-03 xử lý tốt detached node (SPA remount) của Antigravity

**Concerns — Plan 05-01:**
- **MEDIUM**: Fingerprint CSS chỉ dựa `ruleCount` có thể bỏ sót trường hợp nội dung file thay đổi nhưng số rule giữ nguyên
- **MEDIUM**: Xử lý ảnh nhiều file gần 500KB đồng thời có thể tốn bộ nhớ tạm lớn

**Concerns — Plan 05-02:**
- **MEDIUM**: `href + ruleCount` bỏ sót trường hợp một CSS rule bị sửa giá trị nhưng không thêm/xóa rule (e.g. CSS variable thay đổi)

**Concerns — Plan 05-03:**
- **MEDIUM**: Scroll staleness — nếu AI tool tự cuộn xuống khi sinh văn bản mới mà không làm thay đổi DOM, điện thoại sẽ không thấy sự thay đổi cho đến khi có mutation tiếp theo
- **MEDIUM**: Bỏ qua hoàn toàn trường `css` thay vì trả `css: null` có thể gây lỗi logic ở handlers cũ mong đợi object cố định
- **LOW**: `window.__phoneCode*` có rủi ro nhỏ trùng tên; nên gom vào `window.__PC_INTERNAL = {...}`

**Suggestions:**
- Thêm `scrollY/scrollX` vào dirty check của 05-03, hoặc cập nhật scrollInfo riêng mà không cần clone DOM
- Dùng `href + ownerNode.textContent.length` thay vì chỉ `ruleCount` cho external sheets
- Thêm Force Refresh button trên mobile UI để gọi `invalidateSnapshotCache` thủ công

**Risk Assessment: LOW** — Thứ tự triển khai đúng (05-01 → 05-02 → 05-03), các thay đổi nằm trong script inject nên failure modes an toàn.

---

## Claude CLI Review (Separate Session)

### Plan 05-01: Image Conversion Cache

**Summary:** A well-scoped plan targeting the largest obvious waste in the current capture path. The browser-context cache fits the existing `Runtime.evaluate` model well and should materially reduce stable-poll latency. The main gaps are cache correctness, failure behavior, and whether target-switch invalidation is being treated as the only lifecycle boundary.

**Strengths:**
- LRU via Map insertion-order delete+re-set is simple and correct for this scale
- 50MB cap + eviction loop prevents unbounded growth
- `invalidateSnapshotCache` on target switch is the right hook point
- Timing stats (imgMs, imgCached, imgTotal) give observable signal for validating the optimization
- The 500KB skip rule is aligned with the phase requirement

**Concerns:**
- **MEDIUM** — No TTL or content-change detection. If a dynamic image URL is stable but content changes (e.g. a live avatar), the cache returns stale base64 indefinitely until full cache clear.
- **MEDIUM** — 50MB cap uses base64 byte length, but base64 is ~33% larger than the source binary. Actual browser memory use per cached image includes both the string AND the decoded bitmap. The effective cap is looser than 50MB in practice.
- **LOW** — Fetch failures inside CAPTURE_SCRIPT: if a fetch throws (network error, CORS), missing images should be omitted without crashing the script.
- **LOW** — Eviction loop is O(n) over all cache entries per insertion. At 50 images this is fine; worth documenting the assumption.
- **LOW** — No mention of whether `invalidateSnapshotCache` is a no-op if the CDP connection is already closed.

**Suggestions:**
- Add `try/catch` around each image fetch; on error, omit that image rather than failing the whole snapshot.
- Document the base64 overhead in the eviction comment so the effective memory ceiling is clear.
- Consider logging a single console warning (once, not per-poll) when the 500KB skip fires.

**Risk Assessment: LOW.** Self-contained browser-side cache with a clear invalidation hook.

---

### Plan 05-02: CSS Collection Cache

**Summary:** Solid plan with one notable correctness gap in the fingerprint strategy for external sheets, and a hard ordering constraint (task 1 before tasks 2–4) that the plan correctly identifies. The null-guard task being listed first but called out only in the "atomic apply" note creates room for implementation error.

**Strengths:**
- Phase 4 server-side hash guard + phase 5 browser-side skip is the right layered approach
- djb2 on inline sheet textContent is lightweight and appropriate
- Calling out the TypeError risk (tasks 2–4 atomic) shows attention to breakage modes
- Pre-condition dependency on 05-01 (shared invalidate path) is correct

**Concerns:**
- **HIGH** — `ruleCount` fingerprint for external sheets is weak. CSS `ruleCount` stays identical when property values change (e.g. a CSS variable redefined via `:root`, a `@media` block content modified). An external sheet reload that changes values without adding/removing rules will be silently ignored. Consider `href + ruleCount + firstRuleText`.
- **MEDIUM** — Fingerprint is per-sheet but the plan doesn't specify how the aggregate "has anything changed" check works. If a new `<style>` tag is injected, does the fingerprint array length change trigger a miss? Must be explicit.
- **MEDIUM** — Task 1 (server null guard) is listed as a prerequisite only via the "atomic apply" note, not as a formal pre-condition. Should state clearly: *task 1 must be deployed before tasks 2–4 go live*.
- **LOW** — djb2 is a weak hash with known collision patterns. Consider FNV-1a for better distribution.

**Suggestions:**
- Upgrade external sheet fingerprint: `href + ruleCount + cssRules[0]?.cssText.slice(0, 64)`
- Make task ordering a numbered pre-condition block (matching 05-01/05-03 style), not an inline note
- Add a fallback: if `sheet.cssRules` throws (cross-origin CORS restriction), skip fingerprinting and always re-collect that sheet

**Risk Assessment: MEDIUM.** The ruleCount-only fingerprint for external sheets can silently serve stale CSS — hard to diagnose in the field.

---

### Plan 05-03: MutationObserver HTML Cache

**Summary:** The most complex plan and well thought-through — the Antigravity container-safety guard and the seq-omission rationale show real attention to edge cases. The main open question is MutationObserver configuration: without specifying `subtree`, `childList`, `attributes`, and `characterData`, the dirty flag behavior is undefined, and a misconfiguration here breaks the entire cache's correctness guarantee.

**Strengths:**
- Dirty flag pattern is the right architecture — avoids polling the DOM to detect DOM changes
- `__phoneCodeObservedEl` reconnect guard for Antigravity SPA remount is a real problem solved correctly
- Omitting `css` field on cache hit (vs returning `css:null`) and handling the two cases distinctly shows careful protocol design
- `stats_update` omitting `seq` is the right call and is explicitly justified
- Scroll staleness trade-off acknowledged

**Concerns:**
- **HIGH** — MutationObserver config is not specified anywhere in the plan. Does it observe `subtree: true`? `attributes: true`? `characterData: true`? Without `subtree: true`, mutations in child nodes won't fire. Without `characterData: true`, text edits won't mark dirty. A wrong config means cache hits when the DOM has actually changed — the worst failure mode for this system.
- **MEDIUM** — First-poll behavior not explicitly stated (always a miss, always capture).
- **MEDIUM** — Task 4 (server stats propagation) and task 5 (client `stats_update` handler) have a deploy-order constraint: task 5 must handle the new message type before task 4 sends it. Not called out explicitly.
- **LOW** — After CLEAR_SCRIPT disconnects the observer, does the next poll re-initialize it? If setup is guarded by `if (!window.__phoneCodeObserver)`, that flag must be in the cleared globals list.
- **LOW** — `updateStatsBar()` extraction is a refactor bundled into a feature task; broadens the diff unnecessarily.

**Suggestions:**
- Specify the exact MutationObserver config object in the plan: `{ subtree: true, childList: true, characterData: true, attributes: true }` (or justify any exclusions explicitly).
- Add explicit first-poll behavior: "if `lastHTML === null`, treat as dirty regardless of observer state."
- Note the task 4→5 deploy order constraint explicitly.
- Confirm that CLEAR_SCRIPT resets the observer initialization guard flag so the next poll re-attaches cleanly.

**Risk Assessment: MEDIUM.** The unspecified MutationObserver config is a HIGH-severity gap that could cause cache hits on actual DOM changes, silently serving stale HTML. Fixable with a one-paragraph amendment before execution.

---

## Codex Review

### Plan 05-01: Image Conversion Cache

**Summary:** Directionally strong and targets the largest obvious waste. A browser-context cache fits the existing `Runtime.evaluate` model. Main gaps are cache correctness, failure behavior, and lifecycle completeness.

**Strengths:**
- Addresses real hotspot in both adapters: repeated `fetch` + `blob` + `FileReader` work
- Uses page-context persistence matching current architecture
- Applies symmetrically to both targets
- Explicit stats validate the optimization
- 500KB skip rule aligned with requirement

**Concerns:**
- **MEDIUM**: Cache key is only `url → base64`. If the same URL serves changed content, stale images persist until invalidation.
- **MEDIUM**: Plan does not say what happens on fetch/read failure. Without negative caching, broken images may be retried every poll forever.
- **MEDIUM**: `invalidateSnapshotCache` only on target switch is incomplete. Page reloads, navigation, iframe/context replacement, CDP reconnects also reset browser globals.
- **LOW**: 50MB LRU in browser memory — no estimate tying cap to expected snapshot sizes.
- **LOW**: "Skip images larger than 500KB" — `blob.size` after full fetch still incurs download cost; `Content-Length` may not exist.

**Suggestions:**
- Use lazy cache initialization inside CAPTURE_SCRIPT; treat server-side invalidation as cleanup, not correctness.
- Define miss/error behavior explicitly: omit failed images without failing the whole capture; consider short-lived negative caching.
- Record whether a skipped image was skipped by size pre-check or post-fetch to make telemetry meaningful.
- Consider keying with `src + currentSrc` or including a lightweight freshness signal.
- State clearly that cache reset is expected on execution-context loss and that this is acceptable.

**Risk Assessment: MEDIUM.** Sound optimization but stale-cache and lifecycle assumptions could produce correctness bugs if not specified.

---

### Plan 05-02: CSS Collection Cache

**Summary:** Attacks another real source of repeated work, but has a serious contract risk. The current `/snapshot` path returns `lastSnapshot` verbatim from memory in server.js. If `lastSnapshot.css` becomes `null`, full reloads in app.js will wipe dynamic CSS — a direct regression on reconnect.

**Strengths:**
- Correctly targets `document.styleSheets` walk + rule concatenation in both adapters
- Fingerprint-before-collect is the right optimization shape
- Calls out the null-guard dependency in target stats logic
- Keeps optimization localized to the adapter boundary

**Concerns:**
- **HIGH**: The proposed server fix is insufficient. "Skip hash update and do not send CSS payload" does not address `/snapshot`, which returns `lastSnapshot` directly from memory in server.js.
- **HIGH**: If `lastSnapshot.css` becomes `null`, full loads in app.js will set the style tag to `''` and wipe dynamic CSS.
- **MEDIUM**: Fingerprint scheme may miss meaningful stylesheet changes. `href + ruleCount` can collide on same-URL, same-count, changed-content cases.
- **MEDIUM**: Inaccessible sheets (cross-origin) — plan does not define whether they contribute to fingerprint. Unstable fingerprint for those sheets.
- **LOW**: CSS caching assumes 05-01 invalidation clears CSS fingerprint too; this coupling is artificial. CSS caching should be independently correct.

**Suggestions:**
- Make the server contract explicit: never persist `css: null` in `lastSnapshot`. Merge new snapshot with previous effective CSS before assigning server state.
- Keep transport semantics consistent: full `/snapshot` always returns concrete effective CSS; diff/broadcast path uses `undefined` for unchanged.
- Strengthen fingerprint: `href + ruleCount + disabled + mediaText` for external sheets.
- Specify behavior for inaccessible cross-origin sheets.
- Treat the double-backslash template literal fix as a separate bugfix, not a hidden dependency.

**Risk Assessment: HIGH.** The `css: null` → `/snapshot` → style wipe regression path is concrete and confirmed by the current code.

---

### Plan 05-03: MutationObserver HTML Cache

**Summary:** The core observer idea is viable and targets the remaining obvious stable-poll cost, but this plan mixes capture optimization with server protocol and client UI changes that are not required to meet the phase goal. It also carries the same `/snapshot` CSS null risk if the server contract is not fixed in 05-02.

**Strengths:**
- Targets the remaining obvious stable-poll cost: unconditional DOM cloning
- Correctly differentiates observer attachment: `document.body` stable in Claude, container may remount in Antigravity
- Includes cache invalidation cleanup including observer disconnect
- Explicitly calls out scroll staleness as an acknowledged trade-off

**Concerns:**
- **HIGH**: This plan expands scope into `server.js` and `public/js/app.js` with `stats_update` and a new UI indicator — not required to achieve the capture optimization goal.
- **HIGH**: Returning cached HTML while omitting `css` entirely is only safe if server-side state preserves prior effective CSS for `/snapshot`. The current `/snapshot` path still returns `lastSnapshot` verbatim.
- **MEDIUM**: `MutationObserver` does not catch scroll-driven viewport changes. For a tool depending on visible chat state and virtualized lists, the "acceptable trade-off" may not hold.
- **MEDIUM**: Browser-side caching of full HTML duplicates a large string already stored server-side as `lastSnapshot`, increasing memory pressure.
- **MEDIUM**: A second WebSocket message type without `seq` creates a side channel beside the existing diff/full sequencing model.
- **LOW**: Observer lifecycle is fragile in SPA UIs. CLEAR_SCRIPT must reset every initialization guard, not just the six listed globals.

**Suggestions:**
- Split into two changes: capture optimization (observer + dirty flag + cached HTML/meta in adapters) vs optional telemetry/UI (`stats_update` + lightning indicator).
- Define strict invalidation triggers: not just target switch, but also context reset, navigation, and observed element replacement.
- Re-evaluate the scroll tradeoff against Antigravity virtualization — if scroll changes visible DOM without mutation, stable-poll cache hits may return stale viewport HTML.
- Keep server semantics simple: preserve previous effective snapshot server-side on cache hit.
- Add explicit memory limits for cached HTML/meta.

**Risk Assessment: HIGH.** Core observer idea is viable but scope creep creates unnecessary surface area, and the CSS/snapshot contract dependency makes it fragile.

---

## Consensus Summary

### Agreed Strengths (2+ reviewers)
- **Layered optimization ordering (images → CSS → DOM)** is correct — all 3 reviewers note the sequencing is well-reasoned
- **Browser-side cache via `Runtime.evaluate` globals** is the right approach for CDP injection architecture
- **LRU at 50MB** is a reasonable safeguard — all 3 note it as appropriate
- **Timing stats (imgMs, cssMs, cached)** make the phase goal measurable — all 3 approve
- **Antigravity detached-node reconnect guard** in 05-03 is well-designed — all 3 note it
- **Plan 05-01 is the lowest-risk, best-scoped plan** — all 3 reviewers agree it should go first

### Agreed Concerns (Highest Priority)

1. **CSS fingerprint weakness for external sheets** — `href + ruleCount` is too weak (all 3 reviewers)
   - Claude CLI: HIGH — ruleCount stays the same when values change inside a rule
   - Codex: MEDIUM — same-URL same-count changed-content collision
   - Gemini: MEDIUM — CSS variable changes won't be detected
   - **Consensus action**: Strengthen to `href + ruleCount + cssRules[0]?.cssText.slice(0, 64)` or similar

2. **`/snapshot` full-reload will clear styles if `css: null` stored in lastSnapshot** (05-02/05-03) — Codex + Claude CLI
   - Both reviewers independently identified the concrete regression: `lastSnapshot.css = null` → client reconnects → `/snapshot` returns null CSS → `styleTag.textContent = ''` → styles wiped
   - Gemini did not model this path
   - **Consensus action**: Server MUST never persist `null` in `lastSnapshot.css`; normalize to prior effective CSS before assigning

3. **URL-only image cache key can serve stale content** (05-01) — Claude CLI + Codex
   - Both note that same URL with changed content (e.g. avatar, chart) returns stale base64 indefinitely
   - Gemini did not raise this
   - **Consensus action**: Document the trade-off explicitly OR add `naturalWidth + naturalHeight` as cheap freshness signal

4. **Scroll staleness on idle polls** (05-03) — Gemini + Codex
   - If desktop scrolls without any DOM mutation, phone viewport stays frozen
   - **Consensus action**: Add `scrollY/scrollX` change check to dirty detection, or document explicitly with a note that scroll-only updates require a DOM mutation to sync

5. **MutationObserver config must be explicitly specified** (05-03) — Claude CLI (HIGH, unique)
   - Missing `subtree: true` = child mutations not caught; missing `characterData: true` = typing not caught
   - A wrong config causes silent cache hits on real DOM changes — worst failure mode
   - **Consensus action**: Add exact config object to plan: `{ subtree: true, childList: true, characterData: true, attributes: true }` (or justify exclusions)

### Divergent Views

| Topic | Gemini | Claude CLI | Codex |
|-------|--------|------------|-------|
| **05-02 overall risk** | LOW-MEDIUM | MEDIUM | **HIGH** |
| **05-03 overall risk** | LOW | MEDIUM | **HIGH** |
| **Scope creep in 05-03** | Positive feature | Low risk, noted | HIGH concern |
| **`/snapshot` CSS null** | Not raised | Implicit | Central HIGH concern |
| **MutationObserver config** | Not raised | **HIGH gap** | Not raised |
| **Negative caching for failures** | Not raised | LOW note | MEDIUM concern |

**Where to focus**: Codex's `/snapshot` null-CSS regression is the highest-consequence divergence — Gemini missed it, Claude CLI partially noted it. Codex's analysis is confirmed by reading the actual code paths referenced. **Treat this as HIGH.**

---

*To incorporate this feedback into planning:*
```
/gsd:plan-phase 5 --reviews
```
