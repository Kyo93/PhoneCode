import WebSocket from 'ws';

const targetUrl = 'ws://127.0.0.1:9000/devtools/page/939C94042468D2C2302ACA261C5BF31A';

(async () => {
    const ws = new WebSocket(targetUrl);
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
            const all = Array.from(document.querySelectorAll('*'));
            return all.map(el => ({
                tagName: el.tagName,
                id: el.id,
                className: el.className,
                text: el.innerText?.substring(0, 50),
                editable: el.contentEditable === 'true' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'
            })).filter(el => el.editable);
        })()`,
        returnByValue: true
    });

    console.log(JSON.stringify(info?.value || [], null, 2));
    process.exit(0);
})();
