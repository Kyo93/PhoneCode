/**
 * Antigravity Target
 * Original logic - do not modify without testing thoroughly.
 */

// Run a CDP expression across all execution contexts, return first success
async function runInContexts(cdp, expression, { awaitPromise = true } = {}) {
    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression,
                returnByValue: true,
                awaitPromise,
                contextId: ctx.id
            });
            if (result.exceptionDetails) continue;
            if (result.result?.value) return result.result.value;
        } catch (e) { }
    }
    return null;
}

// Find Antigravity CDP target in the /json/list
export function discover(list) {
    const workbench = list.find(t =>
        t.url?.includes('workbench.html') ||
        (t.title && (t.title.includes('workbench') || t.title.includes('Antigravity')))
    );
    if (workbench?.webSocketDebuggerUrl) {
        return { url: workbench.webSocketDebuggerUrl, title: workbench.title };
    }
    return null;
}

// Capture chat snapshot
export async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(async () => {
        const cascade = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');

        if (!cascade) {
            const body = document.body;
            const childIds = Array.from(body.children).map(c => c.id).filter(id => id).join(', ');
            return { error: 'chat container not found', debug: { hasBody: !!body, availableIds: childIds } };
        }

        const cascadeStyles = window.getComputedStyle(cascade);

        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight,
            scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
        };

        const clone = cascade.cloneNode(true);

        // Remove interaction/input area
        try {
            const interactionSelectors = [
                '.relative.flex.flex-col.gap-8',
                '.flex.grow.flex-col.justify-start.gap-8',
                'div[class*="interaction-area"]',
                '.p-1.bg-gray-500\\/10',
                '.outline-solid.justify-between',
                '[contenteditable="true"]'
            ];

            interactionSelectors.forEach(selector => {
                clone.querySelectorAll(selector).forEach(el => {
                    try {
                        if (selector === '[contenteditable="true"]') {
                            const area = el.closest('.relative.flex.flex-col.gap-8') ||
                                         el.closest('.flex.grow.flex-col.justify-start.gap-8') ||
                                         el.closest('div[id^="interaction"]') ||
                                         el.parentElement?.parentElement;
                            if (area && area !== clone) area.remove();
                            else el.remove();
                        } else {
                            el.remove();
                        }
                    } catch(e) {}
                });
            });

            const allElements = clone.querySelectorAll('*');
            allElements.forEach(el => {
                try {
                    const text = (el.innerText || '').toLowerCase();
                    if (text.includes('review changes') || text.includes('files with changes') || text.includes('context found')) {
                        if (el.children.length < 10 || el.querySelector('button') || el.classList?.contains('justify-between')) {
                            el.style.display = 'none';
                            el.remove();
                        }
                    }
                } catch (e) {}
            });
        } catch (globalErr) { }

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

        // Fix inline div-inside-inline-parent issue
        try {
            const inlineTags = new Set(['SPAN', 'P', 'A', 'LABEL', 'EM', 'STRONG', 'CODE']);
            const allDivs = Array.from(clone.querySelectorAll('div'));
            for (const div of allDivs) {
                try {
                    if (!div.parentNode) continue;
                    const parent = div.parentElement;
                    if (!parent) continue;

                    const parentIsInline = inlineTags.has(parent.tagName) ||
                        (parent.className && (parent.className.includes('inline-flex') || parent.className.includes('inline-block')));

                    if (parentIsInline) {
                        const span = document.createElement('span');
                        while (div.firstChild) span.appendChild(div.firstChild);
                        if (div.className) span.className = div.className;
                        if (div.getAttribute('style')) span.setAttribute('style', div.getAttribute('style'));
                        span.style.display = 'inline-flex';
                        span.style.alignItems = 'center';
                        span.style.verticalAlign = 'middle';
                        div.replaceWith(span);
                    }
                } catch(e) {}
            }
        } catch(e) {}

        const html = clone.outerHTML;

        const rules = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    rules.push(rule.cssText);
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
        } catch (e) {
            console.log(`Context ${ctx.id} connection error:`, e.message);
        }
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

// Inject message and submit
export async function injectMessage(cdp, text) {
    const safeText = JSON.stringify(text);

    const EXPRESSION = `(async () => {
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) return { ok:false, reason:"busy" };

        const editors = [...document.querySelectorAll('#conversation [contenteditable="true"], #chat [contenteditable="true"], #cascade [contenteditable="true"]')]
            .filter(el => el.offsetParent !== null);
        const editor = editors.at(-1);

        if (!editor) return { ok:false, error:"editor_not_found" };

        const textToInsert = ${safeText};

        editor.focus();
        document.execCommand?.("selectAll", false, null);
        document.execCommand?.("delete", false, null);

        let inserted = false;
        try { inserted = !!document.execCommand?.("insertText", false, textToInsert); } catch {}
        if (!inserted) {
            editor.textContent = textToInsert;
            editor.dispatchEvent(new InputEvent("beforeinput", { bubbles:true, inputType:"insertText", data: textToInsert }));
            editor.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data: textToInsert }));
        }

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const submit = document.querySelector("svg.lucide-arrow-right")?.closest("button");

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
