# Phase 4 Context: Snapshot Diffing

## Goal
Replace full-HTML snapshot broadcasts (500KB–2MB each) with incremental diff-based updates.
Mobile client receives only changed DOM nodes, not the full HTML on every poll.

## Problem
- `startPolling()` in `server.js:1355` fires every 1 second
- On hash change: broadcasts `{ type: 'snapshot_update' }` notification
- Client receives notification → calls `GET /snapshot` → receives full HTML (500KB–2MB)
- Client does `chatContent.innerHTML = data.html` — full DOM replacement
- On mobile data: 30–50MB/hour for an average session

## Current Code Locations
- Polling loop: `server.js:1355–1406`
- Broadcast: `server.js:1396–1403`
- `/snapshot` endpoint: `server.js` (returns `lastSnapshot`)
- Client WS handler: `public/js/app.js:401–409`
- `loadSnapshot()`: `public/js/app.js:432–510` — fetches `/snapshot`, sets `chatContent.innerHTML`

## Approach
Use `diff-dom` library (works in Node.js + browser) to:
1. **Server**: compute structural diff between old and new HTML snapshot → broadcast diff JSON
2. **Client**: apply diff to existing `chatContent` DOM — no full replace, no fetch

### Why diff-dom
- Produces JSON-serializable patch array `[{ action, route, ... }]`
- Same lib works in browser for `apply()` — no separate parser needed client-side
- Typical diff for a partial Claude response change: 2–10KB vs 500KB–2MB full HTML
- jsdom needed server-side to parse HTML strings into DOM for diffing

## Fallback Protocol
- Client sends first connect → server responds with full snapshot (`snapshot_full`)
- Client tracks `seq` counter; if gap detected → request `/snapshot?resync=1`
- If diff `apply()` throws → fallback to `loadSnapshot()` automatically

## Plans
- `04-01-PLAN.md` — Server: diff computation, seq counter, broadcast change
- `04-02-PLAN.md` — Client: patch apply, seq tracking, fallback recovery
