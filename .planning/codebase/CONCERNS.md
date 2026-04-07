# Codebase Concerns

**Analysis Date:** 2026-04-07

---

## Known Bugs

**Missing `/chat-status` endpoint:**
- Symptoms: `public/js/app.js` calls `GET /chat-status` every 10 seconds (line 1006, inside `checkChatStatus()`), but no such route exists in the main `server.js`. Every call returns a 404. The `hasChatOpen()` function is defined at `server.js` line 989 but is never wired to an HTTP route.
- Files: `server.js`, `public/js/app.js` line 1006
- Impact: `chatIsOpen` state is never updated from the server; the "No Chat Open" empty state logic never triggers correctly via polling.
- Fix approach: Add `app.get('/chat-status', ...)` to `server.js` calling `hasChatOpen(cdp)`. The correct implementation exists in `.claude/worktrees/agent-a3913218/server.js` at line 1342.

**`textPart.trim()` crashes on null in `/chat-history`:**
- Symptoms: When reading Claude Code `.jsonl` history files, `textPart` can be null if the content array has no `type: 'text'` entry or if `parts` is neither a string nor an array. Calling `.trim()` on null throws `TypeError: Cannot read properties of null`, which is caught silently and the endpoint returns `{ error: e.message, chats: [] }`.
- Files: `server.js` line 1855
- Trigger: Any session where the first user message has no text part (image-only or tool-call-only messages).
- Fix approach: Change `const t = textPart.trim()` to `const t = textPart?.trim() ?? ''`. The fix already exists in `.claude/worktrees/agent-a5078764/server.js` at line 1866 but has not been merged to main.

**`toggle-edit-auto` action is broken for Claude target:**
- Symptoms: The "Edit Auto" button in the phone's Claude toolbar sends a CDP action but nothing changes in Claude Code. The selector in `targets/claude.js` looks for a button whose combined label/text contains both "edit" AND ("auto" OR "permit" OR "allow"), but the actual button uses different text.
- Files: `targets/claude.js` lines 292-301 (`performAction`), lines 347-357 (`getToolbarState`)
- Known issue: Tracked in `.planning/todos/pending/2026-04-05-fix-edit-auto-button-selector-in-claude-toolbar.md`
- Fix approach: Visit `/ui-inspect` while Claude tab is active, find the button in `bestContextData.buttons`, capture its exact `ariaLabel`/`text`, update both selectors in `targets/claude.js`.

---

## Security Considerations

**Hardcoded default secrets:**
- Risk: Three secrets fall back to publicly-known default values if not set in `.env`:
  - `APP_PASSWORD` defaults to `'antigravity'` (`server.js` line 28)
  - `AUTH_SALT` defaults to `'antigravity_default_salt_99'` (`server.js` line 1269)
  - `SESSION_SECRET` defaults to `'antigravity_secret_key_1337'` (`server.js` line 1276)
- Files: `server.js` lines 28, 1269, 1276
- Current mitigation: App is designed for local Wi-Fi use; local requests bypass auth entirely anyway.
- Recommendations: Warn loudly at startup if any secret is still at its default value. Generate a random `AUTH_SALT` and `SESSION_SECRET` on first run if not set in `.env`.

**App password printed to stdout and captured in log file:**
- Risk: At startup, `server.js` line 1910 prints `🔐 App Password: ${APP_PASSWORD}` to stdout. The start scripts (`start_ag_phone_connect.bat`) redirect stdout to `server_log.txt`. If the log is shared or accidentally read, the password is exposed in plaintext.
- Files: `server.js` line 1910, `server_log.txt`
- Current mitigation: `server_log.txt` is in `.gitignore`.
- Recommendations: Replace log line with `🔐 App Password: [set in .env]` or mask with asterisks.

**Magic link passes raw password as URL query parameter:**
- Risk: `server.js` line 1299 checks `req.query.key === APP_PASSWORD` to auto-login via QR code. The plaintext password appears in browser history, server access logs, ngrok dashboard request inspector, and any reverse proxy logs.
- Files: `server.js` lines 1299-1307
- Current mitigation: None.
- Recommendations: Use a time-limited HMAC token (e.g., `crypto.createHmac('sha256', SESSION_SECRET).update(Date.now().toString()).digest('hex')`) instead of the raw password for the magic link parameter. Invalidate after first use or after 5 minutes.

**No brute-force protection on `/login`:**
- Risk: `app.post('/login')` at `server.js` line 1325 has no rate limiting, lockout, or delay. Any device can attempt unlimited password guesses.
- Files: `server.js` lines 1325-1337
- Current mitigation: Local network only in typical usage.
- Recommendations: Add `express-rate-limit` on the `/login` route; enforce a delay or lockout after 5 failed attempts per IP.

**Auth bypass for entire local network:**
- Risk: `isLocalRequest()` at `server.js` lines 1112-1133 allows any device with a `192.168.*`, `10.*`, or `172.16-31.*` IP to call all API endpoints without authentication. On a shared or public Wi-Fi network (café, office, hotel), any connected device can read chat history, inject messages, and execute CDP actions.
- Files: `server.js` lines 1112-1133, 1294
- Current mitigation: Intentional design for "same Wi-Fi" convenience.
- Recommendations: Add a `REQUIRE_AUTH_LOCAL=true` env var that disables the bypass. Document the risk clearly in README for users who run the server on untrusted networks.

**Weak AUTH_TOKEN generation (non-cryptographic hash):**
- Risk: `hashString()` at `server.js` lines 1101-1109 is a djb2 bit-shift variant. It has known collision patterns and is not suitable for security tokens. The token derived from it (`AUTH_TOKEN`) is used as a session cookie value. Collisions are theoretically exploitable.
- Files: `server.js` lines 1101-1109, 1270
- Current mitigation: Local-use app; attacker would need to be on the same network.
- Recommendations: Replace with `crypto.createHmac('sha256', sessionSecret).update(APP_PASSWORD + authSalt).digest('hex')`.

**Raw HTML from CDP snapshot injected into phone DOM:**
- Risk: `chatContent.innerHTML = data.html` at `public/js/app.js` line 481 sets the phone chat area to HTML captured from the desktop AI app via CDP's `cloneNode`. If the AI app displayed content containing inline event handlers (`onclick`, `onmouseover`, etc.), they execute in the phone browser's context.
- Files: `public/js/app.js` line 481
- Current mitigation: Scripts within `<script>` tags do not execute when set via `innerHTML`, but inline event handlers do.
- Recommendations: Sanitize the captured HTML with DOMPurify before setting innerHTML, or render it inside a sandboxed iframe.

**XSS via chat title in history card onclick handler:**
- Risk: `public/js/app.js` lines 929-935 builds `safeTitle` by escaping only `"` and `'`, then interpolates it into a string `onclick` attribute: `onclick="hideChatHistory(); selectChat('${safeTitle}');"`. Characters like backticks, parentheses, semicolons, and JS keywords in a chat title are not escaped and can execute arbitrary code when the card is clicked.
- Files: `public/js/app.js` lines 929-935
- Current mitigation: Chat titles come from sessions the user created (self-XSS), but the Claude JSONL reader uses the first user message as the title — a chat initiated with a malicious payload would be exploitable.
- Recommendations: Remove string-template onclick entirely; use `element.addEventListener('click', ...)` with the title stored in a `data-*` attribute after the HTML is rendered.

**Debug and SSL generation endpoints accessible to all authenticated sessions:**
- Risk: `POST /generate-ssl` at `server.js` line 1381 executes `execSync('node generate_ssl.js', ...)`. `GET /debug-ui`, `GET /ui-inspect`, and `GET /cdp-targets` expose full DOM trees, CDP frame hierarchies, and WebSocket debugger URLs.
- Files: `server.js` lines 1381-1395, 1398-1406, 1461-1654, 1657-1668
- Current mitigation: Protected by cookie auth (bypassed for local network).
- Recommendations: Gate these behind a `DEBUG_MODE=true` env var that is off by default in production.

---

## Tech Debt

**`server.js` is a 1939-line monolith:**
- Issue: All logic is in one file: CDP connection management, 10+ DOM automation scripts as template-string JS, HTTP routing, auth middleware, SSL handling, chat history filesystem parsing, and startup. Each CDP action function is 30-100 lines of inline JavaScript strings.
- Files: `server.js`
- Impact: Hard to navigate and test. Adding a third target requires editing this file in many locations.
- Fix approach: Extract CDP action scripts into their respective target files (`targets/antigravity.js`, `targets/claude.js`). Extract auth and server setup into separate modules.

**~35 silent empty catch blocks:**
- Issue: `server.js` has approximately 35 `catch (e) { }` blocks that swallow all errors silently. CDP call failures, WebSocket errors, and DOM script exceptions disappear without a trace.
- Files: `server.js` lines 183, 301, 335, 393, 446, 587, 654, 957, 983, 1008, 1095, and 20+ more
- Impact: Production failures are invisible. The recent series of revert commits in git history (5 reverts in a row) is likely a symptom of this — broken behavior is hard to reproduce without logs.
- Fix approach: At minimum, add `console.warn('[functionName] error:', e.message)` to every catch block. The `agent-af620e4e` worktree already has this applied throughout.

**`document.execCommand` is deprecated:**
- Issue: Both `targets/claude.js` line 168 and `targets/antigravity.js` line 214 use `document.execCommand?.('insertText', ...)` as the primary text-injection method. This API was deprecated in 2016 and is removed from the HTML spec; it works today only due to Chromium/Electron legacy compatibility.
- Files: `targets/claude.js` line 168, `targets/antigravity.js` line 214
- Impact: Will break silently when Electron or VS Code updates Chromium past the removal threshold.
- Fix approach: Use `InputEvent` with `inputType: 'insertText'` and `DataTransfer` directly, or the `insertReplacementText` inputType. The fallback already exists; the execCommand call should become the fallback rather than the primary.

**Hardcoded model list in frontend:**
- Issue: `public/js/app.js` lines 379-386 contains a hardcoded list of AI model display names. These must be updated manually whenever the actual Antigravity models change.
- Files: `public/js/app.js` lines 379-386
- Fix approach: Add a `/models` endpoint that reads available models from the connected app's UI via CDP, or move the list to a server-side config file.

**`package-lock.json` is gitignored:**
- Issue: `.gitignore` line 2 excludes `package-lock.json`. Builds are non-deterministic: `npm install` can resolve different patch versions of transitive dependencies on each machine.
- Files: `.gitignore` line 2
- Impact: Cannot run `npm audit` consistently across environments. Security patches in transitive deps may silently not apply.
- Fix approach: Remove `package-lock.json` from `.gitignore` and commit it.

**Additional multi-target endpoints registered inside `main()` instead of `createServer()`:**
- Issue: Routes `/targets`, `/switch-target`, `/claude/action`, `/claude/toolbar-state`, `/remote-click`, `/remote-scroll`, `/app-state`, `/new-chat`, `/chat-history`, `/select-chat`, and `/close-history` are registered inside the `main()` try-catch block at `server.js` lines 1737-1901, not alongside the other routes in `createServer()`. Route registration is split across two separate locations.
- Files: `server.js` lines 1737-1901
- Fix approach: Move all `app.get`/`app.post` calls into `createServer()` for a single authoritative list of endpoints.

**Global state stored on `window` object:**
- Issue: `public/js/app.js` line 299 uses `window.lastTarget = data.current` to track last known target. Application state on the global `window` is an anti-pattern.
- Files: `public/js/app.js` line 299
- Fix approach: Move to a module-level `let lastTarget` variable alongside the other state declarations at the top of the file.

---

## Fragile Areas

**CSS cursor-style heuristic for clickable element discovery:**
- Files: `server.js` DOM scripts inside `setMode()` (line 219), `setModel()` (line 452), `startNewChat()` (line 593), `getChatHistory()` (line 659), `selectChat()` (line 844), `getAppState()` (line 1013)
- Why fragile: All click-target discovery walks up to 4-5 DOM ancestor levels checking `window.getComputedStyle(el).cursor === 'pointer'`. Any CSS framework update (Tailwind version bump, class rename) that changes hover cursor behavior breaks all of these silently, returning a vague `{ error: 'button not found' }` with no diagnostic info.
- Safe modification: Always prefer the Priority-1 selectors (`[data-tooltip-id=...]`, `aria-label`) over the heuristic traversal. Log which fallback branch was used when a match succeeds.
- Test coverage: None.

**CDP context iteration fires on wrong frames:**
- Files: `server.js`, `targets/antigravity.js`, `targets/claude.js`
- Why fragile: Every CDP operation loops through all execution contexts and returns the first success. A service worker, extension background page, or hidden iframe context could respond first and silently succeed in the wrong scope. `targets/claude.js` partially mitigates this by trying without `contextId` first, but the core issue is unresolved.
- Safe modification: Log which `contextId` returned a successful result when adding new CDP actions.
- Test coverage: None.

**`killPortProcess()` parses shell command text output:**
- Files: `server.js` lines 41-76
- Why fragile: Parses raw text output of `netstat -ano` on Windows. Output format varies by locale, OS version, and whether running inside WSL or Docker. A parse failure silently returns a resolved Promise (no kill attempted), and the server then fails with `EADDRINUSE`.
- Safe modification: Consider wrapping the listen call in a try/catch for `EADDRINUSE` and retrying on the next port instead of pre-emptively killing processes.

**Self-signed SSL certificate expires after 365 days:**
- Files: `generate_ssl.js` lines 122-123, `certs/server.cert` (on disk, gitignored)
- Why fragile: Certificate generated with `-days 365`. When it expires, all HTTPS connections fail and the phone UI shows a certificate error with no automatic renewal. There is no expiry warning in the server startup log.
- Safe modification: Add a startup check that reads `certs/server.cert` and logs a warning if it expires within 30 days. Consider using a longer validity (e.g., 3650 days) for development certs.

---

## Performance Bottlenecks

**Full DOM snapshot every 1 second, broadcast on any change:**
- Problem: `startPolling()` in `server.js` calls `captureSnapshot()` every 1000ms. Each snapshot clones the full chat DOM, serializes all CSS stylesheet rules, and base64-encodes local images. For large chats this can produce 100KB–2MB per poll. On any hash change, all connected clients are notified and each independently fetches the full snapshot via a separate HTTP GET.
- Files: `server.js` lines 1166-1241
- Cause: No diffing; polling over-triggers even for minor streaming updates.
- Improvement path: Embed snapshot data directly in the WebSocket `snapshot_update` message to eliminate the second fetch. Increase poll interval to 2s when content is stable for >10s.

**CSS change detection uses length + 64-byte prefix:**
- Problem: `public/js/app.js` line 470 checks `data.css.length + ':' + data.css.slice(0, 64)`. Changes that only affect the end of a large stylesheet are not detected; changes that only affect the first 64 bytes of a same-length stylesheet trigger a false-negative.
- Files: `public/js/app.js` line 470
- Improvement path: Apply the same `hashString()` already used for snapshot diffing on the server side to the CSS string.

**`/chat-history` reads all `.jsonl` files synchronously:**
- Problem: `server.js` lines 1826-1875 uses `fs.readdirSync` and `fs.readFileSync` to iterate every project directory and session file under `~/.claude/projects/` synchronously, blocking the Node.js event loop.
- Files: `server.js` lines 1819-1875
- Cause: No async I/O, no caching, no pagination.
- Improvement path: Rewrite with `fs.promises.readdir` / `fs.promises.readFile` and `Promise.all()`. Cache results and only re-read files whose `mtime` has changed since the last request.

---

## Test Coverage Gaps

**No test suite exists:**
- What's not tested: All server endpoints, CDP action functions, auth logic, WebSocket auth, snapshot hashing, chat history parsing, port cleanup.
- Files: All of `server.js`, `targets/claude.js`, `targets/antigravity.js`, `public/js/app.js`
- Risk: Any refactoring silently breaks functionality. The git log shows 5 consecutive revert commits on the `dev` branch, suggesting regressions are currently caught only by manual testing.
- Priority: High

**CDP DOM injection scripts cannot be unit-tested:**
- What's not tested: The JavaScript strings injected via `Runtime.evaluate` in all CDP action functions. They are plain template-literal strings embedded inside server.js — no way to import or mock them.
- Files: `server.js` lines 211-303, 308-338, 344-396, etc.; `targets/claude.js`; `targets/antigravity.js`
- Risk: Selector changes in Antigravity or Claude Code UI break actions with no automated detection.
- Priority: High

**Auth edge cases untested:**
- What's not tested: IPv6-mapped addresses bypassing `isLocalRequest()`, signed cookie verification, concurrent session handling, magic link token flow.
- Files: `server.js` lines 1112-1133, 1287-1320, 1671-1706
- Priority: Medium

---

## Scaling Limits

**Single shared `currentTarget` global affects all connected clients:**
- Current capacity: One active target at a time, selected server-wide. All phone clients see the same target.
- Limit: If two users connect simultaneously, switching targets on one user's device switches it for all users.
- Scaling path: Move `currentTarget` to per-session state keyed by WebSocket connection or cookie session.

**No WebSocket client connection limit:**
- Current capacity: Unlimited concurrent WebSocket connections.
- Limit: Each connection receives broadcast notifications and triggers a full HTTP snapshot fetch. Memory grows linearly with connected clients.
- Scaling path: Add a `wss.clients.size > MAX_CLIENTS` check on connection and reject with a JSON error message.

---

## Dependencies at Risk

**`express` 4.x with no upgrade plan:**
- Risk: Express 5.x is released with breaking API changes. Express 4.18.x receives security patches but at lower priority. `express` 4.18.2 was released in 2022 — it is 3+ years old.
- Impact: Security patches may be delayed; async error handling requires manual next(err) in Express 4 which is easy to miss.
- Migration plan: Evaluate Express 5 compatibility when the next server refactor occurs.

**`package-lock.json` gitignored means no auditable dependency tree:**
- Risk: `npm audit` results differ between machines. Transitive dependency security patches are not guaranteed to apply on reinstall.
- Files: `.gitignore` line 2
- Migration plan: Remove from `.gitignore`, commit the lockfile, run `npm audit` as part of development workflow.

---

*Concerns audit: 2026-04-07*
