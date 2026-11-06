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
        await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
        await cdp('Emulation.setDeviceMetricsOverride',{width:1529,height:1090,deviceScaleFactor:1,mobile:false});
        await cdp('Page.navigate',{url:'http://127.0.0.1:8775/index.html?v=20261106-tabs2'});
        await wait('document.readyState==="complete" && document.querySelector(".tab-strip") && !!window.PolyFlow');
        await check('!!document.querySelector(".tabs [data-tab=knowledgebase]") && document.querySelectorAll("#knowledge-nav a").length===10','Knowledgebase is a first-class application tab with all articles');
        await evaluate('document.getElementById("encode-text").value="Keep this draft";document.querySelector(".tabs [data-tab=knowledgebase]").click()');
        await wait('document.querySelector(".tab-strip [data-tab=knowledgebase]")!==null');
        await check('document.getElementById("knowledgebase-panel").classList.contains("active") && document.querySelector("#workflow-bar strong").textContent==="Knowledgebase"','Knowledgebase uses the application navigation and workspace heading');
        await evaluate('document.getElementById("knowledge-search").value="pHYs";document.getElementById("knowledge-search").dispatchEvent(new Event("input"));document.querySelector("#knowledge-nav a").click()');
        await wait('document.querySelector("#knowledge-content h1").textContent==="PNG chunk names"');
        await check('location.hash==="#knowledgebase/png-chunks" && document.getElementById("knowledge-content").textContent.includes("Physical pixel dimensions")','In-app knowledgebase search opens the matching shared article');
        await screenshot('16-knowledgebase-tab.png');
        await evaluate('document.querySelector(".tabs [data-tab=encode]").click()');
        await check('document.getElementById("encode-text").value==="Keep this draft"','Visiting Knowledgebase preserves another tool’s draft');
        await evaluate('activateTextLab();activateGodmode();toggleMatryoshka();activatePolyglot({navigate:true,announce:false})');
        await check('!["godmode-indicator","matryoshka-indicator"].some(id=>document.getElementById(id).onclick || document.getElementById(id).textContent.includes("deactivate"))','Mode banners contain no deactivation action or hint');
        await evaluate('document.getElementById("godmode-indicator").click();document.getElementById("matryoshka-indicator").click()');
        await check('state.godmodeActive && state.matryoshkaMode && !document.getElementById("godmode-indicator").classList.contains("hidden") && !document.getElementById("matryoshka-indicator").classList.contains("hidden")','Mode banners are passive while visible');
        await evaluate('new Promise(resolve=>setTimeout(resolve,5100))');
        await check('state.godmodeActive && state.matryoshkaMode && document.getElementById("godmode-indicator").classList.contains("hidden") && document.getElementById("matryoshka-indicator").classList.contains("hidden")','Both banners disappear after five seconds while their modes remain enabled');
        await wait('document.querySelector(".tab-overflow-list").children.length>0 && !document.querySelector(".tab-overflow-toggle").hidden');
        await check('(()=>{const tabs=[...document.querySelectorAll(".tab-strip>.tab")].filter(t=>t.style.display!=="none"),tops=tabs.map(t=>t.getBoundingClientRect().top);return Math.max(...tops)-Math.min(...tops)<2 && document.querySelector(".tab-strip").scrollWidth<=document.querySelector(".tab-strip").clientWidth+1;})()','Unlocked tools stay in a single tab row with overflow in the dropdown');
        await check('!!document.querySelector(".tab-strip [data-tab=polyglot].active")','The active tool remains visible when tabs overflow');
        await evaluate('document.querySelector(".tab-overflow-toggle").focus()');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
        await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await wait('!document.getElementById("tab-overflow").hidden');
        await check('document.querySelector(".tab-overflow-toggle").getAttribute("aria-expanded")==="true" && document.querySelectorAll(".tab-overflow-list .tab").length>0','Keyboard activation opens the overflow tools dropdown');
        await check('document.querySelector(".tab-overflow-toggle").textContent==="" && !!document.querySelector(".tab-overflow-toggle svg") && !document.querySelector(".tab-drawer")','Overflow uses only a down chevron and an anchored non-modal list');
        await check('(()=>{const r=document.getElementById("tab-overflow").getBoundingClientRect(),n=document.querySelector(".tabs").getBoundingClientRect();return r.top>=n.bottom && r.width<400;})()','Additional tabs appear directly below the navigation');
        await screenshot('17-tab-overflow-dropdown.png');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await check('document.getElementById("tab-overflow").hidden && document.activeElement.classList.contains("tab-overflow-toggle")','Escape closes the dropdown and returns focus');
        await evaluate('document.querySelector(".tab-overflow-toggle").click()');
        await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:15,y:15,button:'left',clickCount:1});
        await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:15,y:15,button:'left',clickCount:1});
        await check('document.getElementById("tab-overflow").hidden','Clicking outside dismisses the tab list');
        await evaluate('document.querySelector(".tab-overflow-toggle").click();window.overflowTarget=document.querySelector(".tab-overflow-list .tab").dataset.tab;document.querySelector(".tab-overflow-list .tab").click()');
        await wait('document.getElementById("tab-overflow").hidden && !!document.querySelector(".tab-strip .tab.active")');
        await check('document.querySelector(".tab-strip .tab.active").dataset.tab===overflowTarget && document.getElementById(overflowTarget+"-panel").classList.contains("active")','Selecting an overflow tool activates its original tab and pins it in the row');
        await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        await wait('innerWidth===390 && !document.querySelector(".tab-overflow-toggle").hidden');
        await evaluate('document.querySelector(".tabs").scrollIntoView({block:"start"});document.querySelector(".tab-overflow-toggle").click()');
        await wait('!document.getElementById("tab-overflow").hidden && document.getElementById("tab-overflow").getBoundingClientRect().width>100');
        await check('(()=>{const e=document.getElementById("tab-overflow"),r=e.getBoundingClientRect();return !e.hidden&&r.width>100&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;})()','The open dropdown fits a 390px viewport');
        await check('document.querySelector(".tab-strip").scrollWidth<=document.querySelector(".tab-strip").clientWidth+1 && document.querySelectorAll(".tab-overflow-list .tab").length>=6','Opening immediately after resizing includes every newly overflowing tool');
        await screenshot('18-tab-overflow-mobile.png');
        await evaluate('document.querySelector(".tab-overflow-toggle").click()');
        await cdp('Emulation.setDeviceMetricsOverride',{width:1815,height:633,deviceScaleFactor:1,mobile:false});
        await evaluate('document.querySelector(".tabs [data-tab=polyglot]").click();document.querySelector(".nw-presets-header button").click()');
        await wait('document.querySelectorAll(".nw-preset-list button").length===21');
        await evaluate(`window.presetButton=[...document.querySelectorAll('.nw-preset-list button')].find(b=>b.textContent.includes('Chroma payload'));presetButton.scrollIntoView({block:'center'});window.scrollBefore={page:scrollY,run:document.querySelector('.nw-run').scrollTop,list:document.querySelector('.nw-preset-list').scrollTop};`);
        const presetPoint=await evaluate('(()=>{const r=presetButton.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
        await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...presetPoint,button:'left',clickCount:1});
        await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...presetPoint,button:'left',clickCount:1});
        await check('document.querySelector(".nw-preset-selected").textContent.includes("Chroma payload") && Math.abs(document.querySelector(".nw-preset-list").scrollTop-scrollBefore.list)<1 && Math.abs(document.querySelector(".nw-run").scrollTop-scrollBefore.run)<1 && Math.abs(scrollY-scrollBefore.page)<1','Selecting a low preset preserves list, sidebar and page scroll positions');
        await check('document.activeElement===document.querySelector(".nw-preset-selected")','Preset selection preserves keyboard focus after the list redraws');
        await screenshot('19-preset-scroll-preserved.png');
        await evaluate('[...document.querySelectorAll(".nw-preset-detail button")].find(b=>b.textContent==="Use this preset").click()');
        await check('document.querySelector("[data-focus=layer-count]").value==="1" && document.getElementById("nw-root").textContent.includes("CHROMA")','The preserved preset remains usable');
        await check('[...document.querySelectorAll(".nw-inspector button")].some(b=>b.textContent==="New text file") && ![...document.querySelectorAll(".nw-inspector button")].some(b=>b.textContent==="Add text")','Archive control explicitly creates a new text file');
        await check('[...document.querySelectorAll(".nw-archive-list button,.nw-archive-list summary,.nw-archive-comment,.nw-archive-list+.nw-row button")].every(b=>b.dataset.tooltip && b.getAttribute("aria-description"))','Archive entries, menus, comments and creation controls all have explanatory tooltips');
        await evaluate('window.newTextButton=[...document.querySelectorAll(".nw-inspector button")].find(b=>b.textContent==="New text file");newTextButton.scrollIntoView({block:"center"});newTextButton.focus()');
        await check('!document.getElementById("nw-control-tooltip").hidden && document.getElementById("nw-control-tooltip").textContent.includes("filename and editable contents")','Keyboard focus reveals the new-file action’s explanation');
        await screenshot('20-archive-action-tooltip.png');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await check('document.getElementById("nw-control-tooltip").hidden','Escape dismisses an archive action tooltip');
        await evaluate('newTextButton.click()');
        await check('document.querySelector(".nw-editor h3").textContent.startsWith("New text file") && !!document.querySelector("[data-focus=file-name]") && !!document.querySelector(".nw-file-text")','New text file opens a filename and contents editor');
        await evaluate('[...document.querySelectorAll(".nw-inspector button")].find(b=>b.textContent==="New text file").focus()');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await check('!!document.querySelector(".nw-file-text") && document.getElementById("nw-control-tooltip").hidden','Dismissing an action tooltip keeps the file editor open');
        await cdp('Emulation.setDeviceMetricsOverride',{width:900,height:800,deviceScaleFactor:1,mobile:false});
        await wait('innerWidth===900 && !document.querySelector(".tab-overflow-toggle").hidden');
        await evaluate('document.querySelector(".tab-overflow-toggle").click()');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await check('document.getElementById("tab-overflow").hidden && !!document.querySelector(".nw-file-text")','Closing the navigation dropdown leaves the current file editor open');
        await cdp('Emulation.setDeviceMetricsOverride',{width:2400,height:1300,deviceScaleFactor:1,mobile:false});
        await wait('innerWidth===2400 && document.querySelector(".tab-overflow-toggle").hidden');
        await check('document.querySelectorAll(".tab-overflow-list .tab").length===0','Widening the viewport restores all unlocked tabs to the row');
        await cdp('Page.navigate',{url:'http://127.0.0.1:8775/index.html?v=20261106-tabs2'});
        await wait('document.readyState==="complete" && document.querySelector(".tab-strip") && !textLabUnlocked');
        await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        await wait('innerWidth===390 && document.querySelector(".tab-overflow-list").children.length>0');
        await check('[...document.querySelectorAll(".tab-overflow-list .tab")].every(t=>!["textlab","godmode","matryoshka","polyglot"].includes(t.dataset.tab))','Locked modes remain absent from the overflow dropdown after reload');
        assert.deepEqual(errors,[],'No browser exceptions');checks++;console.log('PASS '+checks+' navigation browser checks');
    } finally {if(errors.length)console.error(errors);socket.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
