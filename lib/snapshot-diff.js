import { DiffDOM, nodeToObj } from 'diff-dom';
import { parseHTML } from 'linkedom';

const dd = new DiffDOM({ maxChildCount: false });

// Options for nodeToObj serialization — simplifiedElementCheck avoids requiring
// a global `Element` constructor (not present in Node.js / linkedom environments).
const NODE_TO_OBJ_OPTS = { valueDiffing: true, simplifiedElementCheck: true };

// Cache the previous snapshot as a pre-serialized virtual DOM object.
// Storing the virtual DOM (post-nodeToObj) rather than the raw linkedom
// document means we skip both re-parsing AND re-serializing on the hot path.
let cachedPrevVDom = null;
let cachedPrevHtml = null;

/**
 * Compute structural diff between two HTML strings.
 * Returns null if diff cannot be computed (caller falls back to full snapshot).
 * @param {string} oldHtml
 * @param {string} newHtml
 * @returns {{ diff: Array, sizeBytes: number, latencyMs: number } | null}
 */
export function computeSnapshotDiff(oldHtml, newHtml) {
    const t0 = Date.now();
    try {
        // Reuse cached previous virtual DOM if HTML hasn't changed — halves serialization work.
        let oldVDom;
        if (cachedPrevHtml === oldHtml && cachedPrevVDom) {
            oldVDom = cachedPrevVDom;
        } else {
            const { document: oldDoc } = parseHTML(`<div id="_root">${oldHtml}</div>`);
            oldVDom = nodeToObj(oldDoc.getElementById('_root'), NODE_TO_OBJ_OPTS);
            cachedPrevHtml = oldHtml;
            cachedPrevVDom = oldVDom;
        }

        const { document: newDoc } = parseHTML(`<div id="_root">${newHtml}</div>`);
        const newVDom = nodeToObj(newDoc.getElementById('_root'), NODE_TO_OBJ_OPTS);

        const diff = dd.diff(oldVDom, newVDom);
        const payload = JSON.stringify(diff);
        const sizeBytes = Buffer.byteLength(payload, 'utf8');

        // After diff, cache the new virtual DOM as the next "previous".
        cachedPrevVDom = newVDom;
        cachedPrevHtml = newHtml;

        return { diff, sizeBytes, latencyMs: Date.now() - t0 };
    } catch (e) {
        console.error('[DIFF] Failed to compute diff:', e.message);
        // Invalidate cache on error so next call starts fresh.
        cachedPrevVDom = null;
        cachedPrevHtml = null;
        return null;
    }
}

/**
 * Invalidate the DOM cache (call when target switches or server resets).
 */
export function invalidateDiffCache() {
    cachedPrevVDom = null;
    cachedPrevHtml = null;
}
