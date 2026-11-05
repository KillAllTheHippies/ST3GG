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
        await cdp('Runtime.enable'); await cdp('Page.enable');
        await cdp('Emulation.setDeviceMetricsOverride',{width:1309,height:900,deviceScaleFactor:1,mobile:false});
        await cdp('Page.navigate',{url:'http://127.0.0.1:8775/index.html?v=20261104-terms1'});
        await wait('document.readyState==="complete" && !!window.ST3GGAnalysis');
        await check('document.getElementById("inspection-results").hidden && !document.getElementById("file-structure-input")','Inspection starts empty without a second file chooser');
        await evaluate(`(async()=>{
            const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');const g=ctx.createLinearGradient(0,0,64,64);g.addColorStop(0,'#244863');g.addColorStop(1,'#71b477');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
            window.plain=new Uint8Array(await (await new Promise(r=>canvas.toBlob(r))).arrayBuffer());
            window.textBytes=s=>new TextEncoder().encode(s);
            window.chunk=(type,data)=>{const b=new Uint8Array(data.length+12),v=new DataView(b.buffer);v.setUint32(0,data.length);b.set(textBytes(type),4);b.set(data,8);v.setUint32(data.length+8,PolyCore.crc(b.subarray(4,data.length+8)));return b;};
            window.join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b;};
            window.deflate=async b=>new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
            const tiff=new Uint8Array(32),tv=new DataView(tiff.buffer);tiff.set([73,73,42,0,8,0,0,0]);tv.setUint16(8,1,true);tv.setUint16(10,0x010f,true);tv.setUint16(12,2,true);tv.setUint32(14,6,true);tv.setUint32(18,26,true);tiff.set(textBytes('Acme!\0'),26);window.tiff=tiff;
            const profile=new Uint8Array(132),pv=new DataView(profile.buffer);pv.setUint32(0,132);profile.set(textBytes('mntr'),12);profile.set(textBytes('RGB '),16);profile.set(textBytes('XYZ '),20);profile.set(textBytes('acsp'),36);
            const xml='<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Next layer task</dc:title></x:xmpmeta>';
            const chunks=[chunk('sRGB',new Uint8Array([0])),chunk('gAMA',new Uint8Array([0,0,177,143])),chunk('pHYs',new Uint8Array([0,0,14,196,0,0,14,196,1])),chunk('tEXt',textBytes('Task\0Open inner.png and read README.md.')),chunk('tEXt',textBytes('<img src=x onerror=alert(1)>\0Literal field text')),chunk('zTXt',join(textBytes('Compressed\0'),new Uint8Array([0]),await deflate(textBytes('Inflated instructions ✓')))),chunk('iTXt',join(textBytes('XML:com.adobe.xmp\0'),new Uint8Array([1,0]),textBytes('en\0Title\0'),await deflate(textBytes(xml)))),chunk('eXIf',tiff),chunk('iCCP',join(textBytes('Display\0'),new Uint8Array([0]),await deflate(profile)))];
            window.fixture=join(plain.subarray(0,plain.length-12),...chunks,plain.subarray(plain.length-12));window.tail=new Uint8Array([80,75,3,4,1,2,3,73,69,78,68,0,0,0,0]);window.fixtureWithTail=join(fixture,tail);window.inspectionFile=new File([fixtureWithTail],'layered-example.png',{type:'image/png'});
            document.querySelector('.tabs [data-tab=analyze]').click();await ST3GGWorkflow.loadMedia('analyze',inspectionFile);await state.analysisInspectionPromise;
        })()`);
        await check('document.getElementById("inspection-results").dataset.status==="complete" && !document.getElementById("inspection-results").hidden && document.getElementById("channel-layers-section").classList.contains("hidden")','Loading Analyze automatically displays file inspection before pixel analysis');
        await check('state.analysisInspection.endOffset===fixture.length && state.analysisInspection.appendedBytes===tail.length','Container framing ignores a fake end marker inside appended bytes');
        await check('state.analysisInspection.categories.png.records.filter(r=>r.group==="tEXt").length===2 && document.querySelector("[data-category=png] summary").textContent.includes("1")','Repeated metadata instances are counted without requiring tab navigation');
        await check('[...document.querySelectorAll("[data-category=png] summary")].some(s=>s.querySelector(".inspection-term-label>span").textContent==="tEXt" && s.querySelector(".inspection-count").textContent==="2")','Top-level chunk title and instance count are visible immediately');
        await check('document.querySelectorAll(".inspection-category-count").length===9 && !document.querySelector("span.inspection-category-count[href]")','All category totals are visible and empty categories have no dead link');
        await check('state.analysisInspection.categories.exif.records.some(r=>r.title==="Make" && r.fields.Value==="Acme!")','EXIF tree includes actual TIFF field values');
        await check(`['IHDR','sRGB','gAMA','pHYs','IDAT','IEND'].every(name=>{const summary=[...document.querySelectorAll('[data-category=png] summary')].find(s=>s.querySelector('.inspection-term-label>span').textContent===name);return summary?.querySelector('[role=tooltip]')?.textContent.includes(ST3GGKnowledge.term('png',name).title)&&summary.querySelector('a').hash==='#png-chunks/'+name;})`,'Every highlighted PNG chunk has an explanation and a direct knowledgebase link');
        await evaluate(`window.chunkSummary=[...document.querySelectorAll('[data-category=png] summary')].find(s=>s.querySelector('.inspection-term-label>span').textContent==='pHYs');chunkSummary.scrollIntoView({block:'center'});chunkSummary.focus()`);
        await check(`getComputedStyle(chunkSummary.querySelector('[role=tooltip]')).visibility==='visible' && chunkSummary.querySelector('[role=tooltip]').textContent.includes('Physical pixel dimensions')`,'Keyboard focus reveals the acronym tooltip');
        await screenshot('11-chunk-tooltip-desktop.png');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await check('chunkSummary.querySelector("[role=tooltip]").hidden','Escape dismisses the tooltip');
        await evaluate('chunkSummary.blur()');
        const tooltipPoint=await evaluate('(()=>{const r=chunkSummary.getBoundingClientRect();return {x:r.left+45,y:r.top+r.height/2};})()');
        await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:tooltipPoint.x,y:tooltipPoint.y});
        await check('!chunkSummary.querySelector("[role=tooltip]").hidden && getComputedStyle(chunkSummary.querySelector("[role=tooltip]")).visibility==="visible"','Pointer hover shows the chunk explanation without a click');
        await check('(()=>{const a=chunkSummary.getBoundingClientRect(),b=chunkSummary.querySelector("[role=tooltip]").getBoundingClientRect();return Math.abs(b.top-a.bottom-7)<2 || Math.abs(a.top-b.bottom-7)<2;})()','Tooltip stays beside its acronym with the app’s CSS zoom');
        await screenshot('11-chunk-tooltip-desktop.png');
        await evaluate('chunkSummary.querySelector("a").focus()');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await wait('document.querySelector(".knowledge-dialog")?.open');
        await check('!chunkSummary.parentElement.open && document.querySelector(".knowledge-dialog [data-term=pHYs] h2").textContent.includes("Physical pixel dimensions") && document.querySelector(".knowledge-dialog [data-term=pHYs]").getBoundingClientRect().top>=0 && document.querySelector(".knowledge-dialog>.btn").getBoundingClientRect().top>=0','Keyboard help jumps to the matching explanation and retains the Close control without unfolding the metadata group');
        await evaluate('document.querySelector(".knowledge-dialog>.btn").click()');
        await check('document.activeElement===chunkSummary.querySelector("a") && state.analyzeFile===inspectionFile','Closing acronym help restores focus and preserves the source file');
        await evaluate('document.activeElement.blur()');
        await check('[...document.querySelectorAll(".inspection-category-count")].find(c=>c.querySelector("span").firstChild.textContent==="EXIF").querySelector("[role=tooltip]").textContent.includes("Exchangeable Image File Format")','Category acronyms also have expanded explanations');
        await check('state.analysisInspection.categories.icc.records.some(r=>r.fields["Color space"]==="RGB " && r.fields.Signature==="acsp")','Compressed PNG ICC profile is inflated before parsing');
        await check('state.analysisInspection.categories.xmp.records.some(r=>r.fields.Value==="Next layer task")','Compressed international text supplies parsed XMP properties');
        await check('state.analysisInspection.categories.png.records.some(r=>r.group==="zTXt" && r.text.startsWith("Inflated instructions"))','Compressed text is shown as decoded text');
        await check('state.analysisInspection.categories.hidden.records.some(r=>r.title==="ZIP" && r.fields.Evidence.includes("not verified"))','Signature matches are identified as unverified leads');
        await check('JSON.parse(ST3GGAnalysis.report()).categories.png.records.some(r=>r.text==="Open inner.png and read README.md.") && !document.querySelector(".inspection-group[open]")','Report exports complete collected metadata while groups stay collapsed');
        await evaluate('document.getElementById("inspection-expand").click()');
        await wait('document.querySelectorAll(".inspection-record").length>10');
        await check('[...document.querySelectorAll(".inspection-group")].every(g=>g.open) && document.getElementById("metadata-tree").textContent.includes("Literal field text") && !document.querySelector("#metadata-tree img[src=x]")','Expand all exposes records and treats metadata markup as literal text');
        await evaluate('document.getElementById("inspection-collapse").click();document.getElementById("inspection-results").scrollIntoView({block:"start"})');
        await screenshot('08-file-inspection-desktop.png');
        await evaluate('document.querySelector("[data-category=png] .inspection-group").open=true');
        await wait('document.querySelector("[data-category=png] .inspection-record")!==null');
        await check('!!document.querySelector("[data-category=png] .inspection-group[open]")','One disclosure reveals every record within its group');
        await evaluate('doAnalyze()');
        await check('document.querySelectorAll("#channel-layers-section [data-knowledge]").length===6','All six annotated visual-analysis sections link to knowledgebase articles');
        await evaluate('document.querySelector("[data-knowledge=histogram]").focus();document.querySelector("[data-knowledge=histogram]").click()');
        await check('document.querySelector(".knowledge-dialog").open && document.querySelector(".knowledge-dialog").textContent.includes("What the axes mean")','Histogram help opens in place with practical explainers');
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await check('!document.querySelector(".knowledge-dialog").open && document.activeElement.dataset.knowledge==="histogram" && state.analyzeFile===inspectionFile','Closing help returns focus and preserves the loaded file');
        await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        await wait('innerWidth===390 && getComputedStyle(document.getElementById("metadata-tree")).gridTemplateColumns.split(" ").length===1');
        await evaluate('document.getElementById("inspection-results").scrollIntoView({block:"start"})');
        await check('document.getElementById("inspection-results").getBoundingClientRect().right<=innerWidth && document.getElementById("metadata-tree").scrollWidth<=document.getElementById("metadata-tree").clientWidth && getComputedStyle(document.getElementById("metadata-tree")).gridTemplateColumns.split(" ").length===1','Inspection tree fits a 390px viewport in a single column');
        await evaluate('chunkSummary.scrollIntoView({block:"center"});chunkSummary.focus()');
        await check('(()=>{const r=chunkSummary.querySelector("[role=tooltip]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()','Focused tooltip stays inside a 390px viewport');
        await screenshot('12-chunk-tooltip-mobile.png');
        await evaluate('chunkSummary.blur();document.getElementById("inspection-results").scrollIntoView({block:"start"})');
        await screenshot('09-file-inspection-mobile.png');
        await evaluate(`(async()=>{const second=new File([plain],'fresh.png',{type:'image/png'});await ST3GGWorkflow.loadMedia('analyze',second);await state.analysisInspectionPromise;window.secondFile=second;})()`);
        await check('state.analysisInspection.name==="fresh.png" && !document.getElementById("metadata-tree").textContent.includes("Acme!") && document.getElementById("channel-layers-section").classList.contains("hidden")','Replacing Analyze input clears previous metadata and stale pixel views');
        await evaluate(`(async()=>{let calls=0;const original=secondFile.arrayBuffer.bind(secondFile);secondFile.arrayBuffer=()=>{calls++;return original();};await ST3GGAnalysis.structureReport(secondFile);await ST3GGAnalysis.inspect(secondFile);window.extraReads=calls;})()`);
        await check('extraReads===0','Repeated reports and inspection reuse the same file scan');
        await evaluate(`(async()=>{const bad=fixture.slice();bad[bad.length-1]^=1;window.badModel=await ST3GGInspection.scan(bad);window.cutModel=await ST3GGInspection.scan(plain.subarray(0,plain.length-8));})()`);
        await check('badModel.issues.some(s=>s.includes("CRC mismatch")) && cutModel.endOffset===null && cutModel.issues.length>0','Damaged and truncated containers report inspection notes rather than clean success');
        await evaluate(`(async()=>{let release;const slow=new File([plain],'slow.png');slow.arrayBuffer=()=>new Promise(r=>release=r);const old=ST3GGAnalysis.inspect(slow);await ST3GGAnalysis.inspect(new File([plain],'latest.png'));release(plain.buffer.slice(plain.byteOffset,plain.byteOffset+plain.byteLength));await old;})()`);
        await check('document.getElementById("inspection-results").dataset.file==="latest.png" && state.analysisInspection.name==="latest.png"','A slow previous scan cannot overwrite a newer file');
        await evaluate(`(async()=>{const b=new Uint8Array(await (await new Promise(r=>state.analyzeCanvas.toBlob(r,'image/jpeg'))).arrayBuffer());const data=join(textBytes('Exif\0\0'),tiff),segment=new Uint8Array(data.length+4);segment.set([255,225]);new DataView(segment.buffer).setUint16(2,data.length+2);segment.set(data,4);window.jpegModel=await ST3GGInspection.scan(join(b.subarray(0,2),segment,b.subarray(2)));})()`);
        await check('jpegModel.format==="JPEG" && jpegModel.appendedBytes===0 && jpegModel.categories.exif.records.some(r=>r.fields.Value==="Acme!")','JPEG segment traversal preserves EXIF values and finds the real EOI');
        await evaluate(`(async()=>{
            const gif=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='),c=>c.charCodeAt(0));window.gifModel=await ST3GGInspection.scan(join(gif,tail));window.cutGif=await ST3GGInspection.scan(gif.subarray(0,gif.length-1));
            const wav=new Uint8Array(44),wv=new DataView(wav.buffer);wav.set(textBytes('RIFF'));wv.setUint32(4,36,true);wav.set(textBytes('WAVEfmt '),8);wv.setUint32(16,16,true);wv.setUint16(20,1,true);wv.setUint16(22,1,true);wv.setUint32(24,8000,true);wv.setUint32(28,16000,true);wv.setUint16(32,2,true);wv.setUint16(34,16,true);wav.set(textBytes('data'),36);window.wavModel=await ST3GGInspection.scan(wav);
            const webp=new Uint8Array(await (await new Promise(r=>state.analyzeCanvas.toBlob(r,'image/webp'))).arrayBuffer());window.webpModel=await ST3GGInspection.scan(webp);
            const payload=textBytes('Caption'),dataset=join(new Uint8Array([28,2,120,0,payload.length]),payload),resource=join(textBytes('Photoshop 3.0\0'),textBytes('8BIM'),new Uint8Array([4,4,0,0]),new Uint8Array([0,0,0,dataset.length]),dataset,new Uint8Array(dataset.length%2));const app=new Uint8Array(resource.length+4);app.set([255,237]);new DataView(app.buffer).setUint16(2,resource.length+2);app.set(resource,4);window.iptcModel=await ST3GGInspection.scan(join(new Uint8Array([255,216]),app,new Uint8Array([255,217])));
        })()`);
        await check('gifModel.format==="GIF" && gifModel.appendedBytes===tail.length && cutGif.endOffset===null && cutGif.issues.length>0','GIF sub-block traversal distinguishes appended bytes from a missing trailer');
        await check('wavModel.format==="WAV" && wavModel.categories.format.records.some(r=>r.fields["Sample rate"]===8000) && wavModel.appendedBytes===0','Audio inspection reads WAV container and sample-format facts');
        await check('webpModel.format==="WebP" && webpModel.appendedBytes===0 && webpModel.categories.format.records.length>1','WebP format records provide real RIFF chunk information');
        await check('iptcModel.categories.iptc.records.some(r=>r.title==="Caption" && r.fields.Value==="Caption")','Photoshop resource framing exposes IPTC dataset values');
        await cdp('Page.navigate',{url:'http://127.0.0.1:8775/knowledgebase.html#dct'});
        await wait('document.querySelector("#knowledge-content h1")?.textContent==="DCT block analysis"');
        await check('document.querySelectorAll("#knowledge-nav a").length===10 && document.getElementById("knowledge-content").textContent.includes("does not read")','Standalone knowledgebase has ten articles and explains the block-view approximation');
        await evaluate('document.getElementById("knowledge-search").value="histogram";document.getElementById("knowledge-search").dispatchEvent(new Event("input"))');
        await check('[...document.querySelectorAll("#knowledge-nav a")].some(a=>a.hash==="#histogram") && document.querySelectorAll("#knowledge-nav a").length<10','Knowledgebase topics are searchable');
        await cdp('Emulation.setDeviceMetricsOverride',{width:1309,height:900,deviceScaleFactor:1,mobile:false});
        await evaluate('location.hash="histogram"');await wait('document.querySelector("#knowledge-content h1").textContent==="Histogram analysis"');
        await screenshot('10-analysis-knowledgebase.png');
        await evaluate('location.hash="png-chunks/pHYs"');
        await wait('document.querySelector("#knowledge-content h1").textContent==="PNG chunk names"');
        await check('document.querySelector("[data-term=pHYs]").getBoundingClientRect().top>=0 && document.querySelector("[data-term=pHYs]").getBoundingClientRect().top<innerHeight','Standalone chunk links jump to the requested definition');
        assert.deepEqual(errors,[],'No browser exceptions');checks++;
        console.log('PASS '+checks+' inspection browser checks');
    } finally { socket.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
