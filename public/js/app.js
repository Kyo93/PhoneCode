// --- Elements ---
const chatContainer = document.getElementById('chatContainer');
const chatContent = document.getElementById('chatContent');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottom');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const refreshBtn = document.getElementById('refreshBtn');
const stopBtn = document.getElementById('stopBtn');
const newChatBtn = document.getElementById('newChatBtn');
const historyBtn = document.getElementById('historyBtn');

const modeBtn = document.getElementById('modeBtn');
const modelBtn = document.getElementById('modelBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalList = document.getElementById('modalList');
const modalTitle = document.getElementById('modalTitle');
const modeText = document.getElementById('modeText');
const modelText = document.getElementById('modelText');
const historyLayer = document.getElementById('historyLayer');
const historyList = document.getElementById('historyList');
const tabAntigravity = document.getElementById('tab-antigravity');
const tabClaude = document.getElementById('tab-claude');

// --- State ---
let autoRefreshEnabled = true;
let userIsScrolling = false;
let userScrollLockUntil = 0; // Timestamp until which we respect user scroll
let forceScrollBottomOnLoad = false; // After sending, always scroll to bottom
let lastScrollPosition = 0;
let ws = null;
let idleTimer = null;
let lastHash = '';
let currentMode = 'Fast';
let chatIsOpen = true; // Track if a chat is currently open
let autoResumeAttempted = false; // Prevent auto-resume loop (selectChat triggers checkChatStatus)
let lastDynamicCssHash = ''; // Track last injected dynamic CSS to skip unchanged updates
let questionOverlayVisible = false; // AskUserQuestion overlay state

// --- Static Dark Mode Overrides (injected once, never rebuilt) ---
const STATIC_DARK_CSS = `
/* --- FORCE DARK MODE OVERRIDES --- */
:root {
    --bg-app: #0f172a;
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --border-color: #334155;
}

#conversation, #chat, #cascade {
    background-color: transparent !important;
    color: var(--text-main) !important;
    font-family: 'Inter', system-ui, sans-serif !important;
    position: relative !important;
    height: auto !important;
    width: 100% !important;
}

#conversation > div, #chat > div, #cascade > div {
    position: static !important;
}
[style*="position: absolute"], [style*="position: fixed"],
[data-headlessui-state], [id*="headlessui"] {
    position: absolute !important;
}

#conversation p, #chat p, #cascade p,
#conversation h1, #chat h1, #cascade h1,
#conversation h2, #chat h2, #cascade h2,
#conversation h3, #chat h3, #cascade h3,
#conversation h4, #chat h4, #cascade h4,
#conversation h5, #chat h5, #cascade h5,
#conversation span, #chat span, #cascade span,
#conversation div, #chat div, #cascade div,
#conversation li, #chat li, #cascade li {
    color: inherit !important;
}

[style*="color: rgb(0, 0, 0)"], [style*="color: black"],
[style*="color:#000"], [style*="color: #000"] {
    color: #e2e8f0 !important;
}

#conversation a, #chat a, #cascade a {
    color: #60a5fa !important;
    text-decoration: underline;
}

img[src^="/c:"], img[src^="/C:"], img[src*="AppData"] {
    display: none !important;
}

img, svg {
    display: inline !important;
    vertical-align: middle !important;
}
div:has(> img[src^="data:"]), div:has(> img[alt]), span:has(> img) {
    display: inline !important;
    vertical-align: middle !important;
}
[class*="inline-flex"], [class*="inline-block"], [class*="items-center"]:has(img) {
    display: inline-flex !important;
    vertical-align: middle !important;
}

:not(pre) > code {
    padding: 0px 2px !important;
    border-radius: 2px !important;
    background-color: rgba(255, 255, 255, 0.1) !important;
    font-size: 0.82em !important;
    line-height: 1 !important;
    white-space: normal !important;
}

pre, code, .monaco-editor-background, [class*="terminal"] {
    background-color: #1e293b !important;
    color: #e2e8f0 !important;
    font-family: 'JetBrains Mono', monospace !important;
    border-radius: 3px;
    border: 1px solid #334155;
}

pre {
    position: relative !important;
    white-space: pre-wrap !important;
    word-break: break-word !important;
    padding: 4px 6px !important;
    margin: 2px 0 !important;
    display: block !important;
    width: 100% !important;
}

pre.has-copy-btn { padding-right: 28px !important; }

pre.single-line-pre {
    display: inline-block !important;
    width: auto !important;
    max-width: 100% !important;
    padding: 0px 4px !important;
    margin: 0px !important;
    vertical-align: middle !important;
    background-color: #1e293b !important;
    font-size: 0.85em !important;
}

pre.single-line-pre > code {
    display: inline !important;
    white-space: nowrap !important;
}

pre:not(.single-line-pre) > code {
    display: block !important;
    width: 100% !important;
    overflow-x: auto !important;
    background: transparent !important;
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
}

.mobile-copy-btn {
    position: absolute !important;
    top: 2px !important;
    right: 2px !important;
    background: rgba(30, 41, 59, 0.5) !important;
    color: #94a3b8 !important;
    border: none !important;
    width: 44px !important;
    height: 44px !important;
    padding: 0 !important;
    cursor: pointer !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    border-radius: 4px !important;
    transition: all 0.2s ease !important;
    -webkit-tap-highlight-color: transparent !important;
    z-index: 10 !important;
    margin: 0 !important;
}
.mobile-copy-btn:hover, .mobile-copy-btn:focus {
    background: rgba(59, 130, 246, 0.2) !important;
    color: #60a5fa !important;
}
.mobile-copy-btn svg {
    width: 20px !important;
    height: 20px !important;
    stroke: currentColor !important;
    stroke-width: 2 !important;
    fill: none !important;
}

blockquote {
    border-left: 3px solid #3b82f6 !important;
    background: rgba(59, 130, 246, 0.1) !important;
    color: #cbd5e1 !important;
    padding: 8px 12px !important;
    margin: 8px 0 !important;
}

table { border-collapse: collapse !important; width: 100% !important; border: 1px solid #334155 !important; }
th, td { border: 1px solid #334155 !important; padding: 8px !important; color: #e2e8f0 !important; }

::-webkit-scrollbar { width: 0 !important; }

[style*="background-color: rgb(255, 255, 255)"],
[style*="background-color: white"],
[style*="background: white"] {
    background-color: transparent !important;
}

#chatContent > * {
    position: relative !important; height: auto !important;
    min-height: 0 !important; max-height: none !important; overflow: visible !important;
}
#chatContent > * > * {
    position: relative !important; height: auto !important;
    min-height: 0 !important; max-height: none !important; overflow: visible !important;
}
#chatContent [style*="position: fixed"], #chatContent [style*="position:fixed"] { position: relative !important; }
#chatContent [style*="height: 100vh"], #chatContent [style*="height:100vh"],
#chatContent [style*="overflow: hidden"], #chatContent [style*="overflow:hidden"] {
    height: auto !important; overflow: visible !important;
}

#chatContent, #chatContent * { touch-action: pan-y; }
#chatContent pre, #chatContent pre * { touch-action: pan-x pan-y; }
`;

// Inject static overrides once at startup
(function initStaticStyles() {
    const tag = document.createElement('style');
    tag.id = 'cdp-static-styles';
    tag.textContent = STATIC_DARK_CSS;
    document.head.appendChild(tag);
})();


// --- Auth Utilities ---
async function fetchWithAuth(url, options = {}) {
    // Add ngrok skip warning header to all requests
    if (!options.headers) options.headers = {};
    options.headers['ngrok-skip-browser-warning'] = 'true';

    try {
        const res = await fetch(url, options);
        if (res.status === 401) {
            console.log('[AUTH] Unauthorized, redirecting to login...');
            window.location.href = '/login.html';
            return new Promise(() => { }); // Halt execution
        }
        return res;
    } catch (e) {
        throw e;
    }
}
const USER_SCROLL_LOCK_DURATION = 3000; // 3 seconds of scroll protection

// --- Sync State (Desktop is Always Priority) ---
async function fetchAppState() {
    try {
        const res = await fetchWithAuth('/app-state');
        const data = await res.json();

        // Mode Sync (Fast/Planning) - Desktop is source of truth
        if (data.mode && data.mode !== 'Unknown') {
            modeText.textContent = data.mode;
            modeBtn.classList.toggle('active', data.mode === 'Planning');
            currentMode = data.mode;
        }

        // Model Sync - Desktop is source of truth
        if (data.model && data.model !== 'Unknown') {
            modelText.textContent = data.model;
        }

        console.log('[SYNC] State refreshed from Desktop:', data);
    } catch (e) { console.error('[SYNC] Failed to sync state', e); }
}

// --- Target Switching ---
async function fetchTargets() {
    try {
        const res = await fetchWithAuth('/targets');
        const data = await res.json();

        // Update tab styles
        tabAntigravity.classList.toggle('active', data.current === 'antigravity');
        tabClaude.classList.toggle('active', data.current === 'claude');

        // Update connection dots
        const antTarget = data.targets.find(t => t.id === 'antigravity');
        const claTarget = data.targets.find(t => t.id === 'claude');

        tabAntigravity.classList.toggle('connected', antTarget?.connected);
        tabClaude.classList.toggle('connected', claTarget?.connected);


        // If target switched and we are active, reload
        if (window.lastTarget && window.lastTarget !== data.current) {
             console.log('[TARGET] Target changed on server, reloading...');
             autoResumeAttempted = false; // Reset so auto-resume fires for new target
             loadSnapshot();
        }
        window.lastTarget = data.current;
    } catch (e) { console.error('[TARGET] Failed to fetch targets', e); }
}

async function switchTarget(id) {
    try {
        const res = await fetchWithAuth('/switch-target', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: id })
        });
        const data = await res.json();
        if (data.success) {
            console.log('[TARGET] Switched to', id);
            fetchTargets();
            chatContent.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div></div>';
            setTimeout(loadSnapshot, 300);
        }
    } catch (e) { console.error('[TARGET] Switch failed', e); }
}


tabAntigravity?.addEventListener('click', () => switchTarget('antigravity'));
tabClaude?.addEventListener('click', () => switchTarget('claude'));

// Sync targets every 5 seconds
setInterval(fetchTargets, 5000);
fetchTargets();

// --- SSL Banner ---
const sslBanner = document.getElementById('sslBanner');

async function checkSslStatus() {
    // Only show banner if currently on HTTP
    if (window.location.protocol === 'https:') return;

    // Check if user dismissed the banner before
    if (localStorage.getItem('sslBannerDismissed')) return;

    sslBanner.style.display = 'flex';
}

async function enableHttps() {
    const btn = document.getElementById('enableHttpsBtn');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
        const res = await fetchWithAuth('/generate-ssl', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            sslBanner.innerHTML = `
                <span>✅ ${data.message}</span>
                <button onclick="location.reload()">Reload After Restart</button>
            `;
            sslBanner.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
        } else {
            btn.textContent = 'Failed - Retry';
            btn.disabled = false;
        }
    } catch (e) {
        btn.textContent = 'Error - Retry';
        btn.disabled = false;
    }
}

function dismissSslBanner() {
    sslBanner.style.display = 'none';
    localStorage.setItem('sslBannerDismissed', 'true');
}

// Check SSL on load
checkSslStatus();
// --- Models ---
const MODELS = [
    "Gemini 3.1 Pro (High)",
    "Gemini 3.1 Pro (Low)",
    "Gemini 3 Flash",
    "Claude Sonnet 4.6 (Thinking)",
    "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)"
];

// --- WebSocket ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('WS Connected');
        updateStatus(true);
        loadSnapshot();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'error' && data.message === 'Unauthorized') {
            window.location.href = '/login.html';
            return;
        }
        if (data.type === 'snapshot_update' && autoRefreshEnabled && !userIsScrolling) {
            loadSnapshot();
        }
    };

    ws.onclose = () => {
        console.log('WS Disconnected');
        updateStatus(false);
        setTimeout(connectWebSocket, 2000);
    };
}

function updateStatus(connected) {
    if (connected) {
        statusDot.classList.remove('disconnected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Live';
    } else {
        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Reconnecting';
    }
}

// --- Rendering ---
async function loadSnapshot() {
    try {
        // Add spin animation to refresh button
        const icon = refreshBtn.querySelector('svg');
        icon.classList.remove('spin-anim');
        void icon.offsetWidth; // trigger reflow
        icon.classList.add('spin-anim');

        const response = await fetchWithAuth('/snapshot');
        if (!response.ok) {
            if (response.status === 503) {
                // No snapshot available - likely no chat open
                chatIsOpen = false;
                showEmptyState();
                return;
            }
            throw new Error('Failed to load');
        }

        // Mark chat as open since we got a valid snapshot
        chatIsOpen = true;

        const data = await response.json();

        // Capture scroll state BEFORE updating content
        const scrollPos = chatContainer.scrollTop;
        const scrollHeight = chatContainer.scrollHeight;
        const clientHeight = chatContainer.clientHeight;
        const isNearBottom = scrollHeight - scrollPos - clientHeight < 120;
        const isUserScrollLocked = Date.now() < userScrollLockUntil;

        // --- UPDATE STATS ---
        if (data.stats) {
            const kbs = Math.round((data.stats.htmlSize + data.stats.cssSize) / 1024);
            const nodes = data.stats.nodes;
            const statsText = document.getElementById('statsText');
            if (statsText) statsText.textContent = `${nodes} Nodes · ${kbs}KB`;
        }

        // --- CSS INJECTION (Dynamic only — static overrides are in cdp-static-styles) ---
        // Only update if the snapshot CSS actually changed (avoids layout recalc on 120Hz)
        const newCssHash = data.css ? data.css.length + ':' + data.css.slice(0, 64) : '';
        if (newCssHash !== lastDynamicCssHash) {
            let styleTag = document.getElementById('cdp-dynamic-styles');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'cdp-dynamic-styles';
                document.head.appendChild(styleTag);
            }
            styleTag.textContent = data.css || '';
            lastDynamicCssHash = newCssHash;
        }
        chatContent.innerHTML = data.html;

        // Add mobile copy buttons to all code blocks
        addMobileCopyButtons();

        // Smart scroll behavior: respect user scroll, only auto-scroll when appropriate
        if (forceScrollBottomOnLoad) {
            forceScrollBottomOnLoad = false;
            scrollToBottom();
        } else if (isUserScrollLocked) {
            // User recently scrolled - try to maintain their approximate position
            // Use percentage-based restoration for better accuracy
            const scrollPercent = scrollHeight > 0 ? scrollPos / scrollHeight : 0;
            const newScrollPos = chatContainer.scrollHeight * scrollPercent;
            chatContainer.scrollTop = newScrollPos;
        } else if (isNearBottom || scrollPos === 0) {
            // User was at bottom or hasn't scrolled - auto scroll to bottom
            scrollToBottom();
        } else {
            // Preserve exact scroll position
            chatContainer.scrollTop = scrollPos;
        }

        // Check for AskUserQuestion when target is Claude
        if (window.lastTarget === 'claude') {
            checkForQuestion();
        } else if (questionOverlayVisible) {
            hideQuestionOverlay();
        }

    } catch (err) {
        console.error(err);
    }
}

// --- Mobile Code Block Copy Functionality ---
function addMobileCopyButtons() {
    // Find all pre elements (code blocks) in the chat
    const codeBlocks = chatContent.querySelectorAll('pre');

    codeBlocks.forEach((pre, index) => {
        // Skip if already has our button
        if (pre.querySelector('.mobile-copy-btn')) return;

        // Get the code text
        const codeElement = pre.querySelector('code') || pre;
        const textToCopy = (codeElement.textContent || codeElement.innerText).trim();

        // Check if there's a newline character in the TRIMMED text
        // This ensures single-line blocks with trailing newlines don't get buttons
        const hasNewline = /\n/.test(textToCopy);

        // If it's a single line code block, don't add the copy button
        if (!hasNewline) {
            pre.classList.remove('has-copy-btn');
            pre.classList.add('single-line-pre');
            return;
        }

        // Add class for padding
        pre.classList.remove('single-line-pre');
        pre.classList.add('has-copy-btn');

        // Create the copy button (icon only)
        const copyBtn = document.createElement('button');
        copyBtn.className = 'mobile-copy-btn';
        copyBtn.setAttribute('data-code-index', index);
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            `;

        // Add click handler for copy
        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const success = await copyToClipboard(textToCopy);

            if (success) {
                // Visual feedback - show checkmark
                copyBtn.classList.add('copied');
                copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            `;

                // Reset after 2 seconds
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
            `;
                }, 2000);
            } else {
                // Show X icon briefly on error
                copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
            `;
                setTimeout(() => {
                    copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
            `;
                }, 2000);
            }
        });

        // Insert button into pre element
        pre.appendChild(copyBtn);
    });
}

// --- Cross-platform Clipboard Copy ---
async function copyToClipboard(text) {
    // Method 1: Modern Clipboard API (works on HTTPS or localhost)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('[COPY] Success via Clipboard API');
            return true;
        } catch (err) {
            console.warn('[COPY] Clipboard API failed:', err);
        }
    }

    // Method 2: Fallback using execCommand (works on HTTP, older browsers)
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;

        // Avoid scrolling to bottom on iOS
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';
        textArea.style.opacity = '0';

        document.body.appendChild(textArea);

        // iOS specific handling
        if (navigator.userAgent.match(/ipad|iphone/i)) {
            const range = document.createRange();
            range.selectNodeContents(textArea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            textArea.setSelectionRange(0, text.length);
        } else {
            textArea.select();
        }

        const success = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (success) {
            console.log('[COPY] Success via execCommand fallback');
            return true;
        }
    } catch (err) {
        console.warn('[COPY] execCommand fallback failed:', err);
    }

    // Method 3: For Android WebView or restricted contexts
    // Show the text in a selectable modal if all else fails
    console.error('[COPY] All copy methods failed');
    return false;
}

function scrollToBottom() {
    chatContainer.scrollTo({
        top: chatContainer.scrollHeight,
        behavior: 'smooth'
    });
}

// --- Inputs ---
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    // Optimistic UI updates
    const previousValue = messageInput.value;
    messageInput.value = ''; // Clear immediately
    messageInput.style.height = 'auto'; // Reset height
    messageInput.blur(); // Close keyboard on mobile immediately

    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.5';

    try {
        // If no chat is open, start a new one first
        if (!chatIsOpen) {
            const newChatRes = await fetchWithAuth('/new-chat', { method: 'POST' });
            const newChatData = await newChatRes.json();
            if (newChatData.success) {
                // Wait for the new chat to be ready
                await new Promise(r => setTimeout(r, 800));
                chatIsOpen = true;
            }
        }

        const res = await fetchWithAuth('/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        // Always reload snapshot to check if message appeared
        forceScrollBottomOnLoad = true;
        setTimeout(loadSnapshot, 300);
        setTimeout(loadSnapshot, 800);
        setTimeout(checkChatStatus, 1000);

        // Don't revert the input - if user sees the message in chat, it was sent
        // Only log errors for debugging, don't show alert popups
        if (!res.ok) {
            console.warn('Send response not ok, but message may have been sent:', await res.json().catch(() => ({})));
        }
    } catch (e) {
        // Network error - still try to refresh in case it went through
        console.error('Send error:', e);
        setTimeout(loadSnapshot, 500);
    } finally {
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
    }
}

// --- Event Listeners ---
sendBtn.addEventListener('click', sendMessage);

refreshBtn.addEventListener('click', async () => {
    // Force a fresh CDP capture before loading (not just reading cache)
    try { await fetchWithAuth('/refresh', { method: 'POST' }); } catch (e) { }
    loadSnapshot();
    fetchAppState(); // PRIORITY: Sync from Desktop
});

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

messageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

// --- Scroll Sync to Desktop ---
let scrollSyncTimeout = null;
let lastScrollSync = 0;
const SCROLL_SYNC_DEBOUNCE = 150; // ms between scroll syncs
let snapshotReloadPending = false;

async function syncScrollToDesktop() {
    const scrollPercent = chatContainer.scrollTop / (chatContainer.scrollHeight - chatContainer.clientHeight);
    try {
        await fetchWithAuth('/remote-scroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scrollPercent })
        });

        // After scrolling desktop, reload snapshot to get newly visible content
        // (Antigravity uses virtualized scrolling - only visible messages are in DOM)
        if (!snapshotReloadPending) {
            snapshotReloadPending = true;
            setTimeout(() => {
                loadSnapshot();
                snapshotReloadPending = false;
            }, 300);
        }
    } catch (e) {
        console.log('Scroll sync failed:', e.message);
    }
}

chatContainer.addEventListener('scroll', () => {
    userIsScrolling = true;
    // Set a lock to prevent auto-scroll jumping for a few seconds
    userScrollLockUntil = Date.now() + USER_SCROLL_LOCK_DURATION;
    clearTimeout(idleTimer);

    const isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 120;
    if (isNearBottom) {
        scrollToBottomBtn.classList.remove('show');
        // If user scrolled to bottom, clear the lock so auto-scroll works
        userScrollLockUntil = 0;
    } else {
        scrollToBottomBtn.classList.add('show');
    }

    // Debounced scroll sync to desktop
    const now = Date.now();
    if (now - lastScrollSync > SCROLL_SYNC_DEBOUNCE) {
        lastScrollSync = now;
        clearTimeout(scrollSyncTimeout);
        scrollSyncTimeout = setTimeout(syncScrollToDesktop, 100);
    }

    idleTimer = setTimeout(() => {
        userIsScrolling = false;
        autoRefreshEnabled = true;
    }, 5000);
});

scrollToBottomBtn.addEventListener('click', () => {
    userIsScrolling = false;
    userScrollLockUntil = 0; // Clear lock so auto-scroll works again
    scrollToBottom();
});

// --- Quick Actions ---
function quickAction(text) {
    messageInput.value = text;
    messageInput.style.height = 'auto';
    messageInput.style.height = messageInput.scrollHeight + 'px';
    messageInput.focus();
}

// Trigger Claude Code toolbar actions (add-file, slash-command, toggle-edit-auto, bypass)
async function triggerClaudeAction(action) {
    try {
        const res = await fetchWithAuth('/claude/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        if (!data.ok) console.warn('Claude action failed:', data);
        setTimeout(loadSnapshot, 500);
        setTimeout(loadSnapshot, 1500);
    } catch (e) {
        console.error('triggerClaudeAction error:', e);
    }
}

// --- AskUserQuestion Detection & Overlay ---
const questionOverlay = document.getElementById('questionOverlay');
const questionPanel = document.getElementById('questionPanel');
let questionCheckTimer = null;
let questionCancelledAt = 0; // suppress re-detection after cancel

async function checkForQuestion() {
    // Don't re-show if user just cancelled (give Escape time to take effect)
    if (Date.now() - questionCancelledAt < 5000) return;
    try {
        const res = await fetchWithAuth('/claude/question');
        const data = await res.json();
        if (data.detected && !questionOverlayVisible) {
            showQuestionOverlay(data);
        } else if (data.detected && questionOverlayVisible) {
            // Check if the question changed (multi-question flow auto-advance)
            const currentQ = currentQuestionData?.question || '';
            const newQ = data.question || '';
            if (newQ !== currentQ) {
                // Question changed — rebuild overlay with new question
                showQuestionOverlay(data);
            } else {
                updateQuestionSelections(data);
            }
        } else if (!data.detected && questionOverlayVisible) {
            hideQuestionOverlay();
        }
    } catch (e) {
        // Silent fail — question detection is best-effort
    }
}

let currentQuestionData = null;

function showQuestionOverlay(data) {
    questionOverlayVisible = true;
    currentQuestionData = data;

    // Claude Code shows 1 question at a time; tabs indicate total steps
    const tabs = data.tabs || [];
    const activeTab = data.activeTab || 0;
    const totalSteps = tabs.length || 1;
    const currentStep = activeTab + 1;
    const q = data; // current visible question data (top-level fields)

    const multiSelect = q.multiSelect;
    const checkIcon = multiSelect ? '&#10003;' : '&#9679;';

    let html = `
        <div class="question-header">`;

    // Step indicator if multiple steps
    if (totalSteps > 1) {
        html += `<span class="question-step">${currentStep} / ${totalSteps}</span>`;
    }

    html += `<button class="question-close-btn" onclick="cancelQuestion()">&times;</button>
        </div>`;

    if (q.category) {
        html += `<div class="question-category">${escapeHtml(q.category)}</div>`;
    }
    html += `<div class="question-text">${escapeHtml(q.question || '')}</div>`;
    html += `<div class="question-options">`;

    q.options.forEach((opt, i) => {
        const sel = opt.selected ? ' selected' : '';
        if (opt.isOther) {
            html += `
            <div class="question-option${sel}" data-index="${i}" onclick="toggleQuestionOption(${i})">
                <div class="question-checkbox">${checkIcon}</div>
                <div class="question-option-content">
                    <div class="question-option-label">Other</div>
                    <input class="question-other-input" placeholder="Type your answer..."
                        value="${escapeHtml(opt.otherText || '')}"
                        onclick="event.stopPropagation()"
                        oninput="this.closest('.question-option').click()">
                </div>
            </div>`;
        } else {
            html += `
            <div class="question-option${sel}" data-index="${i}" onclick="toggleQuestionOption(${i})">
                <div class="question-checkbox">${checkIcon}</div>
                <div class="question-option-content">
                    <div class="question-option-label">${escapeHtml(opt.label)}</div>
                    ${opt.description ? `<div class="question-option-desc">${escapeHtml(opt.description)}</div>` : ''}
                </div>
            </div>`;
        }
    });

    html += `</div>`;

    // Navigation + Submit row
    const selectedCount = q.options.filter(o => o.selected).length;
    if (totalSteps > 1) {
        const prevDisabled = activeTab <= 0 ? ' disabled' : '';
        const nextDisabled = activeTab >= totalSteps - 1 ? ' disabled' : '';
        html += `
        <div class="question-nav-row">
            <button class="question-nav-btn" onclick="navigateQuestion('prev')"${prevDisabled}>&larr; Prev</button>
            <button class="question-submit-btn" id="questionSubmitBtn" onclick="submitQuestionAnswer()"
                ${selectedCount === 0 ? 'disabled' : ''}>${escapeHtml(q.submitText || 'Submit answers')}</button>
            <button class="question-nav-btn" onclick="navigateQuestion('next')"${nextDisabled}>Next &rarr;</button>
        </div>`;
    } else {
        html += `
        <button class="question-submit-btn" id="questionSubmitBtn" onclick="submitQuestionAnswer()"
            ${selectedCount === 0 ? 'disabled' : ''}>${escapeHtml(q.submitText || 'Submit answers')}</button>`;
    }
    html += `<div class="question-cancel-hint">Tap &times; to cancel</div>`;

    questionPanel.innerHTML = html;
    questionOverlay.classList.add('show');
}

function updateQuestionSelections(data) {
    const optionEls = questionPanel.querySelectorAll('.question-option');
    let selectedCount = 0;
    data.options.forEach((opt, i) => {
        if (optionEls[i]) {
            optionEls[i].classList.toggle('selected', opt.selected);
            if (opt.selected) selectedCount++;
        }
    });
    const submitBtn = document.getElementById('questionSubmitBtn');
    if (submitBtn) submitBtn.disabled = selectedCount === 0;
}

function hideQuestionOverlay() {
    questionOverlayVisible = false;
    currentQuestionData = null;
    questionOverlay.classList.remove('show');
    questionPanel.innerHTML = '';
}

async function toggleQuestionOption(index) {
    const optionEls = questionPanel.querySelectorAll('.question-option');
    const el = optionEls[index];
    if (!el) return;

    const isMulti = currentQuestionData?.multiSelect || false;
    if (isMulti) {
        el.classList.toggle('selected');
    } else {
        // Radio: deselect all others, select this one
        optionEls.forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
    }

    const selectedCount = questionPanel.querySelectorAll('.question-option.selected').length;
    const submitBtn = document.getElementById('questionSubmitBtn');
    if (submitBtn) submitBtn.disabled = selectedCount === 0;

    try {
        await fetchWithAuth('/claude/question/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index })
        });
        setTimeout(loadSnapshot, 500);
    } catch (e) {
        console.error('toggleQuestionOption error:', e);
    }
}

async function submitQuestionAnswer() {
    const submitBtn = document.getElementById('questionSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
    }
    try {
        // If "Other" is selected and has text, inject it into Claude Code first
        const otherInput = questionPanel.querySelector('.question-option.selected .question-other-input');
        if (otherInput && otherInput.value.trim()) {
            await fetchWithAuth('/claude/question/other-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: otherInput.value.trim() })
            });
            // Small delay to let React process the input
            await new Promise(r => setTimeout(r, 200));
        }

        await fetchWithAuth('/claude/question/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        hideQuestionOverlay();
        setTimeout(loadSnapshot, 500);
        setTimeout(loadSnapshot, 1500);
        setTimeout(loadSnapshot, 3000);
    } catch (e) {
        console.error('submitQuestionAnswer error:', e);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit answers';
        }
    }
}

async function cancelQuestion() {
    questionCancelledAt = Date.now();
    hideQuestionOverlay();
    // Send Escape key to Claude Code to dismiss the question
    try {
        await fetchWithAuth('/claude/question/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        setTimeout(loadSnapshot, 500);
    } catch (e) {}
}

async function navigateQuestion(direction) {
    try {
        await fetchWithAuth('/claude/question/navigate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ direction })
        });
        // Wait for Claude Code to switch tab, then refresh question data
        setTimeout(async () => {
            try {
                const res = await fetchWithAuth('/claude/question');
                const data = await res.json();
                if (data.detected) {
                    showQuestionOverlay(data);
                }
            } catch (e) {}
            loadSnapshot();
        }, 400);
    } catch (e) {
        console.error('navigateQuestion error:', e);
    }
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// --- Stop Logic ---
stopBtn.addEventListener('click', async () => {
    stopBtn.style.opacity = '0.5';
    try {
        const res = await fetchWithAuth('/stop', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            // alert('Stopped');
        } else {
            // alert('Error: ' + data.error);
        }
    } catch (e) { }
    setTimeout(() => stopBtn.style.opacity = '1', 500);
});

// --- New Chat Logic ---
async function startNewChat() {
    newChatBtn.style.opacity = '0.5';
    newChatBtn.style.pointerEvents = 'none';

    try {
        const res = await fetchWithAuth('/new-chat', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            // Reload snapshot to show new empty chat
            setTimeout(loadSnapshot, 500);
            setTimeout(loadSnapshot, 1000);
            setTimeout(checkChatStatus, 1500);
        } else {
            console.error('Failed to start new chat:', data.error);
        }
    } catch (e) {
        console.error('New chat error:', e);
    }

    setTimeout(() => {
        newChatBtn.style.opacity = '1';
        newChatBtn.style.pointerEvents = 'auto';
    }, 500);
}

newChatBtn.addEventListener('click', startNewChat);

// --- Chat History Logic ---
async function showChatHistory() {
    const historyLayer = document.getElementById('historyLayer');
    const historyList = document.getElementById('historyList');

    // Show loading state
    historyList.innerHTML = `
        <div class="history-state-container">
            <div class="history-spinner"></div>
            <div class="history-state-text">Loading History...</div>
        </div>
    `;
    historyLayer.classList.add('show');
    historyBtn.style.opacity = '1';

    try {
        const res = await fetchWithAuth('/chat-history');
        const data = await res.json();

        if (data.error) {
            historyList.innerHTML = `
                <div class="history-state-container">
                    <div class="history-state-icon">⚠️</div>
                    <div class="history-state-title">Error loading history</div>
                    <div class="history-state-desc">${data.error}</div>
                    <button class="history-new-btn mt-4" onclick="hideChatHistory(); startNewChat();">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Start New Conversation
                    </button>
                </div>
            `;
            return;
        }

        const chats = data.chats || [];
        if (chats.length === 0) {
            historyList.innerHTML = `
                <div class="history-state-container">
                    <div class="history-state-icon">📝</div>
                    <div class="history-state-title">No recent chats found</div>
                    <div class="history-state-desc">Start a new conversation to see them here.</div>
                    <button class="history-new-btn mt-4" onclick="hideChatHistory(); startNewChat();">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Start New Conversation
                    </button>
                </div>
            `;
            return;
        }

        // Render chats
        let html = `
            <div class="history-action-container">
                <button class="history-new-btn" onclick="hideChatHistory(); startNewChat();">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    New Conversation
                </button>
            </div>
            <div class="history-list-group">
        `;

        chats.forEach(chat => {
            const safeTitle = chat.title.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const safeSessionId = (chat.sessionId || '').replace(/'/g, '');
            const onclick = `hideChatHistory(); selectChat('${safeTitle}', '${safeSessionId}');`;
            html += `
                <div class="history-card" onclick="${onclick}">
                    <div class="history-card-icon">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                    </div>
                    <div class="history-card-content">
                        <span class="history-card-title">${escapeHtml(chat.title)}</span>
                        ${chat.timeStr ? `<span class="history-card-time" style="font-size: 10px; color: #888; margin-left: 8px;">${escapeHtml(chat.timeStr)}</span>` : ''}
                    </div>
                    <div class="history-card-arrow">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                </div>
            `;
        });

        html += `</div>`;

        historyList.innerHTML = html;

    } catch (e) {
        historyList.innerHTML = `
            <div class="history-state-container">
                <div class="history-state-icon">🔌</div>
                <div class="history-state-title">Connection Error</div>
                <div class="history-state-desc">Failed to reach the server.</div>
            </div>
        `;
    }
}


function hideChatHistory() {
    historyLayer.classList.remove('show');
    // Send an escape key to Antigravity to close the History panel
    try {
        fetchWithAuth('/close-history', { method: 'POST' });
    } catch (e) {
        console.error('Failed to close history on desktop:', e);
    }
}

historyBtn.addEventListener('click', showChatHistory);

// --- Select Chat from History ---
async function selectChat(title, sessionId) {
    try {
        const res = await fetchWithAuth('/select-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, sessionId })
        });
        const data = await res.json();

        if (data.success) {
            // Reload snapshots with staggered timing to catch UI transition
            setTimeout(loadSnapshot, 500);
            setTimeout(loadSnapshot, 1200);
            setTimeout(loadSnapshot, 2500);
            setTimeout(checkChatStatus, 1500);
        } else {
            console.error('Failed to select chat:', data.error);
        }
    } catch (e) {
        console.error('Select chat error:', e);
    }
}

// --- Check Chat Status ---
async function checkChatStatus() {
    try {
        const res = await fetchWithAuth('/chat-status');
        const data = await res.json();

        chatIsOpen = data.hasChat || data.editorFound;

        if (!chatIsOpen) {
            // Auto-resume most recent chat for Claude Code (only once per empty-state encounter)
            if (window.lastTarget === 'claude' && !autoResumeAttempted) {
                autoResumeAttempted = true;
                try {
                    const histRes = await fetchWithAuth('/chat-history');
                    const histData = await histRes.json();
                    if (histData.chats && histData.chats.length > 0) {
                        const mostRecent = histData.chats[0];
                        console.log('[CHAT] Auto-resuming most recent conversation:', mostRecent.title);
                        await selectChat(mostRecent.title, mostRecent.sessionId);
                        return; // selectChat schedules its own loadSnapshot + checkChatStatus
                    }
                } catch (e) {
                    console.error('[CHAT] Auto-resume failed:', e);
                }
            }
            showEmptyState();
        } else {
            autoResumeAttempted = false; // Reset when a chat is open
        }
    } catch (e) {
        console.error('Chat status check failed:', e);
    }
}

// --- Empty State (No Chat Open) ---
function showEmptyState() {
    chatContent.innerHTML = `
        <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                <line x1="9" y1="10" x2="15" y2="10"></line>
            </svg>
            <h2>No Chat Open</h2>
            <p>Start a new conversation or select one from your history to begin chatting.</p>
            <button class="empty-state-btn" onclick="startNewChat()">
                Start New Conversation
            </button>
        </div>
    `;
}

// --- Utility: Escape HTML ---
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Settings Logic ---


function openModal(title, options, onSelect) {
    modalTitle.textContent = title;
    modalList.innerHTML = '';
    options.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'modal-option';
        div.textContent = opt;
        div.onclick = () => {
            onSelect(opt);
            closeModal();
        };
        modalList.appendChild(div);
    });
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) closeModal();
};

modeBtn.addEventListener('click', () => {
    openModal('Select Mode', ['Fast', 'Planning'], async (mode) => {
        modeText.textContent = 'Setting...';
        try {
            const res = await fetchWithAuth('/set-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });
            const data = await res.json();
            if (data.success) {
                currentMode = mode;
                modeText.textContent = mode;
                modeBtn.classList.toggle('active', mode === 'Planning');
            } else {
                alert('Error: ' + (data.error || 'Unknown'));
                modeText.textContent = currentMode;
            }
        } catch (e) {
            modeText.textContent = currentMode;
        }
    });
});

modelBtn.addEventListener('click', () => {
    openModal('Select Model', MODELS, async (model) => {
        const prev = modelText.textContent;
        modelText.textContent = 'Setting...';
        try {
            const res = await fetchWithAuth('/set-model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model })
            });
            const data = await res.json();
            if (data.success) {
                modelText.textContent = model;
            } else {
                alert('Error: ' + (data.error || 'Unknown'));
                modelText.textContent = prev;
            }
        } catch (e) {
            modelText.textContent = prev;
        }
    });
});

// --- Viewport / Keyboard Handling ---
// Use CSS 100dvh for layout instead of JS-driven height to prevent jumping.
// Only scroll to bottom when keyboard opens (input focused).
if (window.visualViewport) {
    let vpResizeTimer = null;
    window.visualViewport.addEventListener('resize', () => {
        // Only scroll to bottom when keyboard opens — don't manipulate body height
        // (100dvh in CSS handles the layout automatically)
        clearTimeout(vpResizeTimer);
        vpResizeTimer = setTimeout(() => {
            if (document.activeElement === messageInput) {
                scrollToBottom();
            }
        }, 80);
    });
} else {
    // Fallback for very old browsers — not needed for Android/iOS modern browsers
    window.addEventListener('resize', () => {
        document.body.style.height = window.innerHeight + 'px';
    });
    document.body.style.height = window.innerHeight + 'px';
}

// --- Remote Click Logic (Thinking/Thought) ---
chatContainer.addEventListener('click', async (e) => {
    // Strategy: Check if the clicked element OR its parent contains "Thought" or "Thinking" text.
    // This handles both opening (collapsed) and closing (expanded) states.

    // 1. Find the nearest container that might be the "Thought" block
    const target = e.target.closest('div, span, p, summary, button, details');
    if (!target) return;

    const text = target.innerText || '';

    // Check if this looks like a thought toggle (matches "Thought for Xs" or "Thinking" patterns)
    // Also match the header of expanded thoughts which may have more content
    const isThoughtToggle = /Thought|Thinking/i.test(text) && text.length < 500;

    if (isThoughtToggle) {
        // Visual feedback - briefly dim the clicked element
        target.style.opacity = '0.5';
        setTimeout(() => target.style.opacity = '1', 300);

        // Extract just the first line for matching (e.g., "Thought for 3s")
        const firstLine = text.split('\n')[0].trim();

        // Determine which occurrence of this text the user tapped
        // This handles multiple Thought blocks with identical labels
        const allElements = chatContainer.querySelectorAll(target.tagName.toLowerCase());
        let tapIndex = 0;
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const elText = el.innerText || '';
            const elFirstLine = elText.split('\n')[0].trim();

            // Only count if it looks like a thought toggle and matches the first line exactly
            if (/Thought|Thinking/i.test(elText) && elText.length < 500 && elFirstLine === firstLine) {
                // If this is our target (or contains it), we've found the correct index
                if (el === target || el.contains(target)) {
                    break;
                }
                tapIndex++;
            }
        }

        try {
            const response = await fetchWithAuth('/remote-click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    selector: target.tagName.toLowerCase(),
                    index: tapIndex,
                    textContent: firstLine  // Use first line for more reliable matching
                })
            });

            // Reload snapshot multiple times to catch the UI change
            // Desktop animation takes time, so we poll a few times
            setTimeout(loadSnapshot, 400);   // Quick check
            setTimeout(loadSnapshot, 800);   // After animation starts
            setTimeout(loadSnapshot, 1500);  // After animation completes
        } catch (e) {
            console.error('Remote click failed:', e);
        }
        return;
    }

    // --- Remote Button Click (all buttons in snapshot) ---
    // Forward any button click to desktop via remote-click.
    // This handles: Run/Reject, AskUserQuestion options, permission dialogs, etc.
    const btn = e.target.closest('button');
    if (btn) {
        const btnText = (btn.innerText || '').trim();
        if (!btnText) return; // skip icon-only buttons with no text

        // Skip buttons that are part of the mobile UI, not the snapshot
        // (those are outside chatContainer, but just in case)
        const ignorePatterns = /^(copy|copied)$/i;
        if (ignorePatterns.test(btnText)) return;

        btn.style.opacity = '0.5';
        setTimeout(() => btn.style.opacity = '1', 300);

        // Use first line of button text as the match label
        const label = btnText.split('\n')[0].trim();
        const allButtons = Array.from(chatContainer.querySelectorAll('button'));
        const matchingButtons = allButtons.filter(b => {
            const t = (b.innerText || '').trim().split('\n')[0].trim();
            return t === label;
        });
        const btnIndex = matchingButtons.indexOf(btn);

        try {
            await fetchWithAuth('/remote-click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    selector: 'button',
                    index: btnIndex >= 0 ? btnIndex : 0,
                    textContent: label
                })
            });
            setTimeout(loadSnapshot, 500);
            setTimeout(loadSnapshot, 1500);
            setTimeout(loadSnapshot, 3000);
        } catch (err) {
            console.error('Remote button click failed:', err);
        }
    }
});

// --- Init ---
connectWebSocket();
// Sync state initially and every 5 seconds to keep phone in sync with desktop changes
fetchAppState();
setInterval(fetchAppState, 5000);

// Check chat status initially and periodically
checkChatStatus();
setInterval(checkChatStatus, 10000); // Check every 10 seconds
