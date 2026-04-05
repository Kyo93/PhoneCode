# Bug Fix: Claude Code Send Message Not Working

## Symptom

Sending messages from the phone UI to the **Claude** target had no effect — the message never appeared in Claude Code on desktop. The **Antigravity** target worked fine.

Server log showed `editor_not_found` for all `/send` requests to Claude:

```
📨 /send [claude] contexts:2 result:{"ok":false,"error":"editor_not_found"}
```

## Root Cause

Two compounding issues in `server.js → injectMessage()`:

### 1. Wrong document context

Claude Code (VS Code extension) renders its UI inside a nested iframe:

```
VS Code webview (index.html)
  └── <iframe id="active-frame"> (fake.html)
        └── <div id="root"> ← actual Claude Code UI
```

The original code queried `document` directly:

```js
editor = document.querySelector('[contenteditable="true"], textarea');
```

When CDP runs this in the outer `index.html` context, `document` is the container page — it has zero input elements. The inner `#active-frame` iframe is same-origin (`vscode-webview://`), so `contentDocument` is accessible, but the code never used it.

### 2. Wrong contenteditable value

Claude Code's input box is rendered as:

```html
<div class="messageInput_cKsPxg" contenteditable="plaintext-only">
```

The selector `[contenteditable="true"]` does not match `"plaintext-only"`, so even after fixing the document context, the editor would not be found.

## Fix

In `server.js`, the Claude branch of `injectMessage()` was updated to:

1. Access `#active-frame`'s `contentDocument` instead of `document`
2. Include `[contenteditable="plaintext-only"]` in the selector

```js
// Before
editor = document.querySelector('[contenteditable="true"], textarea');

// After
const frame = document.getElementById('active-frame');
const doc = frame?.contentDocument || frame?.contentWindow?.document || document;
editor = doc.querySelector('[contenteditable="plaintext-only"], [contenteditable="true"], textarea');
```

The submit button selectors were updated the same way — using `doc` instead of `document`.

## How It Was Diagnosed

1. Added `console.log` to `/send` endpoint to surface CDP injection results
2. Confirmed `/send` reached the server but returned `editor_not_found`
3. Queried all CDP targets on port 9000 — found 8 Claude-related iframes, all showing `inputs: 0`
4. Directly accessed `frame.contentDocument` via WebSocket → found `inputs: 2`
5. Inspected those 2 elements → `DIV[contenteditable="plaintext-only"]` and `INPUT[type="file"]`
6. Applied targeted fix → `ok:true, method:click_submit`

## Files Changed

- `server.js` — `injectMessage()` function, Claude branch (~line 437 and ~line 481)
