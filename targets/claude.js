/**
 * Claude Code Target
 * Claude Code VS Code extension support.
 * Isolated from Antigravity - changes here do not affect Antigravity stability.
 *
 * Key differences from Antigravity:
 * - UI renders inside <iframe id="active-frame"> (same-origin, accessible via contentDocument)
 * - Input element is <div contenteditable="plaintext-only"> not "true"
 * - Snapshot root is document.body (no #cascade container)
 * - Inline styles must be normalized for mobile scrolling
 */

// Find Claude Code CDP target in the /json/list
// Claude has multiple iframes with the same extensionId - prioritize purpose=webviewView (outer container)
export function discover(list) {
    const claudeTargets = list.filter(t =>
        t.url?.includes('extensionId=Anthropic.claude-code') ||
        t.title?.includes('Claude Code')
    );
    if (claudeTargets.length === 0) return null;

    const viewTarget = claudeTargets.find(t => t.url?.includes('purpose=webviewView'));
    const best = viewTarget || claudeTargets[claudeTargets.length - 1];

    if (best?.webSocketDebuggerUrl) {
        return { url: best.webSocketDebuggerUrl, title: best.title };
    }
    return null;
}

// Capture Claude Code UI snapshot
// Root is document.body; inline styles are normalized to allow mobile scrolling
export async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(async () => {
        const cascade = document.body;
        if (!cascade) return { error: 'document.body not found' };

        const cascadeStyles = window.getComputedStyle(cascade);

        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight,
            scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
        };

        const clone = cascade.cloneNode(true);

        // Normalize inline styles that break mobile scrolling
        clone.querySelectorAll('*').forEach(el => {
            try {
                const s = el.getAttribute('style');
                if (!s) return;
                let ns = s
                    .replace(/position\\s*:\\s*fixed/gi, 'position: relative')
                    .replace(/position\\s*:\\s*absolute/gi, 'position: relative')
                    .replace(/overflow\\s*:\\s*hidden/gi, 'overflow: visible')
                    .replace(/overflow-y\\s*:\\s*hidden/gi, 'overflow-y: visible')
                    .replace(/height\\s*:\\s*100vh/gi, 'height: auto')
                    .replace(/min-height\\s*:\\s*100vh/gi, 'min-height: 0')
                    .replace(/height\\s*:\\s*100%/gi, 'height: auto');
                if (ns !== s) el.setAttribute('style', ns);
            } catch(e) {}
        });

        // Convert local images to base64
        const images = clone.querySelectorAll('img');
        const promises = Array.from(images).map(async (img) => {
            const rawSrc = img.getAttribute('src');
            if (rawSrc && (rawSrc.startsWith('/') || rawSrc.startsWith('vscode-file:')) && !rawSrc.startsWith('data:')) {
                try {
                    const res = await fetch(rawSrc);
                    const blob = await res.blob();
                    await new Promise(r => {
                        const reader = new FileReader();
                        reader.onloadend = () => { img.src = reader.result; r(); };
                        reader.onerror = () => r();
                        reader.readAsDataURL(blob);
                    });
                } catch(e) {}
            }
        });
        await Promise.all(promises);

        const html = clone.outerHTML;

        const rules = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    let text = rule.cssText;
                    // Strip fixed/absolute positioning and high z-index to prevent overlays blocking phone touch
                    text = text
                        .replace(/position\s*:\s*fixed/gi, 'position: relative')
                        .replace(/position\s*:\s*sticky/gi, 'position: relative')
                        .replace(/z-index\s*:\s*\d{3,}/gi, 'z-index: 1')
                        .replace(/height\s*:\s*100vh/gi, 'height: auto')
                        .replace(/min-height\s*:\s*100vh/gi, 'min-height: 0');
                    rules.push(text);
                }
            } catch (e) { }
        }
        const allCSS = rules.join('\\n');

        return {
            html,
            css: allCSS,
            backgroundColor: cascadeStyles.backgroundColor,
            color: cascadeStyles.color,
            fontFamily: cascadeStyles.fontFamily,
            scrollInfo,
            stats: {
                nodes: clone.getElementsByTagName('*').length,
                htmlSize: html.length,
                cssSize: allCSS.length
            }
        };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (result.exceptionDetails) continue;
            if (result.result?.value) {
                const val = result.result.value;
                if (!val.error) return val;
            }
        } catch (e) { }
    }
    return null;
}

// Inject message into Claude Code
// UI lives inside <iframe id="active-frame"> - must use contentDocument to access it
// Input is <div contenteditable="plaintext-only">, not the "true" value Antigravity uses
export async function injectMessage(cdp, text) {
    const safeText = JSON.stringify(text);

    const EXPRESSION = `(async () => {
        // Try direct document first (same approach as captureSnapshot which works)
        // Then fall back to active-frame iframe if needed
        let doc = document;
        let win = window;

        const frame = document.getElementById('active-frame');
        if (frame?.contentDocument) {
            const frameEditor = frame.contentDocument.querySelector('[contenteditable="plaintext-only"], [contenteditable="true"], textarea');
            if (frameEditor) {
                doc = frame.contentDocument;
                win = frame.contentWindow;
            }
        }

        const editor = doc.querySelector('[contenteditable="plaintext-only"], [contenteditable="true"], textarea');
        const allEditors = [...document.querySelectorAll('[contenteditable]')].map(e => ({ tag: e.tagName, ce: e.getAttribute('contenteditable'), id: e.id, cls: e.className.substring(0,40) }));
        if (!editor) return { ok:false, error:"editor_not_found", frameFound: !!frame, frameHasDoc: !!frame?.contentDocument, allEditors, url: location.href };

        const textToInsert = ${safeText};

        editor.focus();

        // Select all existing content first so insertText replaces it
        const sel = win.getSelection?.() || window.getSelection();
        if (sel) {
            const range = doc.createRange();
            range.selectNodeContents(editor);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // Must use doc.execCommand (iframe doc), not document (outer doc)
        let inserted = false;
        try { inserted = !!doc.execCommand('insertText', false, textToInsert); } catch {}
        const editorContentAfter = editor.textContent?.substring(0, 50);
        if (!inserted) {
            // React-compatible fallback: use nativeInputValueSetter trick
            const proto = Object.getOwnPropertyDescriptor(win.HTMLElement.prototype, 'textContent') ||
                          Object.getOwnPropertyDescriptor(win.Node.prototype, 'textContent');
            if (proto?.set) {
                proto.set.call(editor, textToInsert);
            } else {
                editor.textContent = textToInsert;
            }
            editor.dispatchEvent(new InputEvent('beforeinput', { bubbles:true, inputType:'insertText', data: textToInsert }));
            editor.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data: textToInsert }));
        }

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        // Find submit button inside the same iframe doc
        // Exclude cancel/stop buttons to avoid interrupting ongoing responses
        function isStopBtn(b) {
            const label = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
            return label.includes('stop') || label.includes('cancel') || label.includes('interrupt')
                || !!b.querySelector('svg.lucide-square, svg.lucide-circle-stop');
        }

        const submit = (!isStopBtn(doc.querySelector('button[aria-label="Send"]') || document.createElement('button')) && doc.querySelector('button[aria-label="Send"]'))
            || (!isStopBtn(doc.querySelector('button[title="Send"]') || document.createElement('button')) && doc.querySelector('button[title="Send"]'))
            || doc.querySelector('button[aria-label="Send Message"]')
            || (() => {
                const byIcon = doc.querySelector('button svg.lucide-arrow-up, button svg.lucide-send, button svg.lucide-corner-down-left')?.closest('button');
                if (byIcon && !byIcon.disabled && !isStopBtn(byIcon)) return byIcon;
                return null;
            })();

        if (submit && !submit.disabled) {
            submit.click();
            return { ok:true, method:"click_submit", inserted, editorContentAfter };
        }

        const enterEvt = { bubbles: true, cancelable: true, key: "Enter", code: "Enter", charCode: 13, keyCode: 13, which: 13 };
        editor.dispatchEvent(new KeyboardEvent("keydown", enterEvt));
        editor.dispatchEvent(new KeyboardEvent("keypress", enterEvt));
        editor.dispatchEvent(new KeyboardEvent("keyup", enterEvt));

        return { ok:true, method:"enter_keypress", inserted, editorContentAfter, submitFound: !!submit };
    })()`;

    // Try without contextId first (main/default context), then each known context
    const attempts = [null, ...cdp.contexts.map(c => c.id)];
    for (const contextId of attempts) {
        try {
            const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: true };
            if (contextId) params.contextId = contextId;
            const result = await cdp.call("Runtime.evaluate", params);
            if (result.exceptionDetails) continue;
            if (result.result?.value) return result.result.value;
        } catch (e) { }
    }
    return { ok: false, reason: "no_context", contexts: cdp.contexts.length };
}

// Perform a toolbar action in Claude Code
// Actions: 'add-file' | 'slash-command' | 'toggle-edit-auto' | 'bypass'
export async function performAction(cdp, action) {
    const safeAction = JSON.stringify(action);

    const EXPRESSION = `(async () => {
        const frame = document.getElementById('active-frame');
        const doc = frame?.contentDocument || frame?.contentWindow?.document || document;
        if (!doc) return { ok: false, error: 'no_doc' };

        const act = ${safeAction};

        if (act === 'add-file') {
            // Click the + (add context/file) button in the toolbar
            const btn = Array.from(doc.querySelectorAll('button')).find(b => {
                if (!b.offsetParent) return false;
                const hasPlus = b.querySelector('svg.lucide-plus, svg.lucide-paperclip, svg.lucide-at-sign');
                const label = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
                return hasPlus || label.includes('add') || label.includes('attach') || label.includes('file');
            });
            if (!btn) return { ok: false, error: 'add-file button not found' };
            btn.click();
            return { ok: true };
        }

        if (act === 'slash-command') {
            // Inject "/" into editor to open command palette
            const editor = doc.querySelector('[contenteditable="plaintext-only"], [contenteditable="true"]');
            if (!editor) return { ok: false, error: 'editor not found' };
            editor.focus();
            // Clear then insert "/"
            const sel = doc.getSelection?.() || window.getSelection();
            sel?.selectAllChildren?.(editor);
            let inserted = false;
            try { inserted = !!document.execCommand?.('insertText', false, '/'); } catch {}
            if (!inserted) {
                editor.textContent = '/';
                editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: '/' }));
                editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '/' }));
            }
            return { ok: true };
        }

        if (act === 'toggle-edit-auto') {
            // Click the "Edit automatically" toggle button
            const btn = Array.from(doc.querySelectorAll('button')).find(b => {
                if (!b.offsetParent) return false;
                const label = (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').toLowerCase();
                return label.includes('edit') && (label.includes('auto') || label.includes('permit') || label.includes('allow'));
            });
            if (!btn) return { ok: false, error: 'edit-auto button not found' };
            btn.click();
            return { ok: true };
        }

        if (act === 'bypass') {
            // Click any visible Allow / Yes / Approve / Don't ask button (permission dialogs)
            const keywords = ['allow', "don't ask", 'yes, proceed', 'approve', 'accept', 'permit', 'yes'];
            const allBtns = Array.from(document.querySelectorAll('button')); // search full page, dialog may be outside iframe
            const btn = allBtns.find(b => {
                if (!b.offsetParent) return false;
                const txt = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase().trim();
                return keywords.some(k => txt.includes(k));
            });
            if (btn) { btn.click(); return { ok: true, method: 'dialog_button' }; }

            // Fallback: look inside iframe doc too
            const iframeBtns = Array.from(doc.querySelectorAll('button'));
            const iframeBtn = iframeBtns.find(b => {
                if (!b.offsetParent) return false;
                const txt = (b.textContent || '').toLowerCase().trim();
                return keywords.some(k => txt.includes(k));
            });
            if (iframeBtn) { iframeBtn.click(); return { ok: true, method: 'iframe_button' }; }

            return { ok: false, error: 'No permission dialog found' };
        }

        return { ok: false, error: 'Unknown action: ' + act };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (result.result?.value) return result.result.value;
        } catch (e) { }
    }
    return { ok: false, reason: "no_context" };
}

// Get current state of the Edit Auto toggle
export async function getToolbarState(cdp) {
    const EXPRESSION = `(() => {
        const frame = document.getElementById('active-frame');
        const doc = frame?.contentDocument || frame?.contentWindow?.document || document;
        if (!doc) return { editAuto: null };
        const btn = Array.from(doc.querySelectorAll('button')).find(b => {
            const label = (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').toLowerCase();
            return label.includes('edit') && (label.includes('auto') || label.includes('permit') || label.includes('allow'));
        });
        if (!btn) return { editAuto: null };
        // Detect active state via aria-pressed or visual class
        const pressed = btn.getAttribute('aria-pressed');
        const active = pressed === 'true' || btn.classList.toString().includes('active') || btn.classList.toString().includes('on');
        return { editAuto: active, label: btn.textContent?.trim().substring(0, 40) };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: false,
                contextId: ctx.id
            });
            if (result.result?.value) return result.result.value;
        } catch (e) { }
    }
    return { editAuto: null };
}
