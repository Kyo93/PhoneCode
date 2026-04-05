import http from 'http';
import WebSocket from 'ws';

const PORTS = [9000, 9001, 9002, 9003];

async function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

async function discover() {
    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            const target = list.find(t => t.url?.includes('workbench.html'));
            if (target) return target.webSocketDebuggerUrl;
        } catch (e) {}
    }
    return null;
}

(async () => {
    const url = await discover();
    if (!url) { console.log('Workbench not found'); process.exit(1); }
    const ws = new WebSocket(url);
    await new Promise(r => ws.on('open', r));

    let id = 1;
    const call = (method, params) => new Promise(r => {
        const curId = id++;
        const handler = (m) => {
            const data = JSON.parse(m);
            if (data.id === curId) { ws.off('message', handler); r(data.result); }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id: curId, method, params }));
    });

    await call("Runtime.enable", {});
    const info = await call("Runtime.evaluate", { 
        expression: `(() => {
            function iterateFrames(root) {
                const results = [];
                // 1. Text in root
                if (root.innerText?.toLowerCase().includes('claude')) {
                   results.push({ type: 'root-text', text: root.innerText.substring(0, 100) });
                }
                
                // 2. Scan iframes
                const iframes = root.querySelectorAll('iframe');
                iframes.forEach(f => {
                   try {
                       results.push({ type: 'iframe', src: f.src, id: f.id });
                   } catch(e) {}
                });
                
                // 3. Scan specific VS Code IDs
                const knownIds = ['workbench.view.extension.claude-code', 'workbench.parts.sidebar'];
                knownIds.forEach(id => {
                   const el = document.getElementById(id);
                   if (el) results.push({ type: 'known-id', id: id, html: el.outerHTML.substring(0, 500) });
                });

                return results;
            }
            return iterateFrames(document.body);
        })()`,
        returnByValue: true
    });

    console.log(JSON.stringify(info?.value || [], null, 2));
    process.exit(0);
})();
