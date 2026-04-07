# PhoneCode (Antigravity Phone Connect)

## What This Is

A CDP bridge that turns any mobile browser into a wireless viewport for desktop AI coding tools (Antigravity, Claude Code). It mirrors the desktop tool's live chat UI to the phone in real time, and relays mobile taps and messages back to the desktop — so developers can review AI output and issue commands without being physically at their desk.

## Core Value

The phone should feel like a native extension of the desktop session — zero friction to check status, respond, or approve actions from anywhere.

## Requirements

### Validated

- Real-time DOM snapshot mirroring (1s polling, WebSocket push notification)
- Message injection from phone to desktop AI tool
- Remote click relay (expand thoughts, approve/reject commands)
- Dual-target support: Antigravity + Claude Code VS Code extension
- Authentication: LAN bypass + signed cookie auth for remote (ngrok) access
- HTTPS/SSL support with auto-detection

### Active

- [ ] Testing foundation — no tests currently exist
- [ ] Tech debt: `server.js` is a 1940-line monolith, needs modularization
- [ ] Mobile UX: gesture support, smoother scroll sync, improved state indicators

### Out of Scope

- Cloud hosting / multi-user deployment — this runs on the developer's local machine only
- Modifying the target AI tool itself — CDP remote debugging is read/write but non-invasive
- Authentication beyond passcode — OAuth/SSO would add friction for a personal tool

## Context

- Fork of [krishnakanthb13/antigravity_phone_chat](https://github.com/krishnakanthb13/antigravity_phone_chat); extended with Claude Code target, multi-target switching, improved auth, and mobile UX work
- No frontend build pipeline — mobile SPA is plain HTML/CSS/vanilla JS, served directly
- Target apps must be launched with `--remote-debugging-port=9000` (or 9001–9003)
- Runs on Windows (primary), macOS, Linux — port-kill logic is platform-aware

## Constraints

- **Tech stack**: Node.js (ES Modules) + vanilla JS frontend — no framework, no build step. Keep it that way unless there's a strong reason.
- **No code modification**: Cannot modify Antigravity or Claude Code internals — all interaction via CDP JS injection
- **Platform**: Must work on Windows 10 (primary dev machine) + Unix; path and process handling must be cross-platform
- **Single-user**: No multi-user concurrency design needed

## Key Decisions

- **Snapshot delivery model**: WebSocket for push notifications only; actual HTML/CSS snapshot always fetched via HTTP GET (avoids WS payload size issues)
- **CSS strategy**: Two-layer injection — static dark-mode overrides injected once at page load; dynamic CSS from snapshots only re-injected when hash changes
- **Auth model**: LAN clients bypass auth entirely; remote clients authenticate via magic link or passcode + signed HttpOnly cookie
- **Target adapter pattern**: Each supported tool is a module in `targets/` exposing `discover`, `captureSnapshot`, `injectMessage` — adding a new tool means adding one file
- **Context iteration pattern**: All CDP calls try every execution context and return the first success — handles multi-iframe targets without special-casing
