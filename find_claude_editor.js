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

(async () => {
    const port = 9000;
    const list = await getJson(`http://127.0.0.1:${port}/json/list`);
    const claudeTargets = list.filter(t => t.url?.includes('Anthropic.claude-code'));
    
    console.log(`Found ${claudeTargets.length} Claude targets.`);

    for (const t of claudeTargets) {
        console.log(`- Testing ${t.id} (${t.title})...`);
        try {
            const ws = new WebSocket(t.webSocketDebuggerUrl);
            await new Promise((r, rej) => {
                ws.on('open', r);
                ws.on('error', rej);
                setTimeout(() => rej('Timeout'), 2000);
            });
            
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
            const res = await call("Runtime.evaluate", { 
                expression: `(() => {
                    const editors = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, input'));
                    return {
                        text: document.body.innerText.substring(0, 100),
                        editors: editors.map(e => ({ tagName: e.tagName, id: e.id, class: e.className }))
                    };
                })()`,
                returnByValue: true
            });
            
            console.log(`  Result:`, JSON.stringify(res?.value, null, 2));
            ws.close();
        } catch(e) {
            console.log(`  Failed: ${e}`);
        }
    }
    process.exit(0);
})();
