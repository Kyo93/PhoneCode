# Codebase Concerns

**Analysis Date:** 2026-04-07

## Tech Debt

**Silent Error Suppression in CDP Operations:**
- Issue: Widespread empty catch blocks (`catch (e) { }`) throughout the codebase suppress errors without logging or alternative handling paths
- Files: `server.js` (lines 57, 67, 112, 132, 183, 301, 335, 393, 446, 1048, 1116, 1142, 1167, 2080), `targets/antigravity.js`, `targets/claude.js`, `ui_inspector.js`, `discovery_claude.js`
- Impact: Silent failures make debugging difficult. CDP calls that timeout or fail leave no trace in logs. DOM scraping failures go unreported. Message injection attempts silently fail and users never know why their input didn't register.
- Fix approach: Replace empty catches with at minimum `console.error()` calls. For critical paths like `injectMessage` or `captureSnapshot`, return structured error objects with reasons so clients can show meaningful feedback.

**DOM Selection Brittleness:**
- Issue: Heavy reliance on complex CSS selectors, class name patterns, and semantic DOM structure that changes frequently. Multiple fallback strategies required in functions like `setMode`, `setModel`, `clickElement`, `remoteScroll`.
- Files: `server.js` (lines 207-304, 451-550, 399-449, 340-396)
- Impact: UI changes in Antigravity or Claude Code break element selection. Functions have 3-5 fallback strategies but still fail unpredictably. Chat history scraping via DOM selector `[class*="sessionItem"]` is fragile.
- Fix approach: Migrate away from CSS class selectors toward `data-*` attributes or IDs where possible. Implement a validation layer that confirms element state before acting (e.g., verify button is visible and clickable before clicking). Cache element references instead of re-querying on every call.

**Large Monolithic Server File:**
- Issue: `server.js` is 2163 lines in a single file containing: port killing logic, network utilities, CDP connection management, screenshot capture logic, DOM manipulation expressions, 30+ Express endpoints, WebSocket handling, and auth middleware all mixed together
- Files: `server.js` (entire file)
- Impact: Difficult to understand data flow. Related concerns scattered across unrelated code sections. Testing individual functions requires loading the entire 2163-line module. Changes in one area risk affecting others.
- Fix approach: Refactor into modular structure: `lib/cdp.js` (connection + call management), `lib/dom-operations.js` (all JavaScript expressions for DOM interactions), `routes/` (API endpoints grouped by concern), `middleware/` (auth, ngrok header), `utils/` (network utilities, hashing). Consider moving target-specific logic into `targets/` directory.

**No Input Validation in DOM Expressions:**
- Issue: User input (`textContent`, `selector`, `scrollTop`) is interpolated directly into JavaScript expressions that run in the browser context without sanitization
- Files: `server.js` (lines 341-396 clickElement, 399-449 remoteScroll, 451-550 setModel, 207-304 setMode, 1980-1986 remote-click endpoint)
- Impact: Malicious input could inject arbitrary JavaScript into the CDP Runtime.evaluate calls. Example: `selector = "'); alert('xss'); //"` would break the expression. Not a major risk since only authenticated users can call these, but violates defense-in-depth.
- Fix approach: Sanitize/validate all user inputs before interpolating into expressions. Use parameterized approaches where possible. For selectors, validate against a whitelist of safe patterns. For textContent, escape special characters.

**Memory Leak Risk: Pending CDP Calls:**
- Issue: In `connectCDP` (lines 186-199), pending calls stored in `pendingCalls` Map are cleaned up via timeout, but if a timeout occurs, the entry is deleted. However, if CDP connection dies before response arrives and no timeout fires, orphaned entries remain.
- Files: `server.js` (lines 154, 164-171, 186-199)
- Impact: Long-lived applications making many CDP calls could accumulate orphaned entries in the Map over days/weeks. Each entry holds resolve/reject functions and context, preventing garbage collection.
- Fix approach: Add maximum Map size check. Implement periodic cleanup every 5 minutes to remove stale entries (>10min old). Consider using a WeakMap if possible, or implement explicit cleanup on CDP disconnection.

**Global State Mutation:**
- Issue: Global variables `currentTarget`, `lastSnapshot`, `lastSnapshotHash`, `cdpConnections` are mutated by multiple async operations without proper synchronization. No locking mechanism.
- Files: `server.js` (lines 35-38, 1330-1406, 1941-1958)
- Impact: Race conditions possible when polling updates snapshots while client requests switch targets. Could result in inconsistent snapshots displayed to user or stale CDP connection references. If polling captures snapshot at same moment client switches target, client might see wrong target's snapshot.
- Fix approach: Implement target-aware snapshot storage: `snapshots = { antigravity: {...}, claude: {...} }` instead of single `lastSnapshot`. Use locks or queues for target switching to ensure atomic operations.

## Known Bugs

**Chat History Scraping Fails Silently:**
- Symptoms: `/chat-history` returns `error: 'No session items found in DOM'` when user opens history without expecting it, or returns empty array when chats definitely exist
- Files: `server.js` (lines 1054-1119, 2021-2098)
- Trigger: Happens when DOM scraping for session items finds nothing because elements haven't rendered yet, or class names changed. Fallback to FS works for Claude but not for Antigravity.
- Workaround: Refresh the history panel, or switch targets and back. For Claude, history from `~/.claude/projects/` usually works.

**Remote Click IndexError on Nested Elements:**
- Symptoms: `/remote-click` fails with "Element not found at index X among Y matches" even though element clearly visible
- Files: `server.js` (lines 340-396, particularly 363-365 filtering nested elements)
- Trigger: When multiple nested elements match the selector (parent and child both have same text), the filtering at line 363 removes the most specific one, leaving only outer containers which aren't directly clickable
- Workaround: Manually click individual elements on phone UI instead of using remote click for complex nested thought blocks

**Stale Snapshot Hash Mismatch:**
- Symptoms: Snapshot doesn't update on phone even though desktop clearly changed. Hash stays same for multiple polls.
- Files: `server.js` (lines 1364-1369, 1381)
- Trigger: `hashString()` uses simple bit-rotation algorithm (lines 1266-1274) which has collisions on similar HTML content. Two different snapshots can produce same hash, preventing updates
- Workaround: Force refresh by clicking refresh button, which bypasses hash check and captures fresh snapshot

**App State Detection Finds Wrong Model:**
- Symptoms: Model shows "Claude" when it's actually "Gemini", or shows model name from chat content instead of selector UI
- Files: `server.js` (lines 1172-1263)
- Trigger: Logic searches for leaf text nodes containing model keywords but doesn't properly exclude chat content. Antigravity shows model inside chat history in status area, function finds that instead
- Fix in place: Lines 1218 attempt to exclude chat content but logic is fragile

**WebSocket Cookie Parsing Incomplete:**
- Symptoms: Some browsers send cookies in different formats causing `/WebSocket` auth to fail even though user is logged in (HTTP auth works fine)
- Files: `server.js` (lines 1867-1895)
- Trigger: Cookie parsing at line 1871 naively splits on `;` but doesn't handle `Secure` or `HttpOnly` attributes properly. Also doesn't handle cookie names/values with special characters
- Workaround: Reconnect the WebSocket or refresh page. HTTP requests work fine.

## Security Considerations

**Weak Default Password:**
- Risk: Default `APP_PASSWORD` is hardcoded as `'antigravity'` (line 28, line 1441). If user deploys without changing `.env`, anyone on the network can access
- Files: `server.js` (line 28, 1441), `.env.example` (line 4)
- Current mitigation: Local Wi-Fi devices bypass auth entirely (lines 1459, 1887). Public ngrok URLs require password. But if ngrok URL leaks, weak password is easily brute-forced.
- Recommendations: Generate strong random password on first startup if not provided. Require `.env` modification before server starts. Add rate limiting to `/login` endpoint. Implement account lockout after 3 failed attempts.

**Auth Token Predictability:**
- Risk: `AUTH_TOKEN` (line 31, 1435) is derived via `hashString(APP_PASSWORD + authSalt)`. If authSalt is the default `'antigravity_default_salt_99'`, token is easily reproducible. Custom salt helps but still relies on password entropy.
- Files: `server.js` (lines 31, 434, 1435)
- Current mitigation: Salt from `AUTH_SALT` env var (line 1434)
- Recommendations: Use cryptographic hash (SHA256) instead of simple bit-rotation for token generation. Consider using built-in Node.js `crypto.createHash()`.

**Plaintext Credentials in Optional Fields:**
- Risk: `.env` file can contain API keys for AI providers (line 12 in `.env.example`). While `.env` should be in `.gitignore` (which it is per `.gitignore`), it's still readable by any local user on shared systems
- Files: `.env.example` (line 12)
- Current mitigation: `.env` is in `.gitignore` so not committed. Permissions depend on OS file permissions.
- Recommendations: Warn users not to share `.env` with API keys. Require them to understand risk. Consider supporting environment variable-only mode without `.env` file option for sensitive deployments.

**No Rate Limiting on CDP Endpoints:**
- Risk: Endpoints like `/set-mode`, `/set-model`, `/remote-click` have no rate limiting. Attacker could flood with requests causing DoS to desktop app via CDP spam or exhausting WebSocket resources
- Files: `server.js` (lines 1605-1629, 1980-1995, 2010)
- Current mitigation: Local network restriction helps, but authenticated remote users face no limits
- Recommendations: Implement rate limiter middleware (e.g., `express-rate-limit`). Limit to 10 requests/second per IP, or 1 request per 100ms for mode/model changes.

**Ngrok Authorization Token in Plaintext:**
- Risk: `NGROK_AUTHTOKEN` in `.env` (line 9 in `.env.example`) is sensitive. If `.env` leaks (backup, screen capture, etc.), attacker can use token to create tunnels on the user's ngrok account
- Files: `.env.example` (line 9)
- Current mitigation: None beyond standard `.env` protection
- Recommendations: Document risk in README. Advise users to rotate tokens regularly. Consider supporting ngrok API key in memory only, not persisted in `.env`.

## Performance Bottlenecks

**Snapshot Capture DOM Cloning:**
- Problem: Every poll (1 second interval, line 26) clones entire DOM with `cascade.cloneNode(true)` (lines 56, 48 in targets). For Claude Code with large VS Code interface, this clones thousands of nodes every second.
- Files: `server.js` (line 26 POLL_INTERVAL), `targets/claude.js` (line 48), `targets/antigravity.js` (line 56)
- Cause: Full HTML + CSS extraction needed for mobile display, but cloning entire DOM tree is expensive. Image conversion to base64 adds more latency.
- Improvement path: Implement incremental snapshots - only re-capture changed regions. Use shadow DOM APIs to avoid cloning hidden subtrees. Compress images before base64 conversion. Consider caching CSS across polls since it rarely changes.

**Image Conversion Loop:**
- Problem: Every snapshot converts all local images to base64 via `fetch()` + `FileReader()` (lines 69-84 in claude.js, 102-117 in antigravity.js). For 50 images = 50 sequential fetch+convert operations adding 5-10 seconds per snapshot.
- Files: `targets/claude.js` (lines 69-84), `targets/antigravity.js` (lines 102-117)
- Cause: Sequential Promise.all() on individual image conversions is slow. No caching or size limits.
- Improvement path: Parallelize with Promise.all() but limit to 5 concurrent. Cache base64 images by URL. Skip converting images larger than 1MB. Consider serving images from a temporary cache instead of embedding in every snapshot.

**CSS Rule Collection is Unfiltered:**
- Problem: Collects ALL CSS rules from all stylesheets without filtering (lines 89-103 in claude.js, 149-165 in antigravity.js). For complex applications, this is thousands of rules totaling 100KB+. All sent in every snapshot.
- Files: `targets/claude.js` (lines 89-103), `targets/antigravity.js` (lines 149-165)
- Cause: Simple loop collects everything then applies broad regexes (replace fixed/absolute/100vh). No deduplication or filtering of unused rules.
- Improvement path: Filter CSS rules to only those matching elements in snapshot. Deduplicate rules. Strip unused selectors. Minify CSS output. Cache rule set across polls.

**Hash Collision Causes False Negatives:**
- Problem: Simple `hashString()` (lines 1266-1274) produces collisions. Content hash calculation is quick but cheap, leading to missed snapshot updates.
- Files: `server.js` (lines 1266-1274, 1364)
- Cause: 32-bit rolling hash used, not cryptographic. Similar content produces same hash frequently.
- Improvement path: Use CRC32 or SHA256 for robust hashing. Or compare HTML length + first 100 chars instead of hash.

**WebSocket Broadcast Without Filtering:**
- Problem: Every poll sends broadcast to ALL connected clients (line 1372-1379) even if they're on different targets. Client then must fetch entire snapshot.
- Files: `server.js` (lines 1372-1379)
- Cause: Single global `wss` object broadcasts to all clients. No client metadata tracking which target they're viewing.
- Improvement path: Track client target preference. Send updates only to clients viewing that target. Or include target ID in broadcast so clients ignore irrelevant updates.

## Fragile Areas

**DOM Structure Dependency for Message Injection:**
- Files: `targets/claude.js` (lines 142-250), `targets/antigravity.js` (corresponding lines)
- Why fragile: Injection looks for `[contenteditable]` or `[contenteditable="plaintext-only"]` elements, then types text character by character or uses clipboard fallback. If Claude changes editor implementation or Antigravity refactors input area, injection breaks completely.
- Safe modification: Add fallback strategies that try multiple approaches. Log which method succeeded so developers can track breakage. Add retry logic with exponential backoff. Consider adding JS listener on input element to detect when injection succeeds vs. fails.
- Test coverage: No dedicated tests for `injectMessage`. Should add integration tests against real instances of Antigravity/Claude Code.

**CDP Context Management:**
- Files: `server.js` (lines 154-205)
- Why fragile: Code assumes contexts list is stable, but contexts can be created/destroyed at runtime. `Runtime.executionContextDestroyed` is handled (line 176-179) but timing is tight. If context is destroyed between getting context list and executing expression, error occurs.
- Safe modification: Wrap all Runtime.evaluate calls in try-catch (already partially done). Add context validation before execute. If context fails, retry with different context.
- Test coverage: No tests for context lifecycle.

**Authentication Middleware Order:**
- Files: `server.js` (lines 1444-1485)
- Why fragile: Public paths are hardcoded list (line 1453). If new public endpoint is added, must update this list, easy to forget. Auth cookie verification mixes signed cookies and unsigned. WebSocket auth uses separate logic than HTTP auth.
- Safe modification: Use decorator pattern or explicit auth() middleware for protected routes instead of blacklist. Consolidate auth logic into single function used by both HTTP and WebSocket. Document all public endpoints clearly.
- Test coverage: Auth logic not tested.

**Target Switching State Consistency:**
- Files: `server.js` (lines 1941-1958)
- Why fragile: `currentTarget` is changed (line 1948) but polling loop may still be reading old value while capture is in progress. Snapshot and state could mismatch.
- Safe modification: Implement atomic target switching with state snapshot. Serialize target changes. Clear in-flight operations before switching.
- Test coverage: No tests for concurrent target switching.

## Scaling Limits

**Single Port Polling:**
- Current capacity: 2 CDP connections (lines 20, PORTS array) to ports 9000-9003, but only checks these 4 ports
- Limit: Can only monitor 2 targets (Antigravity + Claude Code). Adding 3rd target requires modifying PORTS array and regenerating logic
- Scaling path: Make PORTS configurable via env var. Support dynamic port discovery via CDP broadcast. Implement service discovery instead of hardcoded ports.

**WebSocket Connection Limit:**
- Current capacity: No explicit limit on concurrent WebSocket clients. Node.js default is ~10,000 sockets per process.
- Limit: Heavy snapshot broadcasts to all clients will saturate bandwidth. With 10KB snapshots and 1-second poll interval, 100 clients = 1MB/s sustained traffic.
- Scaling path: Implement client throttling. Allow clients to specify update frequency. Compress snapshots (gzip). Implement snapshot diffing so only changes are sent. Partition clients into groups, broadcast to groups.

**Memory Growth from Snapshots:**
- Current capacity: `lastSnapshot` stored in memory (lines 37, 1369). Each snapshot is 50KB-200KB depending on content.
- Limit: Long-running server accumulates snapshots. With high update rate (1s intervals), memory could grow if historical snapshots kept.
- Scaling path: Currently only keeps last snapshot (good), but if snapshots added to history, implement bounded circular buffer. Implement snapshot garbage collection. Move old snapshots to disk.

**Screenshot HTML Size:**
- Current capacity: Snapshot HTML size is 500KB-2MB for complex layouts (server_log shows active capture)
- Limit: Sending 2MB HTML every 1-2 seconds to mobile client over mobile data uses 30-50MB/hour
- Scaling path: Implement compression before sending. Minify HTML. Strip unnecessary attributes. Cache and diff snapshots. Consider vector format for UI rendering instead of HTML.

## Dependencies at Risk

**ws (WebSocket Library) - v8.18.0:**
- Risk: Library maintained but infrequently updated. No security issues reported recently, but long-lived WebSocket connections should be monitored for frame corruption or protocol handling bugs
- Impact: WebSocket auth, client communication depends on ws library. Bug in ws could affect all remote connections
- Migration plan: If ws becomes unmaintained, migrate to `socket.io` which has more active ecosystem, or Node.js native WebSocket support when available (Node.js 21+)

**dotenv - v16.4.7:**
- Risk: Popular and maintained, but loads `.env` into process.env without validation. Malformed `.env` could cause unexpected behavior
- Impact: Configuration loading depends on dotenv
- Migration plan: No immediate risk, but consider validating env vars against schema on startup using something like `joi`

**express - v4.18.2:**
- Risk: Widely maintained, recent versions, but somewhat monolithic for simple server. No immediate risk.
- Impact: Core framework
- Migration plan: Fine as-is

## Missing Critical Features

**No Persistent Session Storage:**
- Problem: Auth tokens are cookies only, no server-side session store. If server restarts, all clients must re-authenticate (though many browsers cache cookies).
- Blocks: Desktop/mobile sync where client must maintain state across restarts
- Workaround: None - just reconnect

**No Snapshot History:**
- Problem: Only last snapshot stored (line 37 `lastSnapshot`). No ability to review past UI state or debug what happened 2 minutes ago
- Blocks: Debugging complex interaction sequences, auditing
- Workaround: None - screenshots must be taken manually

**No Error Reporting Dashboard:**
- Problem: Errors are logged to console only. Mobile user has no visibility into server errors or why operations fail
- Blocks: Debugging failed interactions from mobile
- Workaround: Check server console terminal, reconnect

**No Test Suite:**
- Problem: No test files found. Cannot verify changes don't break existing functionality
- Blocks: Refactoring, new feature development
- Workaround: Manual testing only

**No API Documentation:**
- Problem: 30+ endpoints with no OpenAPI/Swagger spec or documented request/response formats
- Blocks: Integration with other tools, third-party clients
- Workaround: Read server.js directly

## Test Coverage Gaps

**No Auth Testing:**
- What's not tested: Login endpoint, cookie verification, local Wi-Fi bypass, WebSocket auth, signed cookie handling
- Files: `server.js` (lines 1451-1508, 1867-1902)
- Risk: Auth bypass or lock-out bugs will only be discovered in production
- Priority: High

**No CDP Connection Testing:**
- What's not tested: Connection establishment, reconnection after failure, context lifecycle, pending call cleanup, timeouts
- Files: `server.js` (lines 145-205, 1301-1328, 1330-1406)
- Risk: Connection losses or leaks not discovered until heavy production load
- Priority: High

**No Message Injection Testing:**
- What's not tested: Actual message sending to Antigravity or Claude Code, character-by-character typing, clipboard fallback, non-ASCII characters, error handling for missing input element
- Files: `targets/claude.js` (lines 142-250), `targets/antigravity.js` (corresponding)
- Risk: Message injection could silently fail in production with no user feedback
- Priority: High

**No DOM Scraping Testing:**
- What's not tested: Session/chat history scraping, element finding, nested element filtering, fallback to filesystem
- Files: `server.js` (lines 956-1119, 2020-2098)
- Risk: History features break silently when UI structure changes
- Priority: Medium

**No Snapshot Capture Testing:**
- What's not tested: Full snapshot flow including DOM cloning, image conversion, CSS extraction, hash computation
- Files: `targets/claude.js` (lines 33-137), `targets/antigravity.js` (lines 36-175)
- Risk: Snapshot corruption or missing content not caught until user complains
- Priority: Medium

---

*Concerns audit: 2026-04-07*
