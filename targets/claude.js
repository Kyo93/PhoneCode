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

        // --- MutationObserver HTML cache ---
        // CONFIG RATIONALE:
        //   subtree: true     — mutations in any descendant trigger dirty (not just direct children)
        //   childList: true   — node insertions/removals (new messages, DOM updates)
        //   characterData: true — text content changes (streaming tokens, typing)
        //   attributes: true  — attribute changes (data-state, aria-*, class, hidden, style, src)
        // No attributeFilter: observe ALL attributes — prevents missed state changes from custom
        // data-* attributes used by React/VS Code components.
        //
        // FIRST-POLL BEHAVIOR: __phoneCodeLastHTML is null on init → early-return condition is
        // always false on first poll → full capture always runs regardless of dirty flag.
        if (!window.__phoneCodeObserver) {
            window.__phoneCodeMutDirty = true;     // ensure first poll is never a cache hit
            window.__phoneCodeLastHTML = null;
            window.__phoneCodeLastMeta = null;
            window.__phoneCodeObserver = new MutationObserver(() => {
                window.__phoneCodeMutDirty = true;
            });
            window.__phoneCodeObserver.observe(document.body, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true
            });
        }

        // Early return on cache hit: all three conditions must hold.
        // __phoneCodeLastHTML being null (first poll) makes this false regardless of dirty flag.
        if (!window.__phoneCodeMutDirty && window.__phoneCodeLastHTML && window.__phoneCodeLastMeta) {
            return {
                html: window.__phoneCodeLastHTML,
                // Omit css field entirely on cache hits — server keeps lastBroadcastCssHash stable.
                // Do NOT return css: null (that is a different signal meaning "CSS unchanged, send nothing").
                // Omitting the field entirely means: "this is a full cache hit, use prior CSS as-is".
                ...window.__phoneCodeLastMeta,
                stats: { ...window.__phoneCodeLastMeta.stats, cached: true }
            };
        }
        window.__phoneCodeMutDirty = false;

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

        // Convert local images to base64 — persistent LRU cache (max 50MB base64 bytes).
        // CACHE KEY: URL only. Same URL with changed content returns stale base64 until cache clear.
        // Acceptable: VS Code/Claude Code images are static icons/logos — URL stability holds.
        // FETCH ERRORS: catch(e){} + reader.onerror omit the image silently. No negative caching.
        //   Image retried on next poll — transient errors self-heal.
        // MEMORY: base64 is ~33% larger than binary; effective binary ceiling ~37MB at 50MB cap.
        if (!window.__phoneCodeImgCache) {
            window.__phoneCodeImgCache = new Map();
            window.__phoneCodeImgCacheBytes = 0;
        }
        const imgCache = window.__phoneCodeImgCache;
        const IMG_CACHE_MAX_BYTES = 50 * 1024 * 1024; // 50MB cap (base64 string bytes)

        const t0 = performance.now();
        const images = clone.querySelectorAll('img');
        const promises = Array.from(images).map(async (img) => {
            const rawSrc = img.getAttribute('src');
            if (!rawSrc || rawSrc.startsWith('data:')) return;
            if (!rawSrc.startsWith('/') && !rawSrc.startsWith('vscode-file:')) return;

            // Cache hit: refresh LRU position (delete + re-set moves entry to end of Map)
            if (imgCache.has(rawSrc)) {
                const cached = imgCache.get(rawSrc);
                imgCache.delete(rawSrc);
                imgCache.set(rawSrc, cached);
                img.src = cached;
                return;
            }

            try {
                const res = await fetch(rawSrc);
                // Size check 1: Content-Length header (avoids full download for oversized resources)
                const contentLength = res.headers.get('content-length');
                if (contentLength && parseInt(contentLength) > 512000) return;
                const blob = await res.blob();
                // Size check 2: actual blob size (Content-Length may be absent or inaccurate)
                if (blob.size > 512000) return;
                await new Promise(r => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const result = reader.result;
                        imgCache.set(rawSrc, result);
                        window.__phoneCodeImgCacheBytes += result.length;
                        // Evict oldest entries until under cap (O(n) over cache size, acceptable at <50 images)
                        while (window.__phoneCodeImgCacheBytes > IMG_CACHE_MAX_BYTES && imgCache.size > 0) {
                            const oldest = imgCache.keys().next().value;
                            window.__phoneCodeImgCacheBytes -= imgCache.get(oldest).length;
                            imgCache.delete(oldest);
                        }
                        img.src = result;
                        r();
                    };
                    reader.onerror = () => r(); // FileReader error: omit image, no crash
                    reader.readAsDataURL(blob);
                });
            } catch(e) {
                // Fetch failure (network, CORS): omit image silently. No negative caching — retry next poll.
            }
        });
        await Promise.all(promises);
        const imgMs = Math.round(performance.now() - t0);

        const html = clone.outerHTML;

        // CSS fingerprint — detects stylesheet add/remove and content changes.
        // External sheets: href + ruleCount + first-rule sample (64 chars).
        //   ruleCount alone misses in-place value changes (CSS variables, color tweaks) without
        //   adding or removing rules. First-rule sample provides cheap collision discriminator.
        // Inline <style>: hash ownerNode.textContent to catch any content change.
        // Cross-origin sheets (SecurityError on cssRules): caught below → '|blocked:N' (stable
        //   by sheet index). Acceptable: cross-origin rules can't be collected either, so their
        //   CSS contribution is always empty regardless of fingerprint outcome.
        const tCss0 = performance.now();
        const cssFingerprint = Array.from(document.styleSheets).reduce((acc, s, i) => {
            try {
                if (s.href) {
                    // External stylesheet: href + rule count + first-rule content sample.
                    const firstRule = s.cssRules.length > 0 ? s.cssRules[0].cssText.slice(0, 64) : '';
                    return acc + '|' + s.href + ':' + s.cssRules.length + ':' + firstRule;
                } else {
                    // Inline <style>: hash content to avoid collision when rule counts match.
                    const content = s.ownerNode?.textContent || '';
                    let h = 0;
                    for (let j = 0; j < content.length; j++) {
                        h = (Math.imul(31, h) + content.charCodeAt(j)) | 0;
                    }
                    return acc + '|inline' + i + ':' + h;
                }
            } catch(e) {
                // Cross-origin sheet or other access error — stable index-based fingerprint.
                // CSS collection also skips these sheets (same SecurityError), so output is unaffected.
                return acc + '|blocked:' + i;
            }
        }, '');

        let allCSS;
        if (cssFingerprint === window.__phoneCodeCSSFingerprint && window.__phoneCodeCSSCache) {
            // Stylesheets unchanged — signal cache hit by returning null. Server keeps prior CSS.
            allCSS = null;
        } else {
            // Fingerprint changed (or first poll) — collect all CSS rules.
            const rules = [];
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        let text = rule.cssText;
                        // NOTE: Use \\s and \\d (double-backslash) inside template literal.
                        // Single \s becomes literal 's' when the string is evaluated — regex broken.
                        // This also fixes a pre-existing escaping bug in the original claude.js code.
                        text = text
                            .replace(/position\s*:\s*fixed/gi, 'position: relative')
                            .replace(/position\s*:\s*sticky/gi, 'position: relative')
                            .replace(/z-index\s*:\s*\d{3,}/gi, 'z-index: 1')
                            .replace(/height\s*:\s*100vh/gi, 'height: auto')
                            .replace(/min-height\s*:\s*100vh/gi, 'min-height: 0');
                        rules.push(text);
                    }
                } catch(e) {}
            }
            allCSS = rules.join('\\n');
            window.__phoneCodeCSSFingerprint = cssFingerprint;
            window.__phoneCodeCSSCache = allCSS;
        }
        const cssMs = Math.round(performance.now() - tCss0);

        window.__phoneCodeLastHTML = html;
        window.__phoneCodeLastMeta = {
            backgroundColor: cascadeStyles.backgroundColor,
            color: cascadeStyles.color,
            fontFamily: cascadeStyles.fontFamily,
            scrollInfo,
            stats: {
                nodes: clone.getElementsByTagName('*').length,
                htmlSize: html.length,
                cssSize: allCSS ? allCSS.length : 0,
                imgMs,
                imgCached: Array.from(images).filter(i => imgCache.has(i.getAttribute('src'))).length,
                imgTotal: images.length,
                cssMs,
                cssCached: allCSS === null,
                cached: false
            }
        };

        return {
            html,
            css: allCSS,
            backgroundColor: cascadeStyles.backgroundColor,
            color: cascadeStyles.color,
            fontFamily: cascadeStyles.fontFamily,
            scrollInfo,
            stats: window.__phoneCodeLastMeta.stats
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

// Invalidate browser-side image and CSS caches (called on target switch or CDP reconnect).
// Safe to call before Plan 05-02 is deployed — CSS globals default to undefined/null.
export async function invalidateSnapshotCache(cdp) {
    const CLEAR_SCRIPT = `
        if (window.__phoneCodeImgCache) window.__phoneCodeImgCache.clear();
        window.__phoneCodeImgCacheBytes = 0;
        if (window.__phoneCodeCSSFingerprint !== undefined) {
            window.__phoneCodeCSSFingerprint = null;
            window.__phoneCodeCSSCache = null;
        }
    `;
    for (const ctx of cdp.contexts) {
        try {
            await cdp.call("Runtime.evaluate", {
                expression: CLEAR_SCRIPT,
                returnByValue: false,
                contextId: ctx.id
            });
        } catch(e) {}
    }
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
        if (!editor) return { ok:false, error:"editor_not_found", frameFound: !!frame, url: location.href };

        const textToInsert = ${safeText};

        editor.focus();

        let inserted = false;
        try { inserted = !!document.execCommand?.('insertText', false, textToInsert); } catch {}
        if (!inserted) {
            editor.textContent = textToInsert;
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
            return { ok:true, method:"click_submit" };
        }

        const enterEvt = { bubbles: true, cancelable: true, key: "Enter", code: "Enter", charCode: 13, keyCode: 13, which: 13 };
        editor.dispatchEvent(new KeyboardEvent("keydown", enterEvt));
        editor.dispatchEvent(new KeyboardEvent("keypress", enterEvt));
        editor.dispatchEvent(new KeyboardEvent("keyup", enterEvt));

        return { ok:true, method:"enter_keypress" };
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

// Check if Claude Code has an active session (iframe loaded with content)
export async function hasChatOpen(cdp) {
    const EXPRESSION = `(() => {
        const frame = document.getElementById('active-frame');
        if (!frame) return { hasChat: false, hasMessages: false, editorFound: false };
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc || !doc.body) return { hasChat: false, hasMessages: false, editorFound: false };
        const editorFound = !!doc.querySelector('[contenteditable="plaintext-only"], [contenteditable="true"]');
        const hasMessages = doc.body.children.length > 0;
        return { hasChat: hasMessages, hasMessages, editorFound };
    })()`;

    const attempts = [null, ...cdp.contexts.map(c => c.id)];
    for (const contextId of attempts) {
        try {
            const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: false };
            if (contextId) params.contextId = contextId;
            const result = await cdp.call("Runtime.evaluate", params);
            if (result.result?.value) return result.result.value;
        } catch (e) { }
    }
    return { hasChat: false, hasMessages: false, editorFound: false };
}

// Detect AskUserQuestion UI and extract structured data
// Supports multiple questions (1-4) with tab navigation
export async function detectQuestion(cdp) {
    const EXPRESSION = `(() => {
        try {
            // Find "Submit answers" button as anchor point
            const allBtns = Array.from(document.querySelectorAll('button'));
            const submitBtn = allBtns.find(b => {
                if (!b.offsetParent) return false;
                const txt = (b.textContent || '').trim().toLowerCase();
                return /submit\\s+answer/i.test(txt);
            });
            if (!submitBtn) return { detected: false };

            // Walk up to find the permission request container
            let container = submitBtn;
            for (let i = 0; i < 10; i++) {
                container = container.parentElement;
                if (!container) return { detected: false };
                const hasOptions = container.querySelectorAll('[role="radio"], [role="checkbox"]').length > 0;
                if (hasOptions) break;
            }
            if (!container) return { detected: false };

            // Detect navigation tabs (multiple questions)
            const navTabs = Array.from(container.querySelectorAll('[class*="navTab_"]'));
            const tabLabels = navTabs.map(tab => {
                const labelEl = tab.querySelector('[class*="navTabLabel"]');
                return {
                    label: labelEl ? (labelEl.textContent || '').trim() : (tab.textContent || '').trim(),
                    active: tab.className.includes('navTabActive')
                };
            });
            const activeTabIndex = tabLabels.findIndex(t => t.active);

            // Extract all question blocks
            const questionBlocks = Array.from(container.querySelectorAll('[class*="questionBlock"]'));
            const questions = [];

            questionBlocks.forEach((block, qi) => {
                const questionEl = block.querySelector('[class*="questionTextLarge"]');
                const questionText = questionEl ? (questionEl.textContent || '').trim() : '';

                // Category from question header
                const headerEl = block.querySelector('[class*="questionHeader"] [class*="questionCategory"], [class*="questionHeader"] span:first-child');
                let category = '';
                if (headerEl && headerEl !== questionEl) {
                    const catText = (headerEl.textContent || '').trim();
                    if (catText && catText !== questionText && catText.length < 40) {
                        category = catText;
                    }
                }

                // Find options within this block
                const optionEls = Array.from(block.querySelectorAll('[role="radio"], [role="checkbox"]'));
                const multiSelect = optionEls.length > 0 && optionEls[0].getAttribute('role') === 'checkbox';

                const options = optionEls.map((el, i) => {
                    const selected = el.getAttribute('aria-checked') === 'true';
                    const labelEl = el.querySelector('[class*="optionLabel"]');
                    const descEl = el.querySelector('[class*="optionDescription"]');
                    const label = labelEl ? (labelEl.textContent || '').trim() : (el.textContent || '').trim();
                    const isOther = label.toLowerCase() === 'other';
                    const description = descEl ? (descEl.textContent || '').trim() : '';
                    // Other text = full textContent minus the label "Other"
                    const otherText = isOther ? (el.textContent || '').replace(/^\\s*Other\\s*/, '').trim() : undefined;

                    return { index: i, label, description, isOther, selected, otherText };
                });

                questions.push({ category, question: questionText, options, multiSelect });
            });

            // Fallback: if no questionBlock found, extract from container directly
            if (questions.length === 0) {
                const questionEl = container.querySelector('[class*="questionTextLarge"]');
                const questionText = questionEl ? (questionEl.textContent || '').trim() : '';
                const optionEls = Array.from(container.querySelectorAll('[role="radio"], [role="checkbox"]'));
                const multiSelect = optionEls.length > 0 && optionEls[0].getAttribute('role') === 'checkbox';
                const options = optionEls.map((el, i) => {
                    const selected = el.getAttribute('aria-checked') === 'true';
                    const labelEl = el.querySelector('[class*="optionLabel"]');
                    const descEl = el.querySelector('[class*="optionDescription"]');
                    const label = labelEl ? (labelEl.textContent || '').trim() : (el.textContent || '').trim();
                    const isOther = label.toLowerCase() === 'other';
                    const description = descEl ? (descEl.textContent || '').trim() : '';
                    const otherText = isOther ? (el.textContent || '').replace(/^\\s*Other\\s*/, '').trim() : undefined;
                    return { index: i, label, description, isOther, selected, otherText };
                });
                questions.push({ category: '', question: questionText, options, multiSelect });
            }

            const submitText = (submitBtn.textContent || '').trim();

            // Backward compat: also expose first question's fields at top level
            return {
                detected: true,
                category: questions[0]?.category || '',
                question: questions[0]?.question || '',
                options: questions[0]?.options || [],
                multiSelect: questions[0]?.multiSelect || false,
                submitText,
                questions,
                tabs: tabLabels,
                activeTab: activeTabIndex >= 0 ? activeTabIndex : 0
            };
        } catch (e) {
            return { detected: false, error: e.toString() };
        }
    })()`;

    const attempts = [null, ...cdp.contexts.map(c => c.id)];
    for (const contextId of attempts) {
        try {
            const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: false };
            if (contextId) params.contextId = contextId;
            const result = await cdp.call("Runtime.evaluate", params);
            if (result.result?.value?.detected) return result.result.value;
        } catch (e) { }
    }
    return { detected: false };
}

// Click an option in AskUserQuestion by index
export async function selectOption(cdp, optionIndex) {
    const safeIndex = parseInt(optionIndex, 10);
    const EXPRESSION = `(() => {
        try {
            // Find submit button and walk up to container
            const allBtns = Array.from(document.querySelectorAll('button'));
            const submitBtn = allBtns.find(b => b.offsetParent && /submit\\s+answer/i.test((b.textContent || '').trim()));
            if (!submitBtn) return { ok: false, error: 'no submit button' };

            let container = submitBtn;
            for (let i = 0; i < 10; i++) {
                container = container.parentElement;
                if (!container) return { ok: false, error: 'no container' };
                if (container.querySelectorAll('[role="radio"], [role="checkbox"]').length > 0) break;
            }

            const optionEls = Array.from(container.querySelectorAll('[role="radio"], [role="checkbox"]'));
            const target = optionEls[${safeIndex}];
            if (!target) return { ok: false, error: 'option not found at index ${safeIndex}', total: optionEls.length };

            // Click the option div to trigger React handler
            target.click();

            // Read back all states
            const selections = optionEls.map((el, i) => ({
                index: i,
                selected: el.getAttribute('aria-checked') === 'true'
            }));
            return { ok: true, selections };
        } catch (e) {
            return { ok: false, error: e.toString() };
        }
    })()`;

    const attempts = [null, ...cdp.contexts.map(c => c.id)];
    for (const contextId of attempts) {
        try {
            const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: false };
            if (contextId) params.contextId = contextId;
            const result = await cdp.call("Runtime.evaluate", params);
            if (result.result?.value?.ok) return result.result.value;
        } catch (e) { }
    }
    return { ok: false, error: 'no context' };
}

// Debug: dump DOM structure around the AskUserQuestion UI
export async function debugQuestionDOM(cdp) {
    const EXPRESSION = `(() => {
        try {
            const allBtns = Array.from(document.querySelectorAll('button'));
            const submitBtn = allBtns.find(b => {
                if (!b.offsetParent) return false;
                const txt = (b.textContent || '').trim().toLowerCase();
                return /submit\\s+answer/i.test(txt);
            });
            if (!submitBtn) return { found: false, reason: 'no submit button' };

            let container = submitBtn;
            let walkSteps = 0;
            for (let i = 0; i < 15; i++) {
                container = container.parentElement;
                walkSteps++;
                if (!container) break;
                if (container.children.length >= 3) break;
            }
            if (!container) return { found: false, reason: 'no container' };

            function dumpNode(el, depth) {
                if (depth > 8) return '';
                const tag = el.tagName?.toLowerCase() || '?';
                const attrs = [];
                if (el.type) attrs.push('type=' + el.type);
                if (el.getAttribute && el.getAttribute('role')) attrs.push('role=' + el.getAttribute('role'));
                if (el.getAttribute && el.getAttribute('aria-checked') !== null) attrs.push('aria-checked=' + el.getAttribute('aria-checked'));
                if (el.getAttribute && el.getAttribute('aria-selected') !== null) attrs.push('aria-selected=' + el.getAttribute('aria-selected'));
                if (el.getAttribute && el.getAttribute('data-state')) attrs.push('data-state=' + el.getAttribute('data-state'));
                if (el.className && typeof el.className === 'string') attrs.push('class=' + el.className.slice(0, 80));
                let ownTxt = '';
                for (const node of el.childNodes) {
                    if (node.nodeType === 3) ownTxt += node.textContent;
                }
                ownTxt = ownTxt.trim().slice(0, 80);
                const attrStr = attrs.length ? ' [' + attrs.join(', ') + ']' : '';
                const textStr = ownTxt ? ' "' + ownTxt + '"' : '';
                const indent = '  '.repeat(depth);
                let result = indent + '<' + tag + '>' + attrStr + textStr + '\\n';
                for (const child of el.children) {
                    result += dumpNode(child, depth + 1);
                }
                return result;
            }

            const dump = dumpNode(container, 0);
            const inputs = Array.from(container.querySelectorAll('input'));
            const inputInfo = inputs.map(i => ({ type: i.type, checked: i.checked, visible: !!i.offsetParent }));
            const roleCheckboxes = Array.from(container.querySelectorAll('[role="checkbox"], [role="radio"], [role="option"], [role="menuitemcheckbox"]'));
            const roleInfo = roleCheckboxes.map(el => ({
                tag: el.tagName?.toLowerCase(),
                role: el.getAttribute('role'),
                ariaChecked: el.getAttribute('aria-checked'),
                text: (el.textContent || '').trim().slice(0, 60)
            }));
            const dataStateEls = Array.from(container.querySelectorAll('[data-state]'));
            const dataStateInfo = dataStateEls.map(el => ({
                tag: el.tagName?.toLowerCase(),
                dataState: el.getAttribute('data-state'),
                role: el.getAttribute('role'),
                text: (el.textContent || '').trim().slice(0, 40)
            }));

            return { found: true, walkSteps, domDump: dump, inputs: inputInfo, roleCheckboxes: roleInfo, dataStateElements: dataStateInfo };
        } catch (e) {
            return { found: false, error: e.toString() };
        }
    })()`;

    const attempts = [null, ...cdp.contexts.map(c => c.id)];
    for (const contextId of attempts) {
        try {
            const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: false };
            if (contextId) params.contextId = contextId;
            const result = await cdp.call("Runtime.evaluate", params);
            if (result.result?.value?.found) return result.result.value;
        } catch (e) { }
    }
    return { found: false, error: 'no context' };
}

// Navigate between questions by clicking nav tabs
// direction: 'next', 'prev', or a tab index number
export async function navigateQuestion(cdp, direction) {
    const safeDir = JSON.stringify(direction);
    const EXPRESSION = `(() => {
        try {
            const tabs = Array.from(document.querySelectorAll('[class*="navTab_"]'));
            if (tabs.length === 0) return { ok: false, error: 'no nav tabs found' };

            const activeIdx = tabs.findIndex(t => t.className.includes('navTabActive'));
            const dir = ${safeDir};
            let targetIdx;

            if (dir === 'next') {
                targetIdx = Math.min(activeIdx + 1, tabs.length - 1);
            } else if (dir === 'prev') {
                targetIdx = Math.max(activeIdx - 1, 0);
            } else {
                targetIdx = parseInt(dir, 10);
            }

            if (targetIdx < 0 || targetIdx >= tabs.length) return { ok: false, error: 'index out of range' };
            if (targetIdx === activeIdx) return { ok: true, same: true, current: activeIdx, total: tabs.length };

            tabs[targetIdx].click();
            return { ok: true, from: activeIdx, to: targetIdx, total: tabs.length };
        } catch (e) {
            return { ok: false, error: e.toString() };
        }
    })()`;

    const attempts = [null, ...cdp.contexts.map(c => c.id)];
    for (const contextId of attempts) {
        try {
            const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: false };
            if (contextId) params.contextId = contextId;
            const result = await cdp.call("Runtime.evaluate", params);
            if (result.result?.value?.ok) return result.result.value;
        } catch (e) { }
    }
    return { ok: false, error: 'no context' };
}

// Set "Other" text in Claude Code's AskUserQuestion
// Strategy: find Other's text div → focus → select all → type via CDP
export async function setOtherText(cdp, text) {
    // Step 1: Focus the Other text area
    const FOCUS = `(() => {
        try {
            const submitBtn = Array.from(document.querySelectorAll('button'))
                .find(b => b.offsetParent && /submit\\s+answer/i.test(b.textContent || ''));
            if (!submitBtn) return { ok: false, error: 'no submit btn' };
            let c = submitBtn;
            for (let i = 0; i < 10 && c; i++) { c = c.parentElement; if (c?.querySelectorAll('[role="radio"],[role="checkbox"]').length) break; }
            if (!c) return { ok: false, error: 'no container' };

            // Find Other option and ensure selected
            const opts = Array.from(c.querySelectorAll('[role="radio"],[role="checkbox"]'));
            const other = opts.find(el => (el.querySelector('[class*="optionLabel"]')?.textContent || '').trim().toLowerCase() === 'other');
            if (!other) return { ok: false, error: 'no Other option' };
            if (other.getAttribute('aria-checked') !== 'true') other.click();

            // Find text div: second child of optionContent (first is optionLabel)
            const content = other.querySelector('[class*="optionContent"]');
            if (!content || content.children.length < 2) return { ok: false, error: 'no text div' };
            const textDiv = content.children[1];

            // Focus and select all content
            textDiv.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(textDiv);
            sel.removeAllRanges();
            sel.addRange(range);
            return { ok: true };
        } catch (e) { return { ok: false, error: e.toString() }; }
    })()`;

    let focused = false;
    for (const contextId of [null, ...cdp.contexts.map(c => c.id)]) {
        try {
            const r = await cdp.call("Runtime.evaluate", { expression: FOCUS, returnByValue: true, awaitPromise: false, ...(contextId && { contextId }) });
            if (r.result?.value?.ok) { focused = true; break; }
        } catch (e) { }
    }
    if (!focused) return { ok: false, error: 'could not focus Other text' };

    // Step 2: Delete selected text + type new text via CDP
    try {
        await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
        await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
        await cdp.call("Input.insertText", { text });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.toString() };
    }
}

// Click the "Submit answers" button
export async function submitAnswer(cdp) {
    const EXPRESSION = `(() => {
        try {
            const allBtns = Array.from(document.querySelectorAll('button'));
            const submitBtn = allBtns.find(b => b.offsetParent && /submit\\s+answer/i.test((b.textContent || '').trim()));
            if (!submitBtn) return { ok: false, error: 'submit button not found' };
            submitBtn.click();
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e.toString() };
        }
    })()`;

    const attempts = [null, ...cdp.contexts.map(c => c.id)];
    for (const contextId of attempts) {
        try {
            const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: false };
            if (contextId) params.contextId = contextId;
            const result = await cdp.call("Runtime.evaluate", params);
            if (result.result?.value?.ok) return result.result.value;
        } catch (e) { }
    }
    return { ok: false, error: 'no context submitAnswer' };
}

// Cancel AskUserQuestion by pressing Escape via CDP Input API
export async function cancelQuestion(cdp) {
    try {
        // Use CDP Input.dispatchKeyEvent — works at browser level, not DOM level
        await cdp.call("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
            nativeVirtualKeyCode: 27
        });
        await cdp.call("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
            nativeVirtualKeyCode: 27
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.toString() };
    }
}
