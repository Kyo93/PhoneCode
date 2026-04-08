#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { inspectUI } from './ui_inspector.js';
import { execSync } from 'child_process';
import * as antigravity from './targets/antigravity.js';
import * as claude from './targets/claude.js';
import { computeSnapshotDiff, invalidateDiffCache } from './lib/snapshot-diff.js';

// Target registry — add new targets here only
const TARGETS = { antigravity, claude };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1000; // 1 second
const SERVER_PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
const AUTH_COOKIE_NAME = 'ag_auth_token';
// Note: hashString is defined later, so we'll initialize the token inside createServer or use a simple string for now.
let AUTH_TOKEN = 'ag_default_token';


// Shared CDP connection
let cdpConnections = new Map(); // targetKey -> { port, url, ws, call, contexts }
let currentTarget = 'antigravity';
let lastSnapshot = null;
let lastSnapshotHash = null;
let snapshotSeq = 0;          // Monotonic counter; increments on every snapshot update
let lastBroadcastCssHash = ''; // Hash of CSS last sent to clients; avoid resending unchanged CSS

// Kill any existing process on the server port (prevents EADDRINUSE)
function killPortProcess(port) {
    try {
        if (process.platform === 'win32') {
            // Windows: Find PID using netstat and kill it
            const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const lines = result.trim().split('\n');
            const pids = new Set();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') pids.add(pid);
            }
            for (const pid of pids) {
                try {
                    execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (e) { /* Process may have already exited */ }
            }
        } else {
            // Linux/macOS: Use lsof and kill
            const result = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const pids = result.trim().split('\n').filter(p => p);
            for (const pid of pids) {
                try {
                    execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (e) { /* Process may have already exited */ }
            }
        }
        // Small delay to let the port be released
        return new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
        // No process found on port - this is fine
        return Promise.resolve();
    }
}

// Get local IP address for mobile access
// Prefers real network IPs (192.168.x.x, 10.x.x.x) over virtual adapters (172.x.x.x from WSL/Docker)
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                candidates.push({
                    address: iface.address,
                    name: name,
                    // Prioritize common home/office network ranges
                    priority: iface.address.startsWith('192.168.') ? 1 :
                        iface.address.startsWith('10.') ? 2 :
                            iface.address.startsWith('172.') ? 3 : 4
                });
            }
        }
    }

    // Sort by priority and return the best one
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.length > 0 ? candidates[0].address : 'localhost';
}

// Helper: HTTP GET JSON
function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// Find CDP endpoints for all registered targets
async function discoverCDP() {
    const results = {};
    const errors = [];

    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            for (const [name, target] of Object.entries(TARGETS)) {
                if (!results[name]) {
                    const found = target.discover(list);
                    if (found) results[name] = { port, ...found };
                }
            }
        } catch (e) {
            errors.push(`${port}: ${e.message}`);
        }
    }

    if (Object.keys(results).length === 0) {
        const errorSummary = errors.length ? `Errors: ${errors.join(', ')}` : 'No ports responding';
        throw new Error(`CDP not found. ${errorSummary}`);
    }

    return results;
}

// Connect to CDP
async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });

    let idCounter = 1;
    const pendingCalls = new Map(); // Track pending calls by ID
    const contexts = [];
    const CDP_CALL_TIMEOUT = 30000; // 30 seconds timeout

    // Single centralized message handler (fixes MaxListenersExceeded warning)
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            // Handle CDP method responses
            if (data.id !== undefined && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);

                if (data.error) reject(data.error);
                else resolve(data.result);
            }

            // Handle execution context events
            if (data.method === 'Runtime.executionContextCreated') {
                contexts.push(data.params.context);
            } else if (data.method === 'Runtime.executionContextDestroyed') {
                const id = data.params.executionContextId;
                const idx = contexts.findIndex(c => c.id === id);
                if (idx !== -1) contexts.splice(idx, 1);
            } else if (data.method === 'Runtime.executionContextsCleared') {
                contexts.length = 0;
            }
        } catch (e) { console.error('[CDP] message parse error:', e.message); }
    });

    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;

        // Setup timeout to prevent memory leaks from never-resolved calls
        const timeoutId = setTimeout(() => {
            if (pendingCalls.has(id)) {
                pendingCalls.delete(id);
                reject(new Error(`CDP call ${method} timed out after ${CDP_CALL_TIMEOUT}ms`));
            }
        }, CDP_CALL_TIMEOUT);

        pendingCalls.set(id, { resolve, reject, timeoutId });
        ws.send(JSON.stringify({ id, method, params }));
    });

    await call("Runtime.enable", {});
    await new Promise(r => setTimeout(r, 1000));

    return { ws, call, contexts };
}

// Set functionality mode (Fast vs Planning)
async function setMode(cdp, mode) {
    if (!['Fast', 'Planning'].includes(mode)) return { error: 'Invalid mode' };

    const EXP = `(async () => {
        try {
            // STRATEGY: Find the element that IS the current mode indicator.
            // It will have text 'Fast' or 'Planning'.
            // It might not be a <button>, could be a <div> with cursor-pointer.
            
            // 1. Get all elements with text 'Fast' or 'Planning'
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                // Must have single text node child to avoid parents
                if (el.children.length > 0) return false;
                const txt = el.textContent.trim();
                return txt === 'Fast' || txt === 'Planning';
            });

            // 2. Find the one that looks interactive (cursor-pointer)
            // Traverse up from text node to find clickable container
            let modeBtn = null;
            
            for (const el of candidates) {
                let current = el;
                // Go up max 4 levels
                for (let i = 0; i < 4; i++) {
                    if (!current) break;
                    const style = window.getComputedStyle(current);
                    if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                        modeBtn = current;
                        break;
                    }
                    current = current.parentElement;
                }
                if (modeBtn) break;
            }

            if (!modeBtn) return { error: 'Mode indicator/button not found' };

            // Check if already set
            if (modeBtn.innerText.includes('${mode}')) return { success: true, alreadySet: true };

            // 3. Click to open menu
            modeBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // 4. Find the dialog
            let visibleDialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                                    .find(d => d.offsetHeight > 0 && d.innerText.includes('${mode}'));
            
            // Fallback: Just look for any new visible container if role=dialog is missing
            if (!visibleDialog) {
                // Maybe it's not role=dialog? Look for a popover-like div
                 visibleDialog = Array.from(document.querySelectorAll('div'))
                    .find(d => {
                        const style = window.getComputedStyle(d);
                        return d.offsetHeight > 0 && 
                               (style.position === 'absolute' || style.position === 'fixed') && 
                               d.innerText.includes('${mode}') &&
                               !d.innerText.includes('Files With Changes'); // Anti-context menu
                    });
            }

            if (!visibleDialog) return { error: 'Dropdown not opened or options not visible' };

            // 5. Click the option
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            const target = allDialogEls.find(el => 
                el.children.length === 0 && el.textContent.trim() === '${mode}'
            );

            if (target) {
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true };
            }
            
            return { error: 'Mode option text not found in dialog. Dialog text: ' + visibleDialog.innerText.substring(0, 50) };

        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[setMode] all contexts failed:', lastErr.message || lastErr);
    return { error: 'Context failed' };
}

// Stop Generation
async function stopGeneration(cdp) {
    const EXP = `(async () => {
        // Look for the cancel button
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) {
            cancel.click();
            return { success: true };
        }
        
        // Fallback: Look for a square icon in the send button area
        const stopBtn = document.querySelector('button svg.lucide-square')?.closest('button');
        if (stopBtn && stopBtn.offsetParent !== null) {
            stopBtn.click();
            return { success: true, method: 'fallback_square' };
        }

        return { error: 'No active generation found to stop' };
    })()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[stopGeneration] all contexts failed:', lastErr.message || lastErr);
    return { error: 'Context failed' };
}

// Click Element (Remote)
async function clickElement(cdp, { selector, index, textContent }) {
    const safeText = JSON.stringify(textContent || '');

    const EXP = `(async () => {
        try {
            // Priority: Search inside the chat container first for better accuracy
            const root = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade') || document;
            
            // Strategy: Find all elements matching the selector
            let elements = Array.from(root.querySelectorAll('${selector}'));
            
            const filterText = ${safeText};
            if (filterText) {
                elements = elements.filter(el => {
                    const txt = (el.innerText || el.textContent || '').trim();
                    const firstLine = txt.split('\\n')[0].trim();
                    // Match if first line matches (thought blocks) or if it contains the label (buttons)
                    return firstLine === filterText || txt.includes(filterText);
                });
                
                // CRITICAL: If elements are nested (e.g. <div><span>Text</span></div>), 
                // both will match. We only want the most specific (inner-most) one.
                elements = elements.filter(el => {
                    return !elements.some(other => other !== el && el.contains(other));
                });
            }

            const target = elements[${index}];

            if (target) {
                // Focus and Click
                if (target.focus) target.focus();
                target.click();
                return { success: true, found: elements.length, indexUsed: ${index} };
            }
            
            return { error: 'Element not found at index ' + ${index} + ' among ' + elements.length + ' matches' };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
            // If we found it but click didn't return success (unlikely with this script), continue to next context
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[clickElement] all contexts failed:', lastErr.message || lastErr);
    return { error: 'Click failed in all contexts or element not found at index' };
}

// Remote scroll - sync phone scroll to desktop
async function remoteScroll(cdp, { scrollTop, scrollPercent }) {
    // Try to scroll the chat container in Antigravity
    const EXPRESSION = `(async () => {
        try {
            // Find the main scrollable chat container
            const scrollables = [...document.querySelectorAll('#conversation [class*="scroll"], #chat [class*="scroll"], #cascade [class*="scroll"], #conversation [style*="overflow"], #chat [style*="overflow"], #cascade [style*="overflow"]')]
                .filter(el => el.scrollHeight > el.clientHeight);
            
            // Also check for the main chat area
            const chatArea = document.querySelector('#conversation .overflow-y-auto, #chat .overflow-y-auto, #cascade .overflow-y-auto, #conversation [data-scroll-area], #chat [data-scroll-area], #cascade [data-scroll-area]');
            if (chatArea) scrollables.unshift(chatArea);
            
            if (scrollables.length === 0) {
                // Fallback: scroll the main container element
                const cascade = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
                if (cascade && cascade.scrollHeight > cascade.clientHeight) {
                    scrollables.push(cascade);
                }
            }
            
            if (scrollables.length === 0) return { error: 'No scrollable element found' };
            
            const target = scrollables[0];
            
            // Use percentage-based scrolling for better sync
            if (${scrollPercent} !== undefined) {
                const maxScroll = target.scrollHeight - target.clientHeight;
                target.scrollTop = maxScroll * ${scrollPercent};
            } else {
                target.scrollTop = ${scrollTop || 0};
            }
            
            return { success: true, scrolled: target.scrollTop };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[remoteScroll] all contexts failed:', lastErr.message || lastErr);
    return { error: 'Scroll failed in all contexts' };
}

// Set AI Model
async function setModel(cdp, modelName) {
    const EXP = `(async () => {
        try {
            // STRATEGY: Multi-layered approach to find and click the model selector
            const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT", "Model"];
            
            let modelBtn = null;
            
            // Strategy 1: Look for data-tooltip-id patterns (most reliable)
            modelBtn = document.querySelector('[data-tooltip-id*="model"], [data-tooltip-id*="provider"]');
            
            // Strategy 2: Look for buttons/elements containing model keywords with SVG icons
            if (!modelBtn) {
                const candidates = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
                    .filter(el => {
                        const txt = el.innerText?.trim() || '';
                        return KNOWN_KEYWORDS.some(k => txt.includes(k)) && el.offsetParent !== null;
                    });

                // Find the best one (has chevron icon or cursor pointer)
                modelBtn = candidates.find(el => {
                    const style = window.getComputedStyle(el);
                    const hasSvg = el.querySelector('svg.lucide-chevron-up') || 
                                   el.querySelector('svg.lucide-chevron-down') || 
                                   el.querySelector('svg[class*="chevron"]') ||
                                   el.querySelector('svg');
                    return (style.cursor === 'pointer' || el.tagName === 'BUTTON') && hasSvg;
                }) || candidates[0];
            }
            
            // Strategy 3: Traverse from text nodes up to clickable parents
            if (!modelBtn) {
                const allEls = Array.from(document.querySelectorAll('*'));
                const textNodes = allEls.filter(el => {
                    if (el.children.length > 0) return false;
                    const txt = el.textContent;
                    return KNOWN_KEYWORDS.some(k => txt.includes(k));
                });

                for (const el of textNodes) {
                    let current = el;
                    for (let i = 0; i < 5; i++) {
                        if (!current) break;
                        if (current.tagName === 'BUTTON' || window.getComputedStyle(current).cursor === 'pointer') {
                            modelBtn = current;
                            break;
                        }
                        current = current.parentElement;
                    }
                    if (modelBtn) break;
                }
            }

            if (!modelBtn) return { error: 'Model selector button not found' };

            // Click to open menu
            modelBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // Find the dialog/dropdown - search globally (React portals render at body level)
            let visibleDialog = null;
            
            // Try specific dialog patterns first
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]'));
            visibleDialog = dialogs.find(d => d.offsetHeight > 0 && d.innerText?.includes('${modelName}'));
            
            // Fallback: look for positioned divs
            if (!visibleDialog) {
                visibleDialog = Array.from(document.querySelectorAll('div'))
                    .find(d => {
                        const style = window.getComputedStyle(d);
                        return d.offsetHeight > 0 && 
                               (style.position === 'absolute' || style.position === 'fixed') && 
                               d.innerText?.includes('${modelName}') && 
                               !d.innerText?.includes('Files With Changes');
                    });
            }

            if (!visibleDialog) {
                // Blind search across entire document as last resort
                const allElements = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'));
                const target = allElements.find(el => 
                    el.offsetParent !== null && 
                    (el.innerText?.trim() === '${modelName}' || el.innerText?.includes('${modelName}'))
                );
                if (target) {
                    target.click();
                    return { success: true, method: 'blind_search' };
                }
                return { error: 'Model list not opened' };
            }

            // Select specific model inside the dialog
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            const validEls = allDialogEls.filter(el => el.children.length === 0 && el.textContent?.trim().length > 0);
            
            // A. Exact Match (Best)
            let target = validEls.find(el => el.textContent.trim() === '${modelName}');
            
            // B. Page contains Model
            if (!target) {
                target = validEls.find(el => el.textContent.includes('${modelName}'));
            }

            // C. Closest partial match
            if (!target) {
                const partialMatches = validEls.filter(el => '${modelName}'.includes(el.textContent.trim()));
                if (partialMatches.length > 0) {
                    partialMatches.sort((a, b) => b.textContent.trim().length - a.textContent.trim().length);
                    target = partialMatches[0];
                }
            }

            if (target) {
                target.scrollIntoView({block: 'center'});
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true };
            }

            return { error: 'Model "${modelName}" not found in list. Visible: ' + visibleDialog.innerText.substring(0, 100) };
        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[setModel] all contexts failed:', lastErr.message || lastErr);
    return { error: 'Context failed' };
}

// Start New Chat - Click the + button at the TOP of the chat window (NOT the context/media + button)
async function startNewChat(cdp) {
    const EXP = `(async () => {
        try {
            // Priority 1: Exact selector from user (data-tooltip-id="new-conversation-tooltip")
            const exactBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
            if (exactBtn) {
                exactBtn.click();
                return { success: true, method: 'data-tooltip-id' };
            }

            // Fallback: Use previous heuristics
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
            
            // Find all buttons with plus icons
            const plusButtons = allButtons.filter(btn => {
                if (btn.offsetParent === null) return false; // Skip hidden
                const hasPlusIcon = btn.querySelector('svg.lucide-plus') || 
                                   btn.querySelector('svg.lucide-square-plus') ||
                                   btn.querySelector('svg[class*="plus"]');
                return hasPlusIcon;
            });
            
            // Filter only top buttons (toolbar area)
            const topPlusButtons = plusButtons.filter(btn => {
                const rect = btn.getBoundingClientRect();
                return rect.top < 200;
            });

            if (topPlusButtons.length > 0) {
                 topPlusButtons.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
                 topPlusButtons[0].click();
                 return { success: true, method: 'filtered_top_plus', count: topPlusButtons.length };
            }
            
            // Fallback: aria-label
             const newChatBtn = allButtons.find(btn => {
                const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
                const title = btn.getAttribute('title')?.toLowerCase() || '';
                return (ariaLabel.includes('new') || title.includes('new')) && btn.offsetParent !== null;
            });
            
            if (newChatBtn) {
                newChatBtn.click();
                return { success: true, method: 'aria_label_new' };
            }
            
            return { error: 'New chat button not found' };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[startNewChat] all contexts failed:', lastErr.message || lastErr);
    return { error: 'Context failed' };
}
// Get Chat History - Click history button and scrape conversations
async function getChatHistory(cdp) {
    const EXP = `(async () => {
        try {
            const chats = [];
            const seenTitles = new Set();

            // Priority 1: Look for tooltip ID pattern (history/past/recent)
            let historyBtn = document.querySelector('[data-tooltip-id*="history"], [data-tooltip-id*="past"], [data-tooltip-id*="recent"], [data-tooltip-id*="conversation-history"]');
            
            // Priority 2: Look for button ADJACENT to the new chat button
            if (!historyBtn) {
                const newChatBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
                if (newChatBtn) {
                    const parent = newChatBtn.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter(el => el !== newChatBtn);
                        historyBtn = siblings.find(el => el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
                    }
                }
            }

            // Fallback: Use previous heuristics (icon/aria-label)
            if (!historyBtn) {
                const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a[data-tooltip-id]'));
                for (const btn of allButtons) {
                    if (btn.offsetParent === null) continue;
                    const hasHistoryIcon = btn.querySelector('svg.lucide-clock') ||
                                           btn.querySelector('svg.lucide-history') ||
                                           btn.querySelector('svg.lucide-folder') ||
                                           btn.querySelector('svg[class*="clock"]') ||
                                           btn.querySelector('svg[class*="history"]');
                    if (hasHistoryIcon) {
                        historyBtn = btn;
                        break;
                    }
                }
            }
            
            if (!historyBtn) {
                return { error: 'History button not found', chats: [] };
            }

            // Click and Wait
            historyBtn.click();
            await new Promise(r => setTimeout(r, 2000));
            
            // Find the side panel
            let panel = null;
            let inputsFoundDebug = [];
            
            // Strategy 1: The search input has specific placeholder
            let searchInput = null;
            const inputs = Array.from(document.querySelectorAll('input'));
            searchInput = inputs.find(i => {
                const ph = (i.placeholder || '').toLowerCase();
                return ph.includes('select') || ph.includes('conversation');
            });
            
            // Strategy 2: Look for any text input that looks like a search bar (based on user snippet classes)
            if (!searchInput) {
                const allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
                inputsFoundDebug = allInputs.map(i => 'ph:' + i.placeholder + ', cls:' + i.className);
                
                searchInput = allInputs.find(i => 
                    i.offsetParent !== null && 
                    (i.className.includes('w-full') || i.classList.contains('w-full'))
                );
            }
            
            // Strategy 3: Find known text in the panel (Anchor Text Strategy)
            let anchorElement = null;
            if (!searchInput) {
                 const allSpans = Array.from(document.querySelectorAll('span, div, p'));
                 anchorElement = allSpans.find(s => {
                     const t = (s.innerText || '').trim();
                     return t === 'Current' || t === 'Refining Chat History Scraper'; // specific known title
                 });
            }

            const startElement = searchInput || anchorElement;

            if (startElement) {
                // Walk up to find the panel container
                let container = startElement;
                for (let i = 0; i < 15; i++) { 
                    if (!container.parentElement) break;
                    container = container.parentElement;
                    const rect = container.getBoundingClientRect();
                    
                    // Panel should have good dimensions
                    // Relaxed constraints for mobile
                    if (rect.width > 50 && rect.height > 100) {
                        panel = container;
                        
                        // If it looks like a modal/popover (fixed or absolute pos), that's definitely it
                        const style = window.getComputedStyle(container);
                        if (style.position === 'fixed' || style.position === 'absolute' || style.zIndex > 10) {
                            break;
                        }
                    }
                }
                
                // Fallback if loop finishes without specific break
                if (!panel && startElement) {
                     // Just go up 4 levels
                     let p = startElement;
                     for(let k=0; k<4; k++) { if(p.parentElement) p = p.parentElement; }
                     panel = p;
                }
            }
            
            const debugInfo = { 
                panelFound: !!panel, 
                panelWidth: panel?.offsetWidth || 0,
                inputFound: !!searchInput,
                anchorFound: !!anchorElement,
                inputsDebug: inputsFoundDebug.slice(0, 5)
            };
            
            if (panel) {
                // Chat titles are in <span> elements
                const spans = Array.from(panel.querySelectorAll('span'));
                
                // Section headers to skip
                const SKIP_EXACT = new Set([
                    'current', 'other conversations', 'now'
                ]);
                
                for (const span of spans) {
                    const text = span.textContent?.trim() || '';
                    const lower = text.toLowerCase();
                    
                    // Skip empty or too short
                    if (text.length < 3) continue;
                    
                    // Skip section headers
                    if (SKIP_EXACT.has(lower)) continue;
                    if (lower.startsWith('recent in ')) continue;
                    if (lower.startsWith('show ') && lower.includes('more')) continue;
                    
                    // Skip timestamps
                    if (lower.endsWith(' ago') || /^\\d+\\s*(sec|min|hr|day|wk|mo|yr)/i.test(lower)) continue;
                    
                    // Skip very long text (containers)
                    if (text.length > 100) continue;
                    
                    // Skip duplicates
                    if (seenTitles.has(text)) continue;
                    
                    seenTitles.add(text);
                    chats.push({ title: text, date: 'Recent' });
                    
                    if (chats.length >= 50) break;
                }
            }
            
            // Note: Panel is left open on PC as requested ("launch history on pc")

            return { success: true, chats: chats, debug: debugInfo };
        } catch(e) {
            return { error: e.toString(), chats: [] };
        }
    })()`;

    let lastError = null;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
            // If result.value is null/undefined but no error thrown, check exceptionDetails
            if (res.exceptionDetails) {
                lastError = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
            }
        } catch (e) {
            lastError = e.message;
        }
    }
    return { error: 'Context failed: ' + (lastError || 'No contexts available'), chats: [] };
}

async function selectChat(cdp, chatTitle) {
    const safeChatTitle = JSON.stringify(chatTitle);

    const EXP = `(async () => {
    try {
        const targetTitle = ${safeChatTitle};

        // First, we need to open the history panel
        // Find the history button at the top (next to + button)
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));

        let historyBtn = null;

        // Find by icon type
        for (const btn of allButtons) {
            if (btn.offsetParent === null) continue;
            const hasHistoryIcon = btn.querySelector('svg.lucide-clock') ||
                btn.querySelector('svg.lucide-history') ||
                btn.querySelector('svg.lucide-folder') ||
                btn.querySelector('svg.lucide-clock-rotate-left');
            if (hasHistoryIcon) {
                historyBtn = btn;
                break;
            }
        }

        // Fallback: Find by position (second button at top)
        if (!historyBtn) {
            const topButtons = allButtons.filter(btn => {
                if (btn.offsetParent === null) return false;
                const rect = btn.getBoundingClientRect();
                return rect.top < 100 && rect.top > 0;
            }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

            if (topButtons.length >= 2) {
                historyBtn = topButtons[1];
            }
        }

        if (historyBtn) {
            historyBtn.click();
            await new Promise(r => setTimeout(r, 600));
        }

        // Now find the chat by title in the opened panel
        await new Promise(r => setTimeout(r, 200));

        const allElements = Array.from(document.querySelectorAll('*'));

        // Find elements matching the title
        const candidates = allElements.filter(el => {
            if (el.offsetParent === null) return false;
            const text = el.innerText?.trim();
            return text && text.startsWith(targetTitle.substring(0, Math.min(30, targetTitle.length)));
        });

        // Find the most specific (deepest) visible element with the title
        let target = null;
        let maxDepth = -1;

        for (const el of candidates) {
            // Skip if it has too many children (likely a container)
            if (el.children.length > 5) continue;

            let depth = 0;
            let parent = el;
            while (parent) {
                depth++;
                parent = parent.parentElement;
            }

            if (depth > maxDepth) {
                maxDepth = depth;
                target = el;
            }
        }

        if (target) {
            // Find clickable parent if needed
            let clickable = target;
            for (let i = 0; i < 5; i++) {
                if (!clickable) break;
                const style = window.getComputedStyle(clickable);
                if (style.cursor === 'pointer' || clickable.tagName === 'BUTTON') {
                    break;
                }
                clickable = clickable.parentElement;
            }

            if (clickable) {
                clickable.click();
                return { success: true, method: 'clickable_parent' };
            }

            target.click();
            return { success: true, method: 'direct_click' };
        }

        return { error: 'Chat not found: ' + targetTitle };
    } catch (e) {
        return { error: e.toString() };
    }
})()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[selectAntigravityChat] all contexts failed:', lastErr.message || lastErr);
    return { error: 'Context failed' };
}

// Select a chat session in Claude Code extension via CDP
// Claude UI structure: buttons with title="Session history" open a sidebar,
// session items have class names containing "sessionItem" 
async function selectClaudeChat(cdp, chatTitle, sessionId) {
    const safeTitle = JSON.stringify(chatTitle);

    const EXP = `(async () => {
    try {
        const targetTitle = ${safeTitle};

        // Step 1: Open the Session History panel
        const allButtons = Array.from(document.querySelectorAll('button'));
        let historyBtn = allButtons.find(btn => {
            if (!btn.offsetParent) return false;
            const t = (btn.getAttribute('title') || '').toLowerCase();
            const a = (btn.getAttribute('aria-label') || '').toLowerCase();
            return (t.includes('session history') || t.includes('history') ||
                   a.includes('session history') || a.includes('history'));
        });

        if (!historyBtn) {
            return { error: 'Session History button not found' };
        }

        // If the panel is already open (item list visible), don't click again to avoid closing it
        let sessionItems = Array.from(document.querySelectorAll('[class*="sessionItem"]'))
            .filter(el => el.offsetParent !== null);
            
        if (sessionItems.length === 0) {
            historyBtn.click();
            await new Promise(r => setTimeout(r, 600));
            sessionItems = Array.from(document.querySelectorAll('[class*="sessionItem"]'))
                .filter(el => el.offsetParent !== null);
        }

        // Filter to inner-most elements (elements that don't contain other session items)
        // This avoids clicking a container that holds multiple items
        sessionItems = sessionItems.filter(el => {
            return !sessionItems.some(other => other !== el && el.contains(other));
        });

        if (sessionItems.length === 0) {
            return { error: 'No session items found in history panel' };
        }

        // Step 3: Match session by title text
        // Note: Claude titles in DOM are "Title\\nTime" (e.g. "Alo\\n2m")
        const getTitle = (el) => (el.innerText || '').split('\\n')[0].trim();
        
        let matchedItem = sessionItems.find(el => getTitle(el) === targetTitle);

        if (!matchedItem) {
            // Fuzzy match (prefix or contains)
            matchedItem = sessionItems.find(el => {
                const t = getTitle(el);
                return t.startsWith(targetTitle) || targetTitle.startsWith(t);
            });
        }

        if (!matchedItem) {
            const available = sessionItems.map(getTitle);
            return { error: 'Session not found: ' + targetTitle, available, count: sessionItems.length };
        }

        // Step 4: Click the matched session
        matchedItem.focus();
        matchedItem.click();
        await new Promise(r => setTimeout(r, 300));

        return { success: true, method: 'claude_session_click', selected: getTitle(matchedItem) };
    } catch (e) {
        return { error: e.toString() };
    }
})()`;

    let lastResult = null;
    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value && !res.result.value.error) return res.result.value;
            if (res.result?.value) lastResult = res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[selectClaudeChat] all contexts failed:', lastErr.message || lastErr);
    return lastResult || { error: 'No valid context found for Claude Code' };
}

// Scrape Claude's session history directly from the extension UI
async function getClaudeChatHistoryFromDOM(cdp) {
    const EXP = `(async () => {
        try {
            // 1. Check if history items are already visible
            let sessionItems = Array.from(document.querySelectorAll('[class*="sessionItem"]'))
                .filter(el => el.offsetParent !== null);
            
            // 2. If no items, try to open the History panel
            if (sessionItems.length === 0) {
                const historyBtn = Array.from(document.querySelectorAll('button')).find(btn => {
                    const title = (btn.getAttribute('title') || '').toLowerCase();
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                    return (title.includes('session history') || title.includes('history') ||
                           aria.includes('session history') || aria.includes('history')) && 
                           btn.offsetParent !== null;
                });
                
                if (historyBtn) {
                    historyBtn.click();
                    // Wait for transition
                    await new Promise(r => setTimeout(r, 600));
                    // Re-scan for items
                    sessionItems = Array.from(document.querySelectorAll('[class*="sessionItem"]'))
                        .filter(el => el.offsetParent !== null);
                }
            }
            
            if (sessionItems.length === 0) {
                return { success: false, error: 'No session items found in DOM' };
            }
            
            // 3. Map items to chat objects
            const chats = sessionItems.map((el, idx) => {
                const rawText = (el.innerText || '').trim();
                // Claude titles often have "Hi 01\\n2m" or just "Alo"
                const lines = rawText.split('\\n');
                const title = lines[0].trim();
                const timeStr = lines.length > 1 ? lines[1].trim() : '';
                
                return {
                    title: title,
                    timeStr: timeStr,
                    sessionId: title, // We use title as ID if we don't have UUID
                    mtime: Date.now() - (idx * 60000) // Mock mtime for sorting
                };
            });
            
            return { success: true, chats };
        } catch (e) {
            return { success: false, error: e.toString() };
        }
    })()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[scrapeClaudeHistory] all contexts failed:', lastErr.message || lastErr);
    return { success: false, error: 'Failed to scrape Claude history from all contexts' };
}

// Close History Panel (Escape)
async function closeHistory(cdp) {
    const EXP = `(async () => {
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', code: 'Escape', bubbles: true }));
            return { success: true };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[closeHistory] all contexts failed:', lastErr.message || lastErr);
    return { error: 'Failed to close history panel' };
}

// Check if a chat is currently open (has cascade element)
async function hasChatOpen(cdp) {
    const EXP = `(() => {
    const chatContainer = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
    const hasMessages = chatContainer && chatContainer.querySelectorAll('[class*="message"], [data-message]').length > 0;
    return {
        hasChat: !!chatContainer,
        hasMessages: hasMessages,
        editorFound: !!(chatContainer && chatContainer.querySelector('[data-lexical-editor="true"]'))
    };
})()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[hasChatOpen] all contexts failed:', lastErr.message || lastErr);
    return { hasChat: false, hasMessages: false, editorFound: false };
}

// Get App State (Mode & Model)
async function getAppState(cdp) {
    const EXP = `(async () => {
    try {
        const state = { mode: 'Unknown', model: 'Unknown' };

        // 1. Get Mode (Fast/Planning)
        // Strategy: Find the clickable mode button which contains either "Fast" or "Planning"
        // It's usually a button or div with cursor:pointer containing the mode text
        const allEls = Array.from(document.querySelectorAll('*'));

        // Find elements that are likely mode buttons
        for (const el of allEls) {
            if (el.children.length > 0) continue;
            const text = (el.innerText || '').trim();
            if (text !== 'Fast' && text !== 'Planning') continue;

            // Check if this or a parent is clickable (the actual mode selector)
            let current = el;
            for (let i = 0; i < 5; i++) {
                if (!current) break;
                const style = window.getComputedStyle(current);
                if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                    state.mode = text;
                    break;
                }
                current = current.parentElement;
            }
            if (state.mode !== 'Unknown') break;
        }

        // Fallback: Just look for visible text
        if (state.mode === 'Unknown') {
            const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
            if (textNodes.some(el => el.innerText.trim() === 'Planning')) state.mode = 'Planning';
            else if (textNodes.some(el => el.innerText.trim() === 'Fast')) state.mode = 'Fast';
        }

        // 2. Get Model
        // Strategy: Look for leaf text nodes containing a known model keyword,
        // but EXCLUDE elements inside the chat/conversation container to avoid
        // picking up model names mentioned in chat content.
        const KNOWN_MODELS = ["Gemini", "Claude", "GPT"];
        const chatRoot = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
        const textNodes2 = allEls.filter(el => {
            if (el.children.length > 0 || !el.innerText) return false;
            if (chatRoot && chatRoot.contains(el)) return false; // exclude chat content
            return true;
        });

        // First try: find inside a clickable parent (button, cursor:pointer)
        let modelEl = textNodes2.find(el => {
            const txt = el.innerText.trim();
            if (!KNOWN_MODELS.some(k => txt.includes(k)) || txt.length > 40) return false;
            let parent = el;
            for (let i = 0; i < 8; i++) {
                if (!parent) break;
                if (parent.tagName === 'BUTTON' || window.getComputedStyle(parent).cursor === 'pointer') return true;
                parent = parent.parentElement;
            }
            return false;
        });

        // Fallback: any leaf node with a known model name outside chat
        if (!modelEl) {
            modelEl = textNodes2.find(el => {
                const txt = el.innerText.trim();
                return KNOWN_MODELS.some(k => txt.includes(k)) && txt.length < 40;
            });
        }

        if (modelEl) {
            state.model = modelEl.innerText.trim();
        }

        return state;
    } catch (e) { return { error: e.toString() }; }
})()`;

    let lastErr;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { lastErr = e; }
    }
    if (lastErr) console.error('[getAppState] all contexts failed:', lastErr.message || lastErr);
    return { error: 'Context failed' };
}

// Simple hash function
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

// Check if a request is from the same Wi-Fi (internal network)
function isLocalRequest(req) {
    // 1. Check for proxy headers (Cloudflare, ngrok, etc.)
    // If these exist, the request is coming via an external tunnel/proxy
    if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-real-ip']) {
        return false;
    }

    // 2. Check the remote IP address
    const ip = req.ip || req.socket.remoteAddress || '';

    // Standard local/private IPv4 and IPv6 ranges
    return ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
        ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
        ip.startsWith('172.2') || ip.startsWith('172.3') ||
        ip.startsWith('::ffff:192.168.') ||
        ip.startsWith('::ffff:10.');
}

// Initialize CDP connection for all discovered targets
async function initCDP() {
    console.log('🔍 Discovering CDP endpoints...');
    const targets = await discoverCDP();

    // 1. Antigravity
    if (targets.antigravity && !cdpConnections.has('antigravity')) {
        console.log(`🔌 Connecting to Antigravity on port ${targets.antigravity.port}...`);
        try {
            const conn = await connectCDP(targets.antigravity.url);
            cdpConnections.set('antigravity', { ...targets.antigravity, ...conn });
            // Clear stale browser globals from prior server session (Plan 05-04 gap fix).
            // Must call AFTER cdpConnections.set so the stored connection object is complete.
            // Optional chaining guards the case where 05-01 plan has not yet been deployed.
            TARGETS['antigravity']?.invalidateSnapshotCache?.(cdpConnections.get('antigravity')).catch(() => {});
            console.log(`✅ Connected to Antigravity! (${conn.contexts.length} contexts)`);
        } catch (e) {
            console.error(`❌ Failed to connect to Antigravity: ${e.message}`);
        }
    }

    // 2. Claude
    if (targets.claude && !cdpConnections.has('claude')) {
        console.log(`🔌 Connecting to Claude Extension on port ${targets.claude.port}...`);
        try {
            const conn = await connectCDP(targets.claude.url);
            cdpConnections.set('claude', { ...targets.claude, ...conn });
            // Clear stale browser globals from prior server session (Plan 05-04 gap fix).
            TARGETS['claude']?.invalidateSnapshotCache?.(cdpConnections.get('claude')).catch(() => {});
            console.log(`✅ Connected to Claude Extension! (${conn.contexts.length} contexts)`);
        } catch (e) {
            console.error(`❌ Failed to connect to Claude: ${e.message}`);
        }
    }
}

// Diff stats accumulator — logged every 60s to track bandwidth savings
const diffStats = { diffCount: 0, fullCount: 0, savedBytes: 0 };

setInterval(() => {
    const total = diffStats.diffCount + diffStats.fullCount;
    if (total === 0) return;
    const pct = Math.round(diffStats.diffCount / total * 100);
    console.log(`[DIFF] ${total} updates: ${pct}% diffs, ${diffStats.fullCount} full resyncs, ${Math.round(diffStats.savedBytes / 1024)}KB saved total`);
}, 60_000);

// Background polling
async function startPolling(wss) {
    let lastErrorLog = 0;
    let isConnecting = false;

    const poll = async () => {
        const cdp = cdpConnections.get(currentTarget);
        if (!cdp || (cdp.ws && cdp.ws.readyState !== WebSocket.OPEN)) {
            if (!isConnecting) {
                console.log(`🔍 Looking for ${currentTarget} CDP connection...`);
                isConnecting = true;
            }
            if (cdp) {
                // Was connected, now lost
                console.log(`🔄 ${currentTarget} CDP connection lost. Attempting to reconnect...`);
                cdpConnections.delete(currentTarget);
            }
            try {
                await initCDP();
                const newCdp = cdpConnections.get(currentTarget);
                if (newCdp) {
                    console.log(`✅ ${currentTarget} CDP Connection established from polling loop`);
                    isConnecting = false;
                }
            } catch (err) {
                // Not found yet, just wait for next cycle
            }
            setTimeout(poll, 2000); // Try again in 2 seconds if not found
            return;
        }

        try {
            const snapshot = await TARGETS[currentTarget].captureSnapshot(cdp);
            if (snapshot && !snapshot.error) {
                const hash = hashString(snapshot.html);

                // Only update if content changed
                if (hash !== lastSnapshotHash) {
                    const prevHtml = lastSnapshot ? lastSnapshot.html : null;
                    const fullBytes = Buffer.byteLength(snapshot.html, 'utf8');

                    // CSS null/undefined-guard (Plan 05-02 + 05-04): browser returns snapshot.css=null when CSS
                    // fingerprint cache hits (05-02). Plan 05-03's MutationObserver early-return omits the css
                    // field entirely (snapshot.css === undefined). Loose != null catches both null and undefined.
                    // Hard contract: lastSnapshot.css must NEVER be null or undefined — GET /snapshot serves
                    // lastSnapshot verbatim to reconnecting clients. Missing CSS wipes all styles on new clients.
                    // Normalize to prior effective CSS before any processing.
                    const effectiveCSS = snapshot.css != null
                        ? snapshot.css
                        : (lastSnapshot?.css ?? '');

                    lastSnapshot = {
                        ...snapshot,
                        css: effectiveCSS   // never null — always concrete CSS text from current or prior poll
                    };
                    lastSnapshotHash = hash;
                    snapshotSeq++;

                    const newCssHash = effectiveCSS
                        ? effectiveCSS.length + ':' + effectiveCSS.slice(0, 64)
                        : '';
                    const cssPayload = (newCssHash !== lastBroadcastCssHash) ? effectiveCSS : undefined;
                    if (cssPayload !== undefined) lastBroadcastCssHash = newCssHash;

                    let message;
                    if (prevHtml && wss.clients.size > 0) {
                        const result = computeSnapshotDiff(prevHtml, snapshot.html);
                        // Use diff only if under absolute 30KB cap — percentage threshold doesn't
                        // map to fixed bandwidth targets and can allow large diffs on big pages
                        if (result && result.sizeBytes < 30_000) {
                            message = JSON.stringify({
                                type: 'snapshot_diff',
                                diff: result.diff,
                                css: cssPayload,        // undefined = unchanged, client keeps existing
                                seq: snapshotSeq,
                            });
                            diffStats.diffCount++;
                            diffStats.savedBytes += fullBytes - result.sizeBytes;
                            console.log(`📸 Diff seq=${snapshotSeq} ${result.sizeBytes}B / ${fullBytes}B (${Math.round((1 - result.sizeBytes / fullBytes) * 100)}% saved, ${result.latencyMs}ms)`);
                        }
                    }

                    if (!message) {
                        // Fall back to full snapshot notification — client fetches /snapshot
                        message = JSON.stringify({
                            type: 'snapshot_update',
                            seq: snapshotSeq,
                            timestamp: new Date().toISOString()
                        });
                        diffStats.fullCount++;
                        console.log(`📸 Full seq=${snapshotSeq} ${fullBytes}B`);
                    }

                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(message);
                        }
                    });
                }

                // On cache hit: snapshot.stats.cached === true — no HTML change, no broadcast.
                // Update lastSnapshot stats and send lightweight stats_update to all clients so the
                // mobile stats bar shows ⚡ without reloading the full snapshot.
                // stats_update intentionally omits `seq` — it is NOT a snapshot sequence event.
                // Client must NOT treat this as a sequence advancement for diff tracking.
                if (snapshot?.stats?.cached && lastSnapshot) {
                    lastSnapshot = { ...lastSnapshot, stats: snapshot.stats };
                    const statsMsg = JSON.stringify({
                        type: 'stats_update',
                        stats: snapshot.stats
                        // seq intentionally omitted — isStatsOnly is implicit by message type
                    });
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) client.send(statsMsg);
                    });
                }
            } else {
                // Snapshot is null or has error
                const now = Date.now();
                if (!lastErrorLog || now - lastErrorLog > 10000) {
                    const errorMsg = snapshot?.error || 'No valid snapshot captured (check contexts)';
                    console.warn(`⚠️  Snapshot capture issue (${currentTarget}): ${errorMsg} `);
                    if (errorMsg.includes('container not found')) {
                        console.log(`   (Tip: Ensure an active chat is open in ${currentTarget})`);
                    }
                    if (cdp.contexts.length === 0) {
                        console.log('   (Tip: No active execution contexts found)');
                    }
                    lastErrorLog = now;
                }
            }
        } catch (err) {
            console.error('Poll error:', err.message);
        }

        setTimeout(poll, POLL_INTERVAL);
    };

    poll();
}

// Create Express app
async function createServer() {
    const app = express();

    // Check for SSL certificates
    const keyPath = join(__dirname, 'certs', 'server.key');
    const certPath = join(__dirname, 'certs', 'server.cert');
    const hasSSL = fs.existsSync(keyPath) && fs.existsSync(certPath);

    let server;
    let httpsServer = null;

    if (hasSSL) {
        const sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        httpsServer = https.createServer(sslOptions, app);
        server = httpsServer;
    } else {
        server = http.createServer(app);
    }

    const wss = new WebSocketServer({ server });

    // Initialize Auth Token using a unique salt from environment
    const authSalt = process.env.AUTH_SALT || 'antigravity_default_salt_99';
    AUTH_TOKEN = hashString(APP_PASSWORD + authSalt);

    app.use(compression());
    app.use(express.json());

    // Use a secure session secret from .env if available
    const sessionSecret = process.env.SESSION_SECRET || 'antigravity_secret_key_1337';
    app.use(cookieParser(sessionSecret));

    // Ngrok Bypass Middleware
    app.use((req, res, next) => {
        // Tell ngrok to skip the "visit" warning for API requests
        res.setHeader('ngrok-skip-browser-warning', 'true');
        next();
    });

    // Auth Middleware
    app.use((req, res, next) => {
        const publicPaths = ['/login', '/login.html', '/favicon.ico'];
        if (publicPaths.includes(req.path) || req.path.startsWith('/css/')) {
            return next();
        }

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            return next();
        }

        // Magic Link / QR Code Auto-Login
        if (req.query.key === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            // Remove the key from the URL by redirecting to the base path
            return res.redirect('/');
        }

        const token = req.signedCookies[AUTH_COOKIE_NAME];
        if (token === AUTH_TOKEN) {
            return next();
        }

        // If it's an API request, return 401, otherwise redirect to login
        if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/snapshot') || req.path.startsWith('/send')) {
            res.status(401).json({ error: 'Unauthorized' });
        } else {
            res.redirect('/login.html');
        }
    });

    app.use(express.static(join(__dirname, 'public')));

    // Login endpoint
    app.post('/login', (req, res) => {
        const { password } = req.body;
        if (password === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Invalid password' });
        }
    });

    // Logout endpoint
    app.post('/logout', (req, res) => {
        res.clearCookie(AUTH_COOKIE_NAME);
        res.json({ success: true });
    });

    // Get current snapshot
    app.get('/snapshot', (req, res) => {
        if (!lastSnapshot) {
            return res.status(503).json({ error: 'No snapshot available yet' });
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json({ ...lastSnapshot, seq: snapshotSeq });
    });

    // Chat status (is a chat open in the current target?)
    app.get('/chat-status', async (req, res) => {
        const cdp = cdpConnections.get(currentTarget);
        if (!cdp) return res.json({ hasChat: false, hasMessages: false, editorFound: false });
        if (currentTarget === 'claude') {
            // Claude Code renders inside #active-frame iframe — check that it exists and has content
            const result = await claude.hasChatOpen(cdp);
            return res.json(result);
        }
        const result = await hasChatOpen(cdp);
        res.json(result);
    });

    // Force-capture a fresh snapshot immediately (used by mobile refresh button)
    app.post('/refresh', async (req, res) => {
        const cdp = cdpConnections.get(currentTarget);
        if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
        try {
            const snapshot = await TARGETS[currentTarget].captureSnapshot(cdp);
            if (snapshot && !snapshot.error) {
                lastSnapshot = snapshot;
                lastSnapshotHash = hashString(snapshot.html);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                return res.json({ success: true });
            }
            res.status(503).json({ error: snapshot?.error || 'Capture failed' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
        const cdp = cdpConnections.get(currentTarget);
        res.json({
            status: 'ok',
            cdpConnected: cdp?.ws?.readyState === 1, // WebSocket.OPEN = 1
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            https: hasSSL
        });
    });

    // SSL status endpoint
    app.get('/ssl-status', (req, res) => {
        const keyPath = join(__dirname, 'certs', 'server.key');
        const certPath = join(__dirname, 'certs', 'server.cert');
        const certsExist = fs.existsSync(keyPath) && fs.existsSync(certPath);
        res.json({
            enabled: hasSSL,
            certsExist: certsExist,
            message: hasSSL ? 'HTTPS is active' :
                certsExist ? 'Certificates exist, restart server to enable HTTPS' :
                    'No certificates found'
        });
    });

    // Generate SSL certificates endpoint
    app.post('/generate-ssl', async (req, res) => {
        try {
            const { execSync } = await import('child_process');
            execSync('node generate_ssl.js', { cwd: __dirname, stdio: 'pipe' });
            res.json({
                success: true,
                message: 'SSL certificates generated! Restart the server to enable HTTPS.'
            });
        } catch (e) {
            res.status(500).json({
                success: false,
                error: e.message
            });
        }
    });

    // Debug UI Endpoint
    app.get('/debug-ui', async (req, res) => {
        const cdp = cdpConnections.get(currentTarget);
        if (!cdp) return res.status(503).json({ error: 'CDP not connected' });
        const uiTree = await inspectUI(cdp);
        console.log('--- UI TREE ---');
        console.log(uiTree);
        console.log('---------------');
        res.type('json').send(uiTree);
    });

    // Set Mode
    app.post('/set-mode', async (req, res) => {
        const { mode } = req.body;
        const cdp = cdpConnections.get(currentTarget);
        if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setMode(cdp, mode);
        res.json(result);
    });

    // Set Model
    app.post('/set-model', async (req, res) => {
        const { model } = req.body;
        const cdp = cdpConnections.get(currentTarget);
        if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setModel(cdp, model);
        res.json(result);
    });

    // Stop Generation
    app.post('/stop', async (req, res) => {
        const cdp = cdpConnections.get(currentTarget);
        if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await stopGeneration(cdp);
        res.json(result);
    });

    // Send message (Legacy endpoint - redirects to target-aware logic)
    app.post('/send', async (req, res) => {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        const cdp = cdpConnections.get(currentTarget);
        if (!cdp) {
            return res.status(503).json({ error: 'CDP not connected' });
        }

        const result = await TARGETS[currentTarget].injectMessage(cdp, message);

        console.log(`📨 /send [${currentTarget}] contexts:${cdp.contexts.length} result:${JSON.stringify(result)}`);

        // Always return 200 - the message usually goes through even if CDP reports issues
        // The client will refresh and see if the message appeared
        res.json({
            success: result.ok !== false,
            method: result.method || 'attempted',
            details: result
        });
    });

    // UI Inspection endpoint - Returns all buttons as JSON for debugging
    app.get('/ui-inspect', async (req, res) => {
        const cdp = cdpConnections.get(currentTarget);
        if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });

        const EXP = `(() => {
    try {
        // Safeguard for non-DOM contexts
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return { error: 'Non-DOM context' };
        }

        // Helper to get string class name safely (handles SVGAnimatedString)
        function getCls(el) {
            if (!el) return '';
            if (typeof el.className === 'string') return el.className;
            if (el.className && typeof el.className.baseVal === 'string') return el.className.baseVal;
            return '';
        }

        // Helper to pierce Shadow DOM
        function findAllElements(selector, root = document) {
            let results = Array.from(root.querySelectorAll(selector));
            const elements = root.querySelectorAll('*');
            for (const el of elements) {
                try {
                    if (el.shadowRoot) {
                        results = results.concat(Array.from(el.shadowRoot.querySelectorAll(selector)));
                    }
                } catch (e) { }
            }
            return results;
        }

        // Get standard info
        const url = window.location ? window.location.href : '';
        const title = document.title || '';
        const bodyLen = document.body ? document.body.innerHTML.length : 0;
        const hasCascade = !!document.getElementById('cascade') || !!document.querySelector('.cascade');

        // Scan for buttons
        const allLucideElements = findAllElements('svg[class*="lucide"]').map(svg => {
            const parent = svg.closest('button, [role="button"], div, span, a');
            if (!parent || parent.offsetParent === null) return null;
            const rect = parent.getBoundingClientRect();
            return {
                type: 'lucide-icon',
                tag: parent.tagName.toLowerCase(),
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                svgClasses: getCls(svg),
                className: getCls(parent).substring(0, 100),
                ariaLabel: parent.getAttribute('aria-label') || '',
                title: parent.getAttribute('title') || '',
                parentText: (parent.innerText || '').trim().substring(0, 50)
            };
        }).filter(Boolean);

        const buttons = findAllElements('button, [role="button"]').map((btn, i) => {
            const rect = btn.getBoundingClientRect();
            const svg = btn.querySelector('svg');

            return {
                type: 'button',
                index: i,
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                text: (btn.innerText || '').trim().substring(0, 50) || '(empty)',
                ariaLabel: btn.getAttribute('aria-label') || '',
                title: btn.getAttribute('title') || '',
                svgClasses: getCls(svg),
                className: getCls(btn).substring(0, 100),
                visible: btn.offsetParent !== null
            };
        }).filter(b => b.visible);

        return {
            url, title, bodyLen, hasCascade,
            buttons, lucideIcons: allLucideElements
        };
    } catch (err) {
        return { error: err.toString(), stack: err.stack };
    }
})()`;

        try {
            const cdp = cdpConnections.get(currentTarget);
            if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });

            // 1. Get Frames
            const { frameTree } = await cdp.call("Page.getFrameTree");
            function flattenFrames(node) {
                let list = [{
                    id: node.frame.id,
                    url: node.frame.url,
                    name: node.frame.name,
                    parentId: node.frame.parentId
                }];
                if (node.childFrames) {
                    for (const child of node.childFrames) list = list.concat(flattenFrames(child));
                }
                return list;
            }
            const allFrames = flattenFrames(frameTree);

            // 2. Map Contexts
            const contexts = cdp.contexts.map(c => ({
                id: c.id,
                name: c.name,
                origin: c.origin,
                frameId: c.auxData ? c.auxData.frameId : null,
                isDefault: c.auxData ? c.auxData.isDefault : false
            }));

            // 3. Scan ALL Contexts
            const contextResults = [];
            for (const ctx of contexts) {
                try {
                    const result = await cdp.call("Runtime.evaluate", {
                        expression: EXP,
                        returnByValue: true,
                        contextId: ctx.id
                    });

                    if (result.result?.value) {
                        const val = result.result.value;
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            url: val.url,
                            title: val.title,
                            hasCascade: val.hasCascade,
                            buttonCount: val.buttons.length,
                            lucideCount: val.lucideIcons.length,
                            buttons: val.buttons, // Store buttons for analysis
                            lucideIcons: val.lucideIcons
                        });
                    } else if (result.exceptionDetails) {
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            error: `Script Exception: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''} `
                        });
                    } else {
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            error: 'No value returned (undefined)'
                        });
                    }
                } catch (e) {
                    contextResults.push({ contextId: ctx.id, error: e.message });
                }
            }

            // 4. Match and Analyze
            const cascadeFrame = allFrames.find(f => f.url.includes('cascade'));
            const matchingContext = contextResults.find(c => c.frameId === cascadeFrame?.id);
            const contentContext = contextResults.sort((a, b) => (b.buttonCount || 0) - (a.buttonCount || 0))[0];

            // Prepare "useful buttons" from the best context
            const bestContext = matchingContext || contentContext;
            const usefulButtons = bestContext ? (bestContext.buttons || []).filter(b =>
                b.ariaLabel?.includes('New Conversation') ||
                b.title?.includes('New Conversation') ||
                b.ariaLabel?.includes('Past Conversations') ||
                b.title?.includes('Past Conversations') ||
                b.ariaLabel?.includes('History')
            ) : [];

            res.json({
                summary: {
                    frameFound: !!cascadeFrame,
                    cascadeFrameId: cascadeFrame?.id,
                    contextFound: !!matchingContext,
                    bestContextId: bestContext?.contextId
                },
                frames: allFrames,
                contexts: contexts,
                scanResults: contextResults.map(c => ({
                    id: c.contextId,
                    frameId: c.frameId,
                    url: c.url,
                    hasCascade: c.hasCascade,
                    buttons: c.buttonCount,
                    error: c.error
                })),
                usefulButtons: usefulButtons,
                bestContextData: bestContext // Full data for the best context
            });

        } catch (e) {
            res.status(500).json({ error: e.message, stack: e.stack });
        }
    });

    // Endpoint to list all CDP targets - helpful for debugging connection issues
    app.get('/cdp-targets', async (req, res) => {
        const results = {};
        for (const port of PORTS) {
            try {
                const list = await getJson(`http://127.0.0.1:${port}/json/list`);
                results[port] = list;
            } catch (e) {
                results[port] = e.message;
            }
        }
        res.json(results);
    });

    // WebSocket connection with Auth check
    wss.on('connection', (ws, req) => {
        // Parse cookies from headers
        const rawCookies = req.headers.cookie || '';
        const parsedCookies = {};
        rawCookies.split(';').forEach(c => {
            const [k, v] = c.trim().split('=');
            if (k && v) {
                try {
                    parsedCookies[k] = decodeURIComponent(v);
                } catch (e) {
                    parsedCookies[k] = v;
                }
            }
        });

        // Verify signed cookie manually
        const signedToken = parsedCookies[AUTH_COOKIE_NAME];
        let isAuthenticated = false;

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            isAuthenticated = true;
        } else if (signedToken) {
            const sessionSecret = process.env.SESSION_SECRET || 'antigravity_secret_key_1337';
            const token = cookieParser.signedCookie(signedToken, sessionSecret);
            if (token === AUTH_TOKEN) {
                isAuthenticated = true;
            }
        }

        if (!isAuthenticated) {
            console.log('🚫 Unauthorized WebSocket connection attempt');
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            setTimeout(() => ws.close(), 100);
            return;
        }

        console.log('📱 Client connected (Authenticated)');

        ws.on('close', () => {
            console.log('📱 Client disconnected');
        });
    });

    return { server, wss, app, hasSSL };
}

// Main
async function main() {
    try {
        await initCDP();
    } catch (err) {
        console.warn(`⚠️  Initial CDP discovery failed: ${err.message}`);
        console.log('💡 Start Antigravity with --remote-debugging-port=9000 to connect.');
    }

    try {
        // Initialize Server
        const { server, wss, app, hasSSL } = await createServer();
        
        // Start background polling
        startPolling(wss);

        // --- ADDITIONAL MULTI-TARGET ENDPOINTS ---

        // Target Switcher API
        app.get('/targets', (req, res) => {
            const list = [
                { id: 'antigravity', name: 'Antigravity Chat', connected: cdpConnections.has('antigravity') },
                { id: 'claude', name: 'Claude Extension', connected: cdpConnections.has('claude') }
            ];
            res.json({ current: currentTarget, targets: list });
        });

        app.post('/switch-target', async (req, res) => {
            const { target } = req.body;
            if (!['antigravity', 'claude'].includes(target)) {
                return res.status(400).json({ error: 'Invalid target' });
            }
            
            console.log(`🔄 Switching target to: ${target}`);

            // Clear browser-side image/CSS cache for the target being switched away from.
            // Must run BEFORE currentTarget changes — otherwise TARGETS[currentTarget] is the new target.
            const prevTargetModule = TARGETS[currentTarget];
            if (prevTargetModule?.invalidateSnapshotCache) {
                const prevCdp = cdpConnections.get(currentTarget);
                if (prevCdp) {
                    prevTargetModule.invalidateSnapshotCache(prevCdp).catch(() => {});
                }
            }

            currentTarget = target;
            lastSnapshot = null; // Force clear
            lastSnapshotHash = null;
            invalidateDiffCache();
            lastBroadcastCssHash = '';

            // Trigger immediate discovery attempt if not connected
            if (!cdpConnections.has(target)) {
                await initCDP();
            }

            res.json({ success: true, current: currentTarget });
        });

        // Claude Code toolbar actions
        app.post('/claude/action', async (req, res) => {
            const { action } = req.body;
            if (!action) return res.status(400).json({ error: 'action required' });

            const cdp = cdpConnections.get('claude');
            if (!cdp) return res.status(503).json({ error: 'Claude CDP not connected' });

            const result = await claude.performAction(cdp, action);
            res.json(result);
        });

        app.get('/claude/toolbar-state', async (req, res) => {
            const cdp = cdpConnections.get('claude');
            if (!cdp) return res.json({ editAuto: null });
            const state = await claude.getToolbarState(cdp);
            res.json(state);
        });

        // AskUserQuestion detection and interaction
        app.get('/claude/question', async (req, res) => {
            const cdp = cdpConnections.get('claude');
            if (!cdp) return res.json({ detected: false });
            const result = await claude.detectQuestion(cdp);
            res.json(result);
        });

        app.post('/claude/question/select', async (req, res) => {
            const { index } = req.body;
            if (index === undefined) return res.status(400).json({ error: 'index required' });
            const cdp = cdpConnections.get('claude');
            if (!cdp) return res.status(503).json({ error: 'Claude CDP not connected' });
            const result = await claude.selectOption(cdp, index);
            res.json(result);
        });

        app.post('/claude/question/submit', async (req, res) => {
            const cdp = cdpConnections.get('claude');
            if (!cdp) return res.status(503).json({ error: 'Claude CDP not connected' });
            const result = await claude.submitAnswer(cdp);
            res.json(result);
        });

        // Set "Other" text input value
        app.post('/claude/question/other-text', async (req, res) => {
            const { text } = req.body;
            if (text === undefined) return res.status(400).json({ error: 'text required' });
            const cdp = cdpConnections.get('claude');
            if (!cdp) return res.status(503).json({ error: 'Claude CDP not connected' });
            const result = await claude.setOtherText(cdp, text);
            res.json(result);
        });

        // Debug: dump DOM structure of AskUserQuestion
        app.get('/claude/question/debug', async (req, res) => {
            const cdp = cdpConnections.get('claude');
            if (!cdp) return res.json({ error: 'no CDP' });
            const result = await claude.debugQuestionDOM(cdp);
            res.json(result);
        });

        // Cancel AskUserQuestion (send Escape)
        app.post('/claude/question/cancel', async (req, res) => {
            const cdp = cdpConnections.get('claude');
            if (!cdp) return res.status(503).json({ error: 'Claude CDP not connected' });
            const result = await claude.cancelQuestion(cdp);
            res.json(result);
        });

        // Navigate between questions (prev/next/index)
        app.post('/claude/question/navigate', async (req, res) => {
            const { direction } = req.body;
            if (!direction) return res.status(400).json({ error: 'direction required (next/prev/index)' });
            const cdp = cdpConnections.get('claude');
            if (!cdp) return res.status(503).json({ error: 'Claude CDP not connected' });
            const result = await claude.navigateQuestion(cdp, direction);
            res.json(result);
        });

        // Remote Click
        app.post('/remote-click', async (req, res) => {
            const { selector, index, textContent } = req.body;
            const cdp = cdpConnections.get(currentTarget);
            if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await clickElement(cdp, { selector, index, textContent });
            res.json(result);
        });

        // Remote Scroll - sync phone scroll to desktop
        app.post('/remote-scroll', async (req, res) => {
            const { scrollTop, scrollPercent } = req.body;
            const cdp = cdpConnections.get(currentTarget);
            if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await remoteScroll(cdp, { scrollTop, scrollPercent });
            res.json(result);
        });

        // Get App State
        app.get('/app-state', async (req, res) => {
            const cdp = cdpConnections.get(currentTarget);
            if (!cdp) return res.json({ mode: 'Unknown', model: 'Unknown' });
            if (currentTarget === 'claude') {
                const toolbar = await claude.getToolbarState(cdp);
                return res.json({
                    mode: toolbar.editAuto === true ? 'Auto Edit' : toolbar.editAuto === false ? 'Manual Edit' : 'Unknown',
                    model: 'Claude Code'
                });
            }
            const result = await getAppState(cdp);
            res.json(result);
        });

        // Start New Chat
        app.post('/new-chat', async (req, res) => {
            const cdp = cdpConnections.get(currentTarget);
            if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await startNewChat(cdp);
            res.json(result);
        });

        // Get Chat History
        app.get('/chat-history', async (req, res) => {
            const cdp = cdpConnections.get(currentTarget);

            // Claude Code: Try DOM scraping first if connected, else fallback to FS
            if (currentTarget === 'claude' && cdp) {
                try {
                    const result = await getClaudeChatHistoryFromDOM(cdp);
                    if (result.success && result.chats && result.chats.length > 0) {
                        return res.json(result);
                    }
                    console.log('⚠️ DOM scraping for Claude history found nothing, falling back to FS');
                } catch (e) {
                    console.error('❌ DOM scraping for Claude history failed:', e);
                }
            }

            // Claude Code: read history from filesystem (~/.claude/projects/) as PRIMARY for 'claude' or fallback
            if (currentTarget === 'claude') {
                try {
                    const projectsDir = join(os.homedir(), '.claude', 'projects');
                    const chats = [];
                    const seenSessions = new Set();

                    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
                        .filter(d => d.isDirectory())
                        .map(d => join(projectsDir, d.name));

                    for (const projectDir of projectDirs) {
                        const jsonlFiles = fs.readdirSync(projectDir)
                            .filter(f => f.endsWith('.jsonl'));

                        for (const file of jsonlFiles) {
                            const sessionId = file.replace('.jsonl', '');
                            if (seenSessions.has(sessionId)) continue;
                            seenSessions.add(sessionId);

                            const filePath = join(projectDir, file);
                            const stat = fs.statSync(filePath);
                            const mtime = stat.mtimeMs;

                            // Read lines to find first user message as title
                            const content = fs.readFileSync(filePath, 'utf8');
                            const lines = content.split('\n').filter(l => l.trim());
                            let title = null;
                            for (const line of lines) {
                                try {
                                    const obj = JSON.parse(line);
                                    if (obj.type === 'user' && obj.message?.content) {
                                        const textPart = typeof obj.message.content === 'string' 
                                            ? obj.message.content 
                                            : (Array.isArray(obj.message.content) 
                                                ? obj.message.content.find(p => p.type === 'text')?.text 
                                                : null);
                                        const t = (textPart || '').trim();
                                        if (t.length > 2 && !t.startsWith('<') && t.length < 500) {
                                            title = t.substring(0, 80);
                                            break;
                                        }
                                    }
                                } catch {}
                            }
                            if (title) chats.push({ title, sessionId, mtime, projectDir });
                            else chats.push({ title: `Session ${sessionId.substring(0, 8)}`, sessionId, mtime, projectDir });
                        }
                    }

                    // Sort newest first
                    chats.sort((a, b) => b.mtime - a.mtime);
                    return res.json({ success: true, chats: chats.slice(0, 50) });
                } catch (e) {
                    return res.json({ error: e.message, chats: [] });
                }
            }

            // Antigravity: scrape via CDP
            if (!cdp) return res.json({ error: 'CDP disconnected', chats: [] });
            const result = await getChatHistory(cdp);
            res.json(result);
        });

        // Select a Chat
        app.post('/select-chat', async (req, res) => {
            const { title, sessionId } = req.body;
            if (!title) return res.status(400).json({ error: 'Chat title required' });
            const cdp = cdpConnections.get(currentTarget);
            if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });

            // Claude Code: navigate via CDP inside the extension webview
            if (currentTarget === 'claude') {
                const result = await selectClaudeChat(cdp, title, sessionId);
                return res.json(result);
            }

            const result = await selectChat(cdp, title);
            res.json(result);
        });

        // Close Chat History
        app.post('/close-history', async (req, res) => {
            const cdp = cdpConnections.get(currentTarget);
            if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await closeHistory(cdp);
            res.json(result);
        });

        const localIP = getLocalIP();
        const protocol = hasSSL ? 'https' : 'http';
        
        // Ensure port is free
        await killPortProcess(SERVER_PORT);
        
        server.listen(SERVER_PORT, '0.0.0.0', () => {
            console.log(`\n🚀 [PHONE-CHAT] Server running at ${protocol}://localhost:${SERVER_PORT}`);
            console.log(`🔐 App Password: ${APP_PASSWORD}`);
            console.log(`📱 Direct link (same Wi-Fi): ${protocol}://${localIP}:${SERVER_PORT}`);
            console.log(`🌐 Public tunnel (ngrok): Use your ngrok URL\n`);
        });

        // Graceful shutdown handlers
        const gracefulShutdown = (signal) => {
            console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
            wss.close(() => console.log('   WebSocket server closed'));
            server.close(() => console.log('   HTTP server closed'));
            
            for (const [name, conn] of cdpConnections) {
                if (conn.ws) {
                    conn.ws.close();
                    console.log(`   CDP connection [${name}] closed`);
                }
            }
            setTimeout(() => process.exit(0), 1000);
        };

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

main();
