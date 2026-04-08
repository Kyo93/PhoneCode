---
phase: 5
reviewers: [gemini, codex]
reviewed_at: 2026-04-08T00:00:00Z
plans_reviewed: [05-01-PLAN.md, 05-02-PLAN.md, 05-03-PLAN.md]
---

# Cross-AI Plan Review — Phase 5: Capture Pipeline Optimization

## Gemini Review

Chào bạn, tôi là Gemini CLI. Dưới đây là phần đánh giá chi tiết cho các kế hoạch thực thi thuộc **Phase 5: Capture Pipeline Optimization**.

### Tổng quan

Chuỗi kế hoạch (05-01 đến 05-03) thể hiện tư duy tối ưu hóa phân lớp rất tốt: bắt đầu từ tài nguyên nặng nhất (Hình ảnh), đến tài nguyên lặp lại nhiều nhất (CSS), và cuối cùng là cấu trúc nền tảng (DOM). Việc sử dụng cơ chế cache phía trình duyệt thông qua `Runtime.evaluate` là hướng đi chính xác để giảm tải băng thông CDP và CPU. Tuy nhiên, cần lưu ý đặc biệt đến vấn đề đồng bộ hóa trạng thái cuộn (scroll) và quản lý bộ nhớ dài hạn.

### Plan 05-01: Image Conversion Cache

**Strengths:**
- Cơ chế LRU dựa trên thứ tự insertion của `Map` trong JS là giải pháp thông minh và hiệu quả.
- Giới hạn 500KB cho mỗi ảnh giúp tránh treo trình duyệt khi xử lý các file quá lớn.
- Việc thống kê `imgMs`, `imgCached` giúp định lượng chính xác hiệu quả tối ưu hóa.

**Concerns:**
- **MEDIUM**: Việc xử lý ảnh có thể gây tốn bộ nhớ tạm thời rất lớn nếu có nhiều ảnh dung lượng gần 500KB được xử lý cùng lúc trước khi vào cache.
- **LOW**: Cơ chế `delete + set` để cập nhật LRU hoạt động tốt nhưng cần đảm bảo không có race condition nếu `captureSnapshot` được gọi quá dồn dập (thường không xảy ra với polling 1s).

**Risk Assessment: LOW-MEDIUM**

### Plan 05-02: CSS Collection Cache

**Strengths:**
- Xử lý được vấn đề dư thừa dữ liệu (thường là hàng trăm KB văn bản lặp lại).
- Kết hợp tốt với Plan 05-01 thông qua hàm xóa cache chung.
- Phân biệt đối xử giữa external sheet (href + count) và inline sheet (hash) là cách tiếp cận cân bằng giữa hiệu suất và độ chính xác.

**Concerns:**
- **MEDIUM**: Fingerprint dựa trên `ruleCount` cho external stylesheets có thể bỏ sót trường hợp một rule bị sửa đổi nội dung thuộc tính (property) nhưng không thay đổi số lượng rule. Tuy nhiên, với các công cụ AI chat, CSS thường ít thay đổi kiểu này.

**Risk Assessment: LOW-MEDIUM**

### Plan 05-03: MutationObserver HTML Cache

**Strengths:**
- Đây là "cú hích" lớn nhất về hiệu năng vì bỏ qua được thao tác `cloneNode(true)` và tuần tự hóa HTML nặng nề.
- Xử lý thông minh vấn đề "detached node" trong `antigravity.js` bằng cách theo dõi phần tử container.
- Cơ chế `stats_update` riêng biệt giúp UI vẫn phản hồi mượt mà mà không làm loạn số sequence của client.

**Concerns:**
- **HIGH**: **Vấn đề Scroll.** `MutationObserver` không bắt được sự kiện cuộn. Trong một công cụ "mirroring", nếu người dùng cuộn trang trên máy tính, điện thoại sẽ bị "khựng" cho đến khi có một tin nhắn mới hoặc thay đổi DOM nào đó xảy ra. Điều này làm giảm trải nghiệm "real-time viewport".
- **MEDIUM**: Việc bỏ qua trường `css` hoàn toàn thay vì trả về `css: null` trong cache hit có thể gây ra lỗi logic ở các hàm xử lý snapshot cũ nếu chúng mong đợi cấu trúc object cố định.

**Suggestions:**
1. Thêm kiểm tra nhanh `window.scrollY` / `window.scrollX` vào cơ chế kiểm tra `dirty`. Nếu vị trí cuộn thay đổi, đánh dấu dirty hoặc cập nhật scrollInfo trong payload mà không cần clone lại DOM.
2. Với external sheets, kết hợp thêm `sheet.ownerNode.outerHTML` vào fingerprint để tăng độ chính xác (Plan 05-02).
3. Trong `CLEAR_SCRIPT`, đặt các biến global về `null` để hỗ trợ Garbage Collection tốt hơn.
4. Thêm kiểm tra dung lượng thực tế của cache định kỳ vì 50MB string UTF-16 chiếm RAM thực tế lớn hơn.

**Risk Assessment: MEDIUM**

---

## Codex Review

### Plan 05-01: Image Conversion Cache

**Summary:** This plan is directionally correct and likely to remove the biggest obvious waste in `captureSnapshot()`: repeated `fetch` + `FileReader` work for unchanged local images in both adapters. The use of a persistent browser-side cache matches how `Runtime.evaluate` is being used today. The main gaps are around stale-cache correctness, large-image handling, and ensuring skipped or failed images do not keep getting retried every poll.

**Strengths:**
- Uses page-context persistence, which fits the current `captureSnapshot()` model in targets/claude.js and targets/antigravity.js.
- Keeps the target-specific adapter pattern intact instead of pushing CDP-specific logic into the server.
- LRU eviction is a reasonable safeguard against unbounded browser memory growth.
- Adds timing counters, which makes the phase goal measurable instead of anecdotal.
- Explicit cache clear support is good for long-lived sessions.

**Concerns:**
- **HIGH**: Keying only by URL can serve stale image data if the same URL is reused with different content. That is common with app-local asset paths and editor-generated image URLs.
- **HIGH**: "Skip images larger than 500KB" does not help stable-poll latency if size is only known after `fetch()` + `blob()`. The expensive network/read still happens.
- **HIGH**: The plan does not mention negative-caching skipped or failed images. Without that, oversized/broken images will still be re-fetched every poll.
- **MEDIUM**: A 50MB cap based on base64 string length understates actual JS heap use. Strings are typically more expensive than raw bytes.
- **MEDIUM**: `invalidateSnapshotCache` only on target switch is incomplete. Reconnects, page reloads, or execution-context changes also matter, though lazy re-init will usually cover correctness.
- **LOW**: Retaining base64 image data in page globals increases lifetime of potentially sensitive local content.

**Suggestions:**
- Cache three states, not just success: `ok`, `oversize`, and `failed`, so repeat polls skip all known outcomes.
- Check `Content-Length` before reading the body when available; if absent, fall back to blob-size check.
- Include a cheap freshness signal in the cache key or entry, such as `src + naturalWidth + naturalHeight`, or at minimum document the stale-URL tradeoff explicitly.
- Track cache size using an approximate heap cost, not raw blob bytes.
- Make cache init lazy inside `CAPTURE_SCRIPT`; do not rely on switch-time invalidation for correctness.
- Add a timeout or abort path around image fetches so one slow asset cannot dominate snapshot latency.

**Risk Assessment: MEDIUM**

---

### Plan 05-02: CSS Collection Cache

**Summary:** This plan targets a real bottleneck, but it has a more serious correctness gap than 05-01. The current server only treats HTML changes as snapshot changes, and the current full-snapshot client path assumes `/snapshot` returns actual CSS text. Returning `css: null` from the browser is therefore not enough by itself; the server must normalize snapshot state or full reloads will clear styles, and CSS-only changes may still never propagate.

**Strengths:**
- Correctly identifies that Phase 4's server-side CSS hash guard does not remove browser-side CSS collection cost.
- Separates the fingerprint decision from the expensive rule concatenation, which is the right optimization shape.
- Calls out the `allCSS.length` nullability bug in advance.
- Keeps the adapter-local implementation consistent with the existing target structure.

**Concerns:**
- **HIGH**: The proposed fingerprint for external sheets (`href + ruleCount`) is too weak. CSS can change while both values stay the same, producing stale styles indefinitely.
- **HIGH**: The current poll loop hashes only `snapshot.html` in server.js. A pure CSS change will not increment `snapshotSeq` or broadcast anything.
- **HIGH**: `/snapshot` currently returns `lastSnapshot` as-is. If `lastSnapshot.css` becomes `null`, the full-load path in app.js will clear the injected CSS.
- **MEDIUM**: "Server uses last cached value" is not described concretely enough. That state must live server-side, not just in the browser cache, because clients can reconnect or force-refresh.
- **MEDIUM**: Inline-sheet hashing via `textContent` may miss runtime stylesheet mutations done through CSSOM rather than DOM text updates.
- **LOW**: The plan mixes an escaping-bug fix into the caching change, which increases change surface.

**Suggestions:**
- Do not store `css: null` in `lastSnapshot`. Normalize on the server so the effective snapshot always has concrete CSS for `/snapshot`.
- Separate two concepts: browser return contract (`cssChanged: false` or `css: undefined`) vs server stored snapshot (always keep effective CSS text for full reloads).
- Change detection in the server from `hash(html)` to `hash(html + cssFingerprint)` or equivalent so CSS-only changes can publish.
- Strengthen the fingerprint. For accessible same-origin stylesheets, hash rule text or a representative digest, not just `href + ruleCount`.
- Apply the null/undefined contract consistently across both full snapshot and diff paths before shipping.

**Risk Assessment: HIGH**

---

### Plan 05-03: MutationObserver HTML Cache

**Summary:** This plan can reduce stable-poll cost further, but it is substantially riskier and broader than the other two. It does not just optimize capture; it changes server state handling, WebSocket message types, and client UI telemetry in one step. The observer-based approach is plausible, but it will be noisy on real AI tool DOMs unless filtered carefully, and the current plan still has the same "full snapshot must carry effective CSS" issue if cached hits omit the field entirely.

**Strengths:**
- Uses the right primitive for DOM-change detection instead of repeatedly cloning and hashing unchanged markup.
- Recognizes the target-specific difference between Claude's stable root and Antigravity's remount-prone container.
- Includes invalidation/cleanup for observer globals, which is necessary for long-lived sessions.
- Calls out the scroll staleness tradeoff explicitly instead of hiding it.

**Concerns:**
- **HIGH**: Returning cached HTML while omitting `css` entirely is unsafe unless the server preserves prior effective CSS in `lastSnapshot`. Otherwise `/snapshot` full reloads can still clear styles.
- **HIGH**: The observer will likely fire constantly on transient mutations: cursor state, streaming tokens, tooltips, selection changes, hidden panel churn, etc. Without filtering, cache hit rate may be poor.
- **HIGH**: This plan expands scope into transport and UI (`stats_update`, stats bar indicator). That is not required to achieve the phase goal and raises rollout risk.
- **MEDIUM**: `MutationObserver` does not capture all user-visible changes. Canvas, media frames, some form state, layout-only changes, and stylesheet changes can bypass it.
- **MEDIUM**: Caching full HTML and meta in browser globals duplicates large strings in memory on top of server-side `lastSnapshot`.
- **MEDIUM**: A `stats_update` message with no `seq` creates a second live-update channel beside the existing diff/full protocol, which increases client complexity.
- **LOW**: The plan depends on 05-01/05-02, but also inherits their contract problems if those are not fixed first.

**Suggestions:**
- Split this into two changes: capture optimization (observer + cached HTML/meta) vs telemetry/UI (`stats_update` and lightning indicator).
- Keep `/snapshot` semantics stable: server-side stored snapshot should always contain effective HTML and CSS, even if the browser reports a cache hit.
- Filter observer inputs aggressively: prefer `childList`, `subtree`, and targeted `characterData`; avoid broad attribute observation unless there is evidence it is needed.
- Add a fallback periodic full recapture, even on "clean" polls, to protect against observer blind spots.
- Measure observer hit rate before adding UI plumbing. If hits are rare, the extra protocol work is not justified.
- Re-evaluate whether this plan is needed to hit `<200ms stable poll` after 05-01 and 05-02 are implemented correctly.

**Risk Assessment: HIGH**

---

## Consensus Summary

### Agreed Strengths
- **Layered optimization ordering is correct** (images → CSS → DOM) — both reviewers note the sequencing is well-reasoned.
- **Browser-side cache via `Runtime.evaluate` globals is the right approach** — fits the existing CDP model cleanly.
- **Timing stats (imgMs, cssMs, cached)** are valuable for measuring phase success and both reviewers approve.
- **Antigravity detached-node handling** (container replacement guard in 05-03) was noted as well-designed by both.
- **Plan 05-01 is the strongest plan** — both reviewers rate it as the most ready for implementation.

### Agreed Concerns (Highest Priority)

1. **CSS fingerprint weakness** (05-02 — raised by both):
   - Codex: HIGH — `href + ruleCount` too weak, CSSOM changes not detected
   - Gemini: MEDIUM — ruleCount may miss in-place rule mutations
   - **Consensus action**: Strengthen fingerprint or at minimum document the limitation as acceptable for static AI chat UIs.

2. **`/snapshot` full-reload will clear styles if `css: null` stored in lastSnapshot** (05-02/05-03):
   - Codex: HIGH — server must normalize so lastSnapshot always has effective CSS text
   - Gemini: MEDIUM — omitting css field may confuse handlers expecting fixed structure
   - **Consensus action**: Server must keep effective CSS in `lastSnapshot` regardless of null returns; never persist null CSS to server state.

3. **Scroll staleness on idle polls** (05-03):
   - Gemini: HIGH — user scrolls on desktop, phone stays stale until DOM mutation
   - Codex: implicit in MutationObserver blind spots (MEDIUM)
   - **Consensus action**: Add `scrollY/scrollX` check to dirty detection, or accept and document explicitly with a note in PLAN.md.

4. **50MB cache cap understates actual heap cost** (05-01):
   - Both reviewers note strings in JS are UTF-16 / more expensive than raw bytes
   - **Consensus action**: Consider using ~25MB effective cap or count string `.length * 2` bytes.

### Divergent Views

- **Codex rates 05-02 and 05-03 as HIGH risk overall**; Gemini rates them LOW-MEDIUM. The divergence is primarily around the `/snapshot` full-reload CSS contract — Codex identified a concrete regression path (reconnect → `/snapshot` → `lastSnapshot.css = null` → client clears styles), Gemini did not model this scenario.
- **Codex flags scope creep in 05-03** (stats_update, lightning indicator); Gemini considers it a positive feature. Codex's concern is about rollout risk and measurable ROI before adding protocol complexity.
- **Codex suggests negative-caching oversize/failed images** (05-01); Gemini did not raise this. Worth addressing — it's a real gap for repeated polls with consistently failed images.

---

*To incorporate this feedback into planning:*
```
/gsd:plan-phase 5 --reviews
```
