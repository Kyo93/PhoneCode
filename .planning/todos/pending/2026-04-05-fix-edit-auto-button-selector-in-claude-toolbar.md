---
created: 2026-04-05T18:19:36.812Z
title: Fix Edit Auto button selector in Claude toolbar
area: ui
files:
  - targets/claude.js
  - public/js/app.js
---

## Problem

The "Edit Auto" button in the Claude Code toolbar (`#claudeToolbar`) does not work.
The current selector in `targets/claude.js` (`performAction` and `getToolbarState`) looks for a button whose label/text contains both "edit" AND ("auto" OR "permit" OR "allow"), but the actual button in the Claude Code VS Code extension may use different text or aria-label.

The `+ File` and `/ Command` buttons work correctly. Only `Edit Auto` and `Bypass` (when no dialog is showing) don't respond.

Needs `/ui-inspect` output from the Claude Code context to find the real button label/aria-label.

## Solution

1. User visits `http://<IP>:3000/ui-inspect` while Claude Code tab is active
2. Find the "Edit automatically" button in `bestContextData.buttons` — note `text`, `ariaLabel`, `title`
3. Update the selector in `targets/claude.js`:
   - `performAction` → `toggle-edit-auto` branch (line ~249)
   - `getToolbarState` (line ~305)
4. Redeploy and test toggle behavior + visual active state
