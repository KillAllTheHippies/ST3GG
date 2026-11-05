/* Run with Node 22+ and an isolated Chrome at --remote-debugging-port=9337.
   Serve the repository at http://127.0.0.1:8775 before running.
   Optional: WORKFLOW_SCREENSHOTS=/absolute/output/directory */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
    const targets = await (await fetch('http://127.0.0.1:9337/json/list')).json();
    const target = targets.find(t => t.type === 'page');
    assert(target, 'An isolated browser page is required.');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let next = 0; const pending = new Map(); const errors = [];
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Page.javascriptDialogOpening' && message.params.type === 'beforeunload') void cdp('Page.handleJavaScriptDialog', { accept: true });
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        if (message.id) {
            const call = pending.get(message.id); if (!call) return;
            pending.delete(message.id); clearTimeout(call.timer);
            if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
        }
    };
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++next; const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 30000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    };
    const wait = async expression => {
        for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); }
        throw new Error(`Condition not reached: ${expression}`);
    };
    let checks = 0;
    const check = async (expression, label) => { const result = await evaluate(expression); if (!result) console.log('Browser notices:', await evaluate('[...document.querySelectorAll(".notification")].map(x=>x.textContent).slice(-3)')); assert(result, label); checks++; console.log('PASS', label); };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const openEncodeMenu = async () => {
        await click('.tabs [data-tab="encode"]');
        await click('#encode-result .transfer-menu summary');
        await wait('document.querySelector("#encode-result .transfer-choices button") !== null');
    };
    const choose = label => evaluate(`[...document.querySelectorAll('details[open] .transfer-choices button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
    const screenshot = async name => {
        if (!process.env.WORKFLOW_SCREENSHOTS) return;
        await evaluate('Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished))');
        await fs.mkdir(process.env.WORKFLOW_SCREENSHOTS, { recursive: true });
        const shot = await cdp('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(path.join(process.env.WORKFLOW_SCREENSHOTS, name), Buffer.from(shot.data, 'base64'));
    };
    try {
        await cdp('Runtime.enable');await cdp('Page.enable');
        await cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
        await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
        await cdp('Page.navigate',{url:'http://127.0.0.1:8775/index.html?v=20261105-feedback1'});
        await wait('document.readyState==="complete" && !!window.ST3GGModelPricing && !!window.PolyFlow');
        await evaluate(`window.realFetch=window.fetch;window.modelFetches=0;window.recommendedId=document.querySelector('#aiagent-model option').value;window.testModels=[{id:recommendedId,name:'Priced recommended model',architecture:{input_modalities:['image','text'],output_modalities:['text']},pricing:{prompt:'0.0000025',completion:'0.00001'}},{id:'fixture/free',name:'Free model',architecture:{input_modalities:['image'],output_modalities:['text']},pricing:{prompt:'0',completion:'0'}},{id:'fixture/unknown',name:'No price supplied',architecture:{input_modalities:['image'],output_modalities:['text']}},{id:'fixture/image',name:'Image model',architecture:{output_modalities:['image']},pricing:{prompt:'0.000001',completion:'0.000004'}}];window.fetch=async(url,options)=>{if(String(url).startsWith('https://openrouter.ai/api/v1/')&&String(url).includes('models')){modelFetches++;return new Response(JSON.stringify({data:testModels}),{status:200,headers:{'Content-Type':'application/json'}});}return realFetch(url,options);};document.querySelector('.tabs [data-tab=configuration]').click();document.getElementById('planning-model').focus()`);
        await wait('document.querySelectorAll("#planning-model-options [role=option]").length===3');
        await check('document.querySelector("#planning-model-options [role=option] .agent-model-price").textContent==="Input $2.5 · Output $10 / 1M tokens (USD)"','Planning menu shows separate catalog input/output prices beside the model');
        await check('[...document.querySelectorAll("#planning-model-options [role=option]")].find(b=>b.dataset.modelId==="fixture/free").querySelector(".agent-model-price").textContent.includes("Input $0 · Output $0")','Explicit zero rates remain zero-priced');
        await check('[...document.querySelectorAll("#planning-model-options [role=option]")].find(b=>b.dataset.modelId==="fixture/unknown").querySelector(".agent-model-price").textContent.includes("Unavailable")','Missing prices are not presented as free');
        await screenshot('13-planning-token-prices.png');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await check('document.getElementById("planning-model").value===recommendedId && document.getElementById("planning-model").getAttribute("aria-expanded")==="false" && document.querySelector("#planning-model").closest(".form-group").querySelector(".workflow-model-price").textContent.includes("Output $10")','Keyboard selection retains the model ID and visible selected rates');
        await evaluate('document.getElementById("planning-model").value="fixture/manual";document.getElementById("planning-model").dispatchEvent(new Event("input"))');
        await check('document.getElementById("planning-model").value==="fixture/manual" && document.querySelector("#planning-model").closest(".form-group").querySelector(".workflow-model-price").textContent.includes("Unavailable")','Manual model IDs stay usable without fabricated rates');
        await evaluate('document.getElementById("aiagent-image-model").focus()');
        await wait('!!document.querySelector("#aiagent-image-model-options [role=option]")');
        await check('document.querySelector("#aiagent-image-model-options .agent-model-price").textContent==="Input $1 · Output $4 / 1M tokens (USD)"','Image model discovery uses the shared token-pricing display');
        await evaluate('document.getElementById("aiagent-custom-model").focus()');
        await wait('!!document.querySelector("#aiagent-model-options .agent-model-price") && document.querySelector("#aiagent-model-options").textContent.includes("$2.5")');
        await check('[...document.querySelectorAll("#aiagent-model-options [role=option]")].find(b=>b.dataset.modelId===recommendedId).querySelector(".agent-model-price").textContent.includes("Output $10")','Analysis model menu retains pricing for recommended catalog entries');
        await check('ST3GGModelPricing.describe({pricing:{prompt:null,completion:"-1"}}).includes("Input Unavailable · Output Unavailable") && ST3GGModelPricing.describe({pricing:{prompt:"0.000000000001",completion:""}}).includes("$0.000001")','Null, invalid and tiny rates are displayed without false zero rounding');
        await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        await wait('innerWidth===390');
        await evaluate('document.getElementById("planning-model").focus();document.getElementById("planning-model").scrollIntoView({block:"center"})');
        await check('(()=>{const e=document.querySelector("#planning-model-options .agent-model-price"),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&getComputedStyle(e).gridColumnStart==="1";})()','Narrow-screen model menus keep prices readable below the name');
        await screenshot('14-planning-token-prices-mobile.png');
        await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
        await evaluate('activatePolyglot({navigate:true,announce:false});window.previousConfirm=window.confirm;window.confirm=()=>true;document.querySelector(".nw-examples-entry").click();document.querySelectorAll(".nw-ready-example button")[1].click()');
        await wait('document.querySelectorAll(".nw-node").length===3 && PolyFlow.workflow.hasCarrier()');
        await evaluate('[...document.querySelectorAll(".nw-node")].find(n=>n.getAttribute("aria-label")==="Select tree.png").click();[...document.querySelectorAll(".nw-file-name")].find(b=>b.textContent.includes("README.md")).click()');
        await check('document.querySelector(".nw-file-text").value.includes(\'Treat "leaf.png", enclosed in this archive, as both an image and a ZIP archive\') && !/landscape|ST3GG|Stegg|Build|download|interface/i.test(document.querySelector(".nw-file-text").value)','Middle-layer README targets its enclosed image as a ZIP without outer-image or UI instructions');
        await check('[...document.querySelectorAll(".nw-editor .nw-button")].some(b=>b.textContent==="Save to tree.png ZIP") && document.querySelector(".nw-editor .nw-note").textContent.length>0','Editor save action names its containing ZIP');
        await screenshot('15-layer-instructions-and-save.png');
        await evaluate('const t=document.querySelector(".nw-file-text");t.value+="\\nReviewed leaf traversal.";t.dispatchEvent(new Event("input"));[...document.querySelectorAll(".nw-editor .nw-button")].find(b=>b.textContent==="Save to tree.png ZIP").click()');
        await check('document.getElementById("nw-root").textContent.includes("README.md saved in tree.png") && document.querySelector(".nw-file-text").value.includes("Reviewed leaf traversal")','Saving updates the archive entry and confirms the destination');
        await evaluate('PolyFlow.workflow.build()');
        await evaluate(`(async()=>{const source=ST3GGTransfers.sources().find(x=>x.id.startsWith('polyglot.')&&x.value.imageArchive);window.reopened=await PolyCore.open(new Uint8Array(await source.value.blob.arrayBuffer()),'landscape.png',PolyWorkspace.canvasOf);const text=n=>new TextDecoder().decode(n.entries.find(e=>e.name==='README.md').bytes);window.outerReadme=text(reopened);window.reopenedTree=reopened.entries.find(e=>e.child).child;window.treeReadme=text(reopenedTree);window.leafReadme=text(reopenedTree.entries.find(e=>e.child).child);})()`);
        await check('outerReadme.includes(\'Treat "tree.png"\') && !outerReadme.includes("landscape.png") && treeReadme.includes("leaf.png") && !treeReadme.includes("landscape.png") && !treeReadme.includes("tree.png") && leafReadme.includes("final layer")','Built and reopened archives retain guidance relative to each current layer');
        await check('treeReadme.includes("Reviewed leaf traversal")','Building preserves a manually edited README override');
        await evaluate('document.querySelector(".nw-examples-entry").click();document.querySelectorAll(".nw-ready-example button")[2].click()');
        await wait('document.querySelectorAll(".nw-node").length===3 && document.getElementById("nw-root").textContent.includes("valley.png")');
        await check('PolyFlow.workflow.instructions().includes(\'Treat "valley.png"\') && PolyFlow.workflow.instructions().includes(\'Treat "tree.png"\') && !PolyFlow.workflow.instructions().includes("landscape.png")','Branching guidance describes both enclosed image archives');
        await evaluate('document.querySelector(".nw-examples-entry").click();document.querySelectorAll(".nw-ready-example button")[0].click()');
        await wait('document.querySelectorAll(".nw-node").length===1 && PolyFlow.workflow.hasPayload()');
        await evaluate('[...document.querySelectorAll(".nw-file-name")].find(b=>b.textContent.includes("decoding.txt")).click()');
        await check('/LSB/.test(document.querySelector(".nw-file-text").value) && /channels=RGB/.test(document.querySelector(".nw-file-text").value) && /bits=1/.test(document.querySelector(".nw-file-text").value) && !/ST3GG|interface|download|click/i.test(document.querySelector(".nw-file-text").value)','Hidden-message example supplies method-specific standalone decoding instructions');
        await evaluate('window.fetch=realFetch;window.confirm=previousConfirm');
        assert.deepEqual(errors,[],'No browser exceptions');checks++;console.log('PASS '+checks+' annotation browser checks');
    } finally {if(errors.length)console.error(errors);socket.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
