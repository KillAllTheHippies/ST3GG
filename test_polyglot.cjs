/* Run with Node >=22 and Chrome. Uses a real headless browser, no npm dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
require('./polyglot-core.js');
const C = global.PolyCore;
const outputDir = path.join(__dirname, '.polyglot-test');
fs.mkdirSync(outputDir, { recursive: true });
async function coreTests() {
    const enc = new TextEncoder(), image = new Uint8Array([137,80,78,71,13,10,26,10]);
    const entries = [{ name: 'AGENTS.md', bytes: enc.encode('inert\r\ntext\r\n') }, { name: 'docs/', bytes: new Uint8Array() }, { name: 'docs/file.bin', bytes: new Uint8Array([0,255,1]) }];
    const bytes = await C.writeZip(entries, image), read = await C.readZip(bytes);
    assert(C.equal(read.image, image)); assert(C.equal(read.entries[0].bytes, entries[0].bytes));
    // ZIP offsets relative to the appended archive are accepted on import.
    const relative = C.concat([image, await C.writeZip(entries)]);
    assert.equal((await C.readZip(relative)).entries.length, 3);
    await assert.rejects(C.readZip(new Uint8Array([80,75,3,4])), /directory/);
    const corrupt = bytes.slice(); corrupt[image.length + 30 + 'AGENTS.md'.length] ^= 1;
    assert.match((await C.readZip(corrupt)).entries[0].issue, /CRC/);
    assert.throws(() => C.collision(entries, 'docs/file.bin'), /collision/);
    assert.throws(() => C.collision(entries, 'docs'), /collision/);
    assert.throws(() => C.path('../escape'), /relative path/);
    const cancel = new AbortController(); cancel.abort();
    await assert.rejects(C.writeZip(entries, image, cancel.signal), /Cancelled/);
    const opaque = [{ name: 'encrypted.bin', bytes: null, raw: {
        flags: 9, method: 99, crc: 0, size: 10, packed: new Uint8Array([1,2,3]), version: 51,
        localExtra: new Uint8Array([1,153,0,0]), centralExtra: new Uint8Array([1,153,0,0])
    } }];
    const re = await C.readZip(await C.writeZip(opaque, image));
    assert.match(re.entries[0].issue, /Encrypted/);
    assert.equal(re.entries[0].raw.flags & 8, 8);
    assert(C.equal(re.entries[0].raw.localExtra, opaque[0].raw.localExtra));
    const plain = enc.encode('Deflated UTF-8 payload: repeated repeated repeated');
    const deflated = [{ name: 'compressed.txt', raw: { flags: 0x800, method: 8, size: plain.length, crc: C.crc(plain), packed: new Uint8Array(require('node:zlib').deflateRawSync(plain)) } }];
    assert(C.equal((await C.readZip(await C.writeZip(deflated, image))).entries[0].bytes, plain));
    console.log('PASS: ZIP offsets, CRC, collisions, cancellation, opaque metadata preservation.');
}
async function main() {
    await coreTests();
    const server = http.createServer((req, res) => {
        const target = path.resolve(__dirname, '.' + decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
        if (!target.startsWith(__dirname + path.sep)) { res.writeHead(403).end(); return; }
        fs.readFile(target, (error, data) => {
            if (error) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.html') ? 'text/html' : 'application/octet-stream');
            res.end(data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'st3gg-poly-test-'));
    const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true });
    let socket;
    try {
        const endpoint = await new Promise((resolve, reject) => {
            let stderr = '';
            const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000);
            chrome.on('error', reject);
            chrome.stderr.on('data', data => {
                stderr += data;
                const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
                if (match) { clearTimeout(timer); resolve(match[1]); }
            });
        });
        console.log('Chrome debugger port:', endpoint);
        const targets = await (await fetch(`http://127.0.0.1:${endpoint}/json`, { signal: AbortSignal.timeout(10000) })).json();
        socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Debugger WebSocket timed out')), 10000);
            socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
            socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Debugger WebSocket failed')); }, { once: true });
        });
        let serial = 0; const pending = new Map(), errors = [];
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
            if (!message.id) return;
            const p = pending.get(message.id); pending.delete(message.id);
            if (message.error) p.reject(new Error(JSON.stringify(message.error))); else p.resolve(message.result);
        };
        function call(method, params = {}) {
            return new Promise((resolve, reject) => {
                const id = ++serial;
                const timer = setTimeout(() => { pending.delete(id); reject(new Error('Debugger timeout: ' + method)); }, 120000);
                pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
                socket.send(JSON.stringify({ id, method, params }));
            });
        }
        async function evaluate(expression) {
            const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        await call('Runtime.enable'); await call('Page.enable');
        await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await call('Page.navigate', { url: `http://127.0.0.1:${port}` });
        for (let i = 0; i < 100; i++) {
            if (await evaluate("!!window.PolyWorkspace && document.readyState === 'complete'")) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log('Browser:', await evaluate('navigator.userAgent'));
        const result = await evaluate(`(async () => {
            const C = PolyCore, W = PolyWorkspace, enc = new TextEncoder();
            const checks = [];
            function ok(value, label) { if (!value) throw new Error(label); checks.push(label); }
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
            const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(256,256);
            let seed = 42;
            for (let i=0; i<pixels.data.length; i+=4) {
                for (let j=0;j<3;j++) { seed = (seed*1664525+1013904223)>>>0; pixels.data[i+j] = seed>>>24; }
                pixels.data[i+3] = 255;
            }
            ctx.putImageData(pixels,0,0);
            const carrier = await W.canvasBytes(canvas), payload = 'Nested test payload';
            const methodResults = {};
            for (const method of Object.keys(W.methods).filter(x=>x!=='none')) {
                const node = C.layer(method === 'F5' ? 'test.jpg' : 'test.png', carrier);
                node.settings = {method, payload, options: {password:'test-password'}};
                node.imageDirty = true;
                try { const out = await W.adapter.encode(node); methodResults[method] = out.status; }
                catch (e) { methodResults[method] = 'BLOCKED: '+e.message; }
            }
            const root = C.layer('outer.png', carrier);
            root.settings = {method:'LSB',payload,options:{channels:'RGB',bits:1}}; root.imageDirty=true;
            const a=C.layer('branch-a.png',carrier), b=C.layer('branch-b.png',carrier), deep=C.layer('deeper.png',carrier);
            a.parent=root; b.parent=root; deep.parent=a;
            a.settings={method:'PNGCHUNK',payload:'branch payload',options:{}}; a.imageDirty=true;
            b.settings={method:'SPECTER',payload:'private branch',options:{password:'secret',encryption:'ghost'}}; b.imageDirty=true;
            root.entries=[{name:'AGENTS.md',bytes:enc.encode('Do not execute.\\r\\n'),kind:'file'},
                {name:'data.bin',bytes:new Uint8Array([0,255,14,33]),kind:'file'},
                {name:a.name,child:a,kind:'layer'},{name:b.name,child:b,kind:'layer'}];
            a.entries=[{name:deep.name,child:deep,kind:'layer'}];
            deep.entries=[{name:'README.md',bytes:enc.encode('original\\r\\n'),kind:'file'}];
            b.entries=[{name:'ordinary.png',bytes:carrier,kind:'file'}];
            const built=await C.build(root,W.adapter);
            const jpeg=C.layer('f5.jpg',carrier); jpeg.settings={method:'F5',payload:'jpeg payload',options:{password:'jpeg-password'}}; jpeg.imageDirty=true;
            jpeg.entries=[{name:'README.md',bytes:enc.encode('jpeg archive'),kind:'file'}];
            const jpegOutput=await C.build(jpeg,W.adapter);
            ok((await C.open(jpegOutput,'f5.jpg',W.canvasOf)).entries.length===1,'JPEG polyglot build and reopen');
            const reopened=await C.open(built,'outer.png',W.canvasOf);
            const ra=reopened.entries.find(e=>e.child?.name==='branch-a.png').child;
            const rb=reopened.entries.find(e=>e.child?.name==='branch-b.png').child;
            const rd=ra.entries[0].child, oldSibling=rb.original.slice(), oldImage=reopened.image.slice(), oldA=ra.image.slice();
            ok(rb.entries[0].kind==='file','ordinary image remains ordinary');
            ok(reopened.entries.filter(e=>e.child).length===2 && rd.entries.length===1,'branching discovery');
            rd.entries[0].bytes=enc.encode('edited deeply\\r\\n'); C.dirty(rd);
            const rebuilt=await C.build(reopened,W.adapter);
            ok(C.equal(rb.original,oldSibling),'untouched sibling byte-identical');
            ok(C.equal(reopened.image,oldImage) && C.equal(ra.image,oldA),'ancestor image bytes unchanged');
            const again=await C.open(rebuilt,'outer.png',W.canvasOf);
            ok(new TextDecoder().decode(again.entries[2].child.entries[0].child.entries[0].bytes)==='edited deeply\\r\\n','deep text edit recovered');
            ok(C.equal(again.entries[1].bytes,new Uint8Array([0,255,14,33])),'ordinary binary unchanged');
            ok(new TextDecoder().decode(await decode(await W.canvasOf(again.image),'RGB',1))===payload,'outer image payload intact');
            // Iterative processing has no Matryoshka limit.
            const many=C.layer('depth0.png',carrier); let current=many;
            for(let i=1;i<=16;i++) { const next=C.layer('depth'+i+'.png',carrier); next.parent=current; current.entries=[{name:next.name,child:next,kind:'layer'}]; current=next; }
            const manyBytes=await C.build(many,W.adapter); let opened=await C.open(manyBytes,many.name,W.canvasOf), depth=0;
            while(opened.entries[0]?.child) {depth++;opened=opened.entries[0].child;}
            ok(depth===16,'16 nested edges exceed old depth limit');
            const cancelled=C.layer('cancel.png',carrier); cancelled.entries=[{name:'x',bytes:enc.encode('x')}];
            const ac=new AbortController();
            try {await C.build(cancelled,W.adapter,ac.signal,()=>ac.abort()); throw new Error('did not cancel');}
            catch(e) {ok(e.message.includes('Cancelled') && cancelled.original===null && cancelled.dirty,'cancel leaves edits uncommitted');}
            const failure=C.layer('bad-extension.jpg',carrier), staged=C.layer('valid.png',carrier); staged.parent=failure;
            failure.entries=[{name:staged.name,child:staged,kind:'layer'}];
            try {await C.build(failure,W.adapter); throw new Error('did not reject');}
            catch(e) {ok(e.message.includes('filename') && staged.original===null && staged.dirty,'failed outer validation does not commit children');}
            const bomEntry={bytes:enc.encode('\\ufeffone\\r\\ntwo\\r\\n')};
            W.textDraft(bomEntry); ok(C.equal(bomEntry.bytes,enc.encode('\\ufeffone\\r\\ntwo\\r\\n')),'opening BOM/CRLF text preserves bytes');
            const b64 = bytes => {let s=''; for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
            const sizeMap=PolySize.measure(reopened);
            ok(sizeMap.total===rebuilt.length && sizeMap.parts.reduce((sum,part)=>sum+part.bytes,0)===rebuilt.length,'size map matches output without double-counting descendants');
            for(const record of sizeMap.records.values()) {
                ok(record.parts.reduce((sum,part)=>sum+part.bytes,0)===record.total,'layer size contributions sum to its actual byte size');
                for(const part of record.parts)if(part.child)ok(part.bytes===part.child.total,'stored child contribution matches child output');
            }
            const fixtures = [];
            for (const definition of PolyDemos.catalog) {
                const fixture = await PolyDemos.create(definition.id, {core:C,adapter:W.adapter,canvasBytes:W.canvasBytes,canvasOf:W.canvasOf,decodePayload:W.decodePayload});
                if (definition.id === 'reopen-edit') {
                    const deepest = PolyDemos.find(fixture.root,['branch-a.png','deeper.png']);
                    deepest.entries[0].bytes = enc.encode('Saved deep demo edit\\r\\n'); C.dirty(deepest);
                }
                const bytes = await C.build(fixture.root,W.adapter);
                if (fixture.verify) ok((await fixture.verify(fixture.root)).length===4,'reopen demo verifies byte and payload preservation');
                const loaded = await C.open(bytes,fixture.root.name,W.canvasOf);
                ok(loaded.entries.length===fixture.root.entries.length,definition.id+' fixture builds and reopens');
                fixtures.push({id:definition.id,bytes:b64(bytes)});
            }
            return {checks,methodResults,original:b64(built),rebuilt:b64(rebuilt),jpeg:b64(jpegOutput),fixtures};
        })()`);
        fs.writeFileSync(path.join(outputDir, 'outer.png'), Buffer.from(result.original, 'base64'));
        fs.writeFileSync(path.join(outputDir, 'rebuilt.png'), Buffer.from(result.rebuilt, 'base64'));
        fs.writeFileSync(path.join(outputDir, 'f5.jpg'), Buffer.from(result.jpeg, 'base64'));
        for(const fixture of result.fixtures) fs.writeFileSync(path.join(outputDir, fixture.id+'.png'),Buffer.from(fixture.bytes,'base64'));
        console.log(JSON.stringify({ checks: result.checks, methods: result.methodResults }, null, 2));
        // Exercise the actual UI and pending-draft behavior in Chrome.
        await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.join(outputDir,'downloads')});
        await evaluate("document.querySelector('[data-tab=polyglot]').click()");
        await new Promise(resolve=>setTimeout(resolve,500));
        fs.writeFileSync(path.join(outputDir,'flow-01-home.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        const guidedName='guided-'+Date.now()+'.png', rebuiltName='guided-rebuilt-'+Date.now()+'.png';
        fs.writeFileSync(path.join(outputDir,'guided-attachment.bin'),Buffer.from([0,255,8,16,32]));
        await evaluate(`(async()=>{
            window.confirm=()=>true;
            window.flowPause=()=>new Promise(r=>setTimeout(r,30));
            window.flowReady=async()=>{for(let i=0;i<1000&&document.querySelector('.flow-progress');i++)await flowPause();if(document.querySelector('.flow-progress'))throw new Error('Guided operation timed out');};
            window.flowClick=async id=>{document.getElementById(id).click();await flowPause();await flowReady();};
            window.flowNote=async(name,text)=>{await flowClick('flow-add-note');const filename=document.getElementById('flow-note-name');filename.value=name;const body=document.getElementById('flow-note-content');body.value=text;body.dispatchEvent(new Event('input'));await flowClick('flow-save-note');};
            if(document.querySelector('#poly-advanced').open)throw new Error('Expert controls are exposed by default');
            if(document.querySelector('.flow-steps')||document.getElementById('flow-next'))throw new Error('Composition still requires navigating steps');
            if(!document.getElementById('flow-filename')||!document.getElementById('flow-add-files')||!document.getElementById('flow-image-agent'))throw new Error('Image and archive controls are not on the same page');
            await flowClick('flow-build-direct');
            if(!document.getElementById('flow-download-again'))throw new Error('Build requires unnecessary wizard steps');
            if([...document.querySelectorAll('#poly-flow select')].some(e=>e.checkVisibility()))throw new Error('Technical method choices are exposed in the guided flow');
            await flowNote('AGENTS.md','Guided outer note\\n');
            await flowClick('flow-add-message');document.getElementById('flow-message-content').value='Guided hidden message';await flowClick('flow-save-message');
            await flowClick('flow-add-nested');await flowNote('README.md','Nested note\\n');
            await flowClick('flow-add-nested');await flowNote('README.md','Deep note\\n');
            await flowClick('flow-back');
            await flowClick('flow-back');
            await flowClick('flow-add-nested');await flowNote('notes.txt','Untouched sibling\\n');await flowClick('flow-back');
        })()`);
        // Inline editing leaves image and archive controls available on the composition page.
        async function pointerClick(x,y) {
            await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
            await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
            await new Promise(r=>setTimeout(r,80));
        }
        await evaluate(`(async()=>{
            if(!document.getElementById('flow-image-agent')||!document.getElementById('flow-upload-cover'))throw new Error('Carrier actions hidden from composition');
            if(document.querySelector('[data-tab=polyglot]').textContent!=='Nested polyglots')throw new Error('Unclear workspace tab');
            await flowClick('flow-add-note');
            const name=document.getElementById('flow-note-name');name.value='draft.txt';name.dispatchEvent(new Event('input'));
            const text=document.getElementById('flow-note-content');text.value='Retained on dismissal';text.dispatchEvent(new Event('input'));
        })()`);
        assert(await evaluate(`!document.getElementById('poly-flow-dialog').matches(':modal') && document.getElementById('flow-inline-archive').contains(document.getElementById('poly-flow-dialog'))`),'Text editor opens outside the composition');
        await evaluate(`document.querySelector('.flow-dialog-heading button').click()`);
        await evaluate(`(async()=>{
            await flowClick('flow-add-note');
            if(document.getElementById('flow-note-name').value!=='draft.txt'||document.getElementById('flow-note-content').value!=='Retained on dismissal')throw new Error('New text draft lost on backdrop dismissal');
            [...document.querySelectorAll('#poly-flow-dialog button')].find(b=>b.textContent==='Discard changes').click();await flowPause();
            await flowClick('flow-add-message');
            const text=document.getElementById('flow-message-content');text.value='Retained payload draft';text.dispatchEvent(new Event('input'));
        })()`);
        await evaluate(`document.querySelector('.flow-dialog-heading button').click()`);
        await evaluate(`(async()=>{
            await flowClick('flow-add-message');
            if(document.getElementById('flow-message-content').value!=='Retained payload draft')throw new Error('Payload draft lost on dismissal');
            [...document.querySelectorAll('#poly-flow-dialog button')].find(b=>b.textContent==='Discard draft').click();await flowPause();
            const settings=[...document.querySelectorAll('.flow-inline-options > summary')].find(e=>e.textContent==='Encoding method, file payload & capacity');settings.click();await flowPause();
            if(document.querySelector('#poly-advanced').open)throw new Error('Encoding opened a separate workspace');
            if(!settings.parentElement.querySelector('select').checkVisibility())throw new Error('Inline encoding controls missing');
            const section=title=>[...document.querySelectorAll('.flow-inline-options')].find(e=>e.firstElementChild.textContent===title);
            let method=section('Encoding method, file payload & capacity').querySelector('select');
            method.value='SPECTER';method.dispatchEvent(new Event('change'));await flowPause();
            section('Detect or decode an existing image payload').firstElementChild.click();await flowPause();
            let decoder=section('Detect or decode an existing image payload').querySelector('select');
            decoder.value='PALETTE';decoder.dispatchEvent(new Event('change'));await flowPause();
            method=section('Encoding method, file payload & capacity').querySelector('select');
            if(method.value!=='SPECTER')throw new Error('Inline decoding changed encoding settings');
            method.value='LSB';method.dispatchEvent(new Event('change'));await flowPause();
            section('Encoding method, file payload & capacity').firstElementChild.click();
            section('Detect or decode an existing image payload').firstElementChild.click();
            document.getElementById('poly-advanced').showModal();
        })()`);
        await pointerClick(5,5);
        assert(!await evaluate(`document.getElementById('poly-advanced').open`),'Backdrop did not dismiss encoding tools');
        await evaluate(`showChecklistModal()`);
        await pointerClick(5,5);
        assert(await evaluate(`document.getElementById('checklist-modal').style.display==='none'`),'Backdrop did not dismiss analysis checklist');
        await evaluate(`(async()=>{document.querySelector('.flow-project-menu > summary').click();})()`);
        await pointerClick(5,5);
        assert(!await evaluate(`document.querySelector('.flow-project-menu').open`),'Project menu did not dismiss outside');
        console.log('PASS: unified composition, inline text and encoding, retained drafts, legacy modal and menu dismissal.');
        async function attachFile(selector, file) {
            const {root:documentRoot}=await call('DOM.getDocument');
            const {nodeId}=await call('DOM.querySelector',{nodeId:documentRoot.nodeId,selector});
            assert(nodeId,'Missing upload control: '+selector);
            await call('DOM.setFileInputFiles',{nodeId,files:[file]});
            await evaluate('(async()=>{await flowPause();await flowReady();})()');
        }
        await attachFile('#flow-files',path.join(outputDir,'guided-attachment.bin'));
        await new Promise(resolve=>setTimeout(resolve,300));
        fs.writeFileSync(path.join(outputDir,'flow-02-contents.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await evaluate(`(async()=>{const name=document.getElementById('flow-filename');name.value=${JSON.stringify(guidedName)};name.dispatchEvent(new Event('input'));})()`);
        fs.writeFileSync(path.join(outputDir,'flow-03-cover.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await evaluate(`(async()=>{
            await flowClick('flow-size-map');
            if(!document.querySelector('.flow-size-bar')||!document.querySelector('.flow-size-tree'))throw new Error('Size map is missing graph or hierarchy');
        })()`);
        fs.writeFileSync(path.join(outputDir,'flow-size-map.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await evaluate(`(async()=>{
            document.querySelector('.flow-dialog-heading button').click();await flowPause();
            window.__agentRealFetch=window.fetch;window.__agentRequests=[];
            const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;canvas.getContext('2d').fillRect(0,0,320,240);
            const data=await PolyWorkspace.canvasBytes(canvas);let binary='';for(const b of data)binary+=String.fromCharCode(b);const image=btoa(binary);
            window.fetch=async(url,options={})=>{
                if(String(url).endsWith('/images')&&options.method==='POST'){
                    if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
                    if(window.__agentFailure)return new Response(JSON.stringify({error:{message:'Mock provider rejected image generation'}}),{status:400});
                    const body=JSON.parse(options.body);window.__agentRequests.push(body);
                    return new Response(JSON.stringify({data:[{b64_json:image,media_type:'image/png'}],usage:{cost:0}}),{status:200,headers:{'Content-Type':'application/json'}});
                }
                if(String(url).endsWith('/images/models'))return new Response(JSON.stringify({data:[{id:'test/image-model',architecture:{output_modalities:['image']}}]}),{status:200});
                if(String(url).startsWith('https://openrouter.ai/'))throw new Error('Unexpected provider request in test');
                return window.__agentRealFetch(url,options);
            };
            ST3GGImageAgent.configure({apiKey:'test-placeholder-not-a-secret',model:'test/image-model'});
            const models=await ST3GGImageAgent.models();if(models[0].id!=='test/image-model')throw new Error('Image model discovery failed');
            window.__agentFailure=true;
            try {await ST3GGImageAgent.generate({prompt:'Failure test'});throw new Error('Provider failure was not reported');}catch(e){if(!e.message.includes('Mock provider'))throw e;}finally{window.__agentFailure=false;}
            const aborted=new AbortController();aborted.abort();
            try{await ST3GGImageAgent.generate({prompt:'Cancel test',signal:aborted.signal});throw new Error('Provider cancellation was not reported');}catch(e){if(e.name!=='AbortError')throw e;}
            document.getElementById('aiagent-image-prompt').value='Legacy Agent shared service test';await generateCarrierImage();
            if(!state.aiAgentConcealCanvas || window.__agentRequests.length!==1)throw new Error('Existing Agent tab is not using the shared image service');
            window.__agentRequests=[];
            await flowClick('flow-image-agent');
            document.getElementById('flow-agent-prompt').value='A textured astronomical photograph';document.getElementById('flow-agent-scope').value='all';document.getElementById('flow-agent-edge').value='160';
            await flowClick('flow-agent-generate');
            if(window.__agentRequests.length!==4||document.querySelectorAll('.flow-agent-preview').length!==4)throw new Error('Agent did not prepare one real model response per layer');
            if(window.__agentRequests.some(body=>Object.keys(body).some(key=>!['model','prompt'].includes(key))))throw new Error('Agent transmitted unexpected archive/config data');
            if(document.getElementById('flow-agent-apply').disabled)throw new Error('Agent previews cannot be applied');
        })()`);
        fs.writeFileSync(path.join(outputDir,'flow-agent-previews.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await evaluate(`(async()=>{
            await flowClick('flow-agent-apply');
            window.fetch=window.__agentRealFetch;
        })()`);
        await evaluate("flowClick('flow-build-direct')");
        assert(await evaluate("!!document.getElementById('flow-download-again')"),'Guided creation did not reach success');
        for(let i=0;i<100&&!fs.existsSync(path.join(outputDir,'downloads',guidedName));i++)await new Promise(r=>setTimeout(r,50));
        const guidedBytes=new Uint8Array(fs.readFileSync(path.join(outputDir,'downloads',guidedName)));
        const guidedZip=await C.readZip(guidedBytes);
        assert(C.equal(guidedZip.entries.find(e=>e.name==='guided-attachment.bin').bytes,new Uint8Array([0,255,8,16,32])));
        await evaluate(`(async()=>{const rootImage=${JSON.stringify(Buffer.from(guidedZip.image).toString('base64'))};const raw=Uint8Array.from(atob(rootImage),c=>c.charCodeAt(0));if(new TextDecoder().decode(await PolyWorkspace.decodePayload({settings:{method:'LSB',options:{channels:'RGB',bits:1}}},raw,await PolyWorkspace.canvasOf(raw)))!=='Guided hidden message')throw new Error('Default message encoding failed');})()`);
        await new Promise(resolve=>setTimeout(resolve,300));
        fs.writeFileSync(path.join(outputDir,'flow-05-success.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await attachFile('#flow-menu-open-file',path.join(outputDir,'downloads',guidedName));
        await evaluate(`(async()=>{
            const open=async text=>{const target=[...document.querySelectorAll('.flow-entry')].find(b=>b.querySelector('strong').textContent===text);if(!target)throw new Error('Missing guided item '+text);target.click();await flowPause();};
            await open('nested-image.png');await open('nested-image.png');await open('README.md');
            const note=document.getElementById('flow-note-content');note.value+='Edited after reopening.\\n';note.dispatchEvent(new Event('input'));await flowClick('flow-save-note');
            await flowClick('flow-back');await flowClick('flow-back');
            const name=document.getElementById('flow-filename');name.value=${JSON.stringify(rebuiltName)};name.dispatchEvent(new Event('input'));await flowClick('flow-build-direct');
        })()`);
        for(let i=0;i<100&&!fs.existsSync(path.join(outputDir,'downloads',rebuiltName));i++)await new Promise(r=>setTimeout(r,50));
        const guidedRebuilt=new Uint8Array(fs.readFileSync(path.join(outputDir,'downloads',rebuiltName)));
        const guidedReopened=await C.readZip(guidedRebuilt);
        assert(C.equal(guidedReopened.image,guidedZip.image),'Guided archive edits altered outer image bytes');
        assert(C.equal(guidedReopened.entries.find(e=>e.name==='nested-image-2.png').bytes,guidedZip.entries.find(e=>e.name==='nested-image-2.png').bytes),'Guided edit altered sibling bytes');
        const guidedA=await C.readZip(guidedReopened.entries.find(e=>e.name==='nested-image.png').bytes);
        const guidedDeep=await C.readZip(guidedA.entries.find(e=>e.name==='nested-image.png').bytes);
        assert(new TextDecoder().decode(guidedDeep.entries[0].bytes).includes('Edited after reopening.'));
        assert(C.equal(new Uint8Array(fs.readFileSync(path.join(outputDir,'downloads',guidedName))),guidedBytes),'Opening changed original file');
        console.log('PASS: guided creation, default cover/message, notes, binary upload, branching, real download, reopening, deep edit, byte preservation.');
        await evaluate(`(async()=>{document.getElementById('poly-advanced').showModal();document.getElementById('poly-new').click();await flowPause();})()`);
        fs.writeFileSync(path.join(outputDir,'ux-00-demo-picker.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await evaluate(`(async () => {
            window.confirm=()=>true;
            const answers=['128','noise','AGENTS.md','child.png']; window.prompt=()=>answers.shift();
            document.querySelector('[data-tab="polyglot"]').click();
            const click=text=>[...document.querySelectorAll('#polyglot-panel button')].find(b=>b.textContent===text).click();
            click('Generate carrier'); await new Promise(r=>setTimeout(r,200));
            click('Manage archive contents'); await new Promise(r=>setTimeout(r,20));
            document.querySelector('.poly-add-menu summary').click();
            click('New text file'); await new Promise(r=>setTimeout(r,20));
            const editor=document.querySelector('.poly-editor'); editor.value='pending draft\\n'; editor.dispatchEvent(new Event('input'));
            document.querySelector('#poly-tree summary button').click();
            const file=[...document.querySelectorAll('#poly-tree button')].find(b=>b.textContent.includes('AGENTS.md')); file.click();
            if(document.querySelector('.poly-editor').value!=='pending draft\\n') throw new Error('Draft lost on selection');
            click('Save text changes'); await new Promise(r=>setTimeout(r,20));
            document.querySelector('#poly-tree summary button').click(); click('Add nested image');
            await new Promise(r=>setTimeout(r,20));
            if(!document.querySelector('#poly-tree').textContent.includes('child.png'))throw new Error('Child action failed');
            document.querySelector('#poly-tree summary button').click();
        })()`);
        for(const demoId of ['image-archive','branches','reopen-edit','techniques']) {
        await evaluate(`(async () => {
            const pause=()=>new Promise(r=>setTimeout(r,30));
            const click=text=>[...document.querySelectorAll('#polyglot-panel button')].find(b=>b.textContent===text).click();
            const ready=async()=>{for(let i=0;i<1000 && document.querySelector('#poly-controls').disabled;i++)await pause();if(document.querySelector('#poly-controls').disabled)throw new Error('Demo timed out');};
            const id=${JSON.stringify(demoId)};
            {
                document.querySelector('#poly-demo-'+id).click(); await pause(); await ready();
                if(document.querySelector('#poly-demo-guide').hidden)throw new Error('Demo guide is missing for '+id);
                if(id==='image-archive') {
                    document.querySelector('#poly-task-image').click();await pause();
                    if(!document.querySelector('#poly-view-image[aria-pressed="true"]'))throw new Error('Image task did not select its section');
                    document.querySelector('#poly-view-inspect').click();await pause();
                    const method=document.querySelector('#poly-detail select');method.value='PALETTE';method.dispatchEvent(new Event('change'));await pause();
                    document.querySelector('#poly-view-image').click();await pause();
                    if(document.querySelector('#poly-detail select').value!=='LSB')throw new Error('Inspect controls overwrote encoding settings');
                } else {
                    document.querySelector('#poly-task-'+(id==='reopen-edit'?'import':'tree')).click();await pause();
                    if(!document.querySelector('.poly-entry-table'))throw new Error('Archive task did not open archive contents');
                }
                for(const taskId of ['jpeg','specter']) {
                    const task=document.querySelector('#poly-task-'+taskId);
                    if(task) {task.click();await pause();if(!document.querySelector('#poly-view-image[aria-pressed="true"]'))throw new Error('Settings task did not open image section');}
                }
                if(id!=='techniques') {
                    document.querySelector('#poly-task-edit').click();await pause();
                    if(document.querySelector('#poly-task-edit').closest('li').dataset.complete==='true')throw new Error('Edit completed without saving a change');
                    const input=document.querySelector('.poly-editor');
                    input.value+='\\nSaved via demo flow.\\n';input.dispatchEvent(new Event('input'));
                    click('Save text changes');await pause();
                    if(document.querySelector('#poly-task-edit').closest('li').dataset.complete!=='true')throw new Error('Edit task completed before or failed to complete after save');
                }
                document.querySelector('#poly-task-build').click();await pause();await ready();
                if(document.querySelector('#poly-download').disabled)throw new Error('Demo output was not built: '+id+' '+document.querySelector('#poly-status').textContent);
                if(document.querySelector('#poly-task-build').closest('li').dataset.complete!=='true')throw new Error('Build task not complete for '+id);
                if(id==='reopen-edit' && !document.querySelector('.poly-demo-report').textContent.includes('Preservation checks passed'))throw new Error('No preservation comparison');
                if(id==='image-archive') {
                    document.querySelector('#poly-task-decode').click();await pause();click('Decode selected method');await pause();await ready();
                    if(document.querySelector('#poly-task-decode').closest('li').dataset.complete!=='true')throw new Error('Payload decode task did not complete');
                }
                if([...document.querySelectorAll('.poly-demo-tasks li')].some(row=>row.dataset.complete!=='true'))throw new Error('Incomplete flow: '+id);
            }
            window.scrollTo(0,0);
        })()`);
        await new Promise(resolve=>setTimeout(resolve,500));
        const metrics=await call('Page.getLayoutMetrics');
        fs.writeFileSync(path.join(outputDir,'ux-'+demoId+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:Math.ceil(metrics.cssContentSize.width),height:Math.ceil(metrics.cssContentSize.height),scale:1}})).data,'base64'));
        console.log('PASS: complete UI demo flow '+demoId);
        }
        await evaluate(`(async()=>{window.confirm=()=>false;document.querySelector('#poly-demo-branches').click();await new Promise(r=>setTimeout(r,50));if(!document.querySelector('#poly-demo-guide').textContent.includes('Technique sampler'))throw new Error('Declining a demo replacement lost the current project');window.confirm=()=>true;})()`);
        fs.writeFileSync(path.join(outputDir, 'ux-demo-sampler.png'), Buffer.from((await call('Page.captureScreenshot', {format:'png'})).data,'base64'));
        fs.writeFileSync(path.join(outputDir, 'desktop.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await evaluate("document.getElementById('poly-close-advanced').click()");
        await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        assert(await evaluate("document.querySelector('#polyglot-panel').getBoundingClientRect().right <= innerWidth + 1"));
        assert(await evaluate("document.querySelector('#poly-flow').scrollWidth <= document.querySelector('#poly-flow').clientWidth + 1"),'Guided composer overflows on mobile');
        assert(await evaluate("document.getElementById('flow-build-direct').getBoundingClientRect().bottom <= innerHeight+1"),'Continue is below the viewport on mobile');
        assert(await evaluate("!document.querySelector('#poly-advanced').open && ![...document.querySelectorAll('#poly-flow select')].some(e=>e.checkVisibility())"),'Advanced settings leaked into the mobile flow');
        fs.writeFileSync(path.join(outputDir, 'mobile.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        await evaluate("document.getElementById('flow-filename').scrollIntoView({block:'center'})");
        assert(await evaluate("document.querySelector('#poly-flow').scrollWidth <= document.querySelector('#poly-flow').clientWidth+1"),'Cover controls overflow on mobile');
        fs.writeFileSync(path.join(outputDir,'flow-mobile-cover.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        assert.deepEqual(errors, []);
        console.log('PASS: real Chrome UI, draft retention, branching, responsive bounds; no page exceptions.');
        execFileSync('python', ['-c', `
import io, zipfile
from pathlib import Path
from PIL import Image
base=Path(${JSON.stringify(outputDir)})
def inspect(data):
    image=Image.open(io.BytesIO(data)); image.load()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert z.testzip() is None
        for name in z.namelist():
            raw=z.read(name)
            if raw[:4] in (b'\\x89PNG', b'\\xff\\xd8\\xff\\xe0') and zipfile.is_zipfile(io.BytesIO(raw)): inspect(raw)
for name in ('outer.png','rebuilt.png','f5.jpg','image-archive.png','branches.png','reopen-edit.png','techniques.png'): inspect((base/name).read_bytes())
for name in (${JSON.stringify(guidedName)}, ${JSON.stringify(rebuiltName)}): inspect((base/'downloads'/name).read_bytes())
with zipfile.ZipFile(base/'rebuilt.png') as z:
    with zipfile.ZipFile(io.BytesIO(z.read('branch-a.png'))) as a:
        with zipfile.ZipFile(io.BytesIO(a.read('deeper.png'))) as d:
            assert d.read('README.md') == b'edited deeply\\r\\n'
print('PASS: Python zipfile extraction and Pillow image decoding at every layer.')
`], { stdio: 'inherit' });
    } finally {
        socket?.close(); chrome.kill(); server.close();
        // Temporary Chrome profiles are intentionally left to OS temp cleanup.
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
