/* Unified run configuration, containment canvas and layer inspector. */
(function () {
    'use strict';
    const C = PolyCore, P = PolyPayloads, textEncoder = new TextEncoder(), textDecoder = new TextDecoder();
    let api, root, selected, busy = false, error = '', progress = '', view = 'plan', reviewed = false, generated = false, workspaceStage = 'setup';
    let presetOpen = false, presetQuery = '', presetGroup = 'All', activePreset = 'chain3', previewPreset = 'chain3', zoom = 1, help = null, modelList = [], runTouched = false;
    let activeFile = null, activeStep = null, templateId = 'layer-notes', templateTargets = new Set(), lastOutput = null, knownRoot = null;
    let objectURLs = [], panning = null, canvasScroll = { left: 0, top: 0 }, rootBaseline = 0;
    let autoFit=true, imageDialogLayer=null, planningModels=[];
    const expanded = new Set(), fileDrafts = new WeakMap(), newFileDrafts = new Map(), templateDrafts = new Map(), instructionErrors = new Map();
    const config = { count: 3, shape: 'chain', source: 'ai', width: 1024, height: 1024, brief: '', reference: '', planModel: '', localStyle: 'texture', variables: { title: 'Layer notes', notes: 'Archive contents for this layer.' } };
    const templates = [{ id: 'layer-notes', name: 'Layer notes', filename: 'README.md', content: '# {{title}}\nLayer {{layer.index}}: {{layer.filename}}\n{{notes}}\n' }];
    const $ = id => document.getElementById(id), uid = () => crypto.randomUUID();
    const subtree = target => { const out = [], stack = [target]; while (stack.length) { const n = stack.pop(); out.push(n); stack.push(...n.entries.filter(e => e.child).map(e => e.child).reverse()); } return out; };
    const nodes = () => subtree(root);
    const current = () => nodes().find(n => n.id === selected) || root;
    const depth = n => { let d = 0; for (; n.parent; n = n.parent) d++; return d; };
    function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
    function icon(name) { const im=el('img',null,'nw-icon');im.src=`assets/polyglot/icons/${name}.svg`;im.alt='';im.setAttribute('aria-hidden','true');return im; }
    function buttonLabel(button,label) {
        button.replaceChildren();
        const match=[[/^(?:Build|Generate|Review run)/,'player-play'],[/^Regenerate|^Recreate/,'refresh'],[/^Download/,'download'],[/^(?:Upload|Replace with|Use an image)/,'upload'],[/^Add files/,'folder-plus'],[/^Add text|Template|template/,'file-text'],[/^Import|^Open an existing/,'folder-open'],[/^Previous/,'chevron-left'],[/^Next:|^Continue to/,'chevron-right']].find(([pattern])=>pattern.test(label));
        const symbols={'+':'plus','−':'minus','×':'x','⋯':'dots'};
        if(symbols[label]){button.append(icon(symbols[label]));button.setAttribute('aria-label',({'+':'Zoom in','−':'Zoom out','×':'Close','⋯':'More actions'})[label]);}
        else {if(match)button.append(icon(match[1]));if(label)button.append(el('span',label));}
    }
    function row(parent, cls = '') { const n = el('div', null, 'nw-row ' + cls); parent.append(n); return n; }
    function note(parent, text, cls = '') { const n = el('p', text, 'nw-note ' + cls); parent.append(n); return n; }
    function button(parent, label, fn, cls = '', title = '') {
        const n = el('button', null, 'nw-button ' + cls); buttonLabel(n,label);n.type = 'button'; n.disabled = busy;
        if (title) n.title = title;
        n.onclick = async () => { try { error = ''; await fn(); } catch (e) { error = e.message; render(); } };
        parent.append(n); return n;
    }
    function field(parent, label, value, fn, opts = {}) {
        const wrap = el('label', null, 'nw-field'); wrap.append(el('span', label));
        const input = el(opts.area ? 'textarea' : opts.choices ? 'select' : 'input');
        if (opts.choices) for (const choice of opts.choices) {
            const pair = Array.isArray(choice) ? choice : [choice, choice], o = el('option', pair[1]); o.value = pair[0]; input.append(o);
        } else if (!opts.area) input.type = opts.type || 'text';
        input.value = value ?? ''; input.disabled = busy || opts.disabled; input.spellcheck = !!opts.area;
        if (opts.key) input.dataset.focus = opts.key;
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.addEventListener(opts.live ? 'input' : 'change', () => {
            try { fn(input.value, input); input.setCustomValidity(''); }
            catch (e) { input.setCustomValidity(e.message); error = e.message; input.reportValidity(); }
        });
        wrap.append(input); parent.append(wrap); return input;
    }
    function disclosure(parent, title, key, draw) {
        const d = el('details', null, 'nw-disclosure'); d.open = expanded.has(key); d.append(el('summary', title));
        d.ontoggle = () => { if (d.isConnected) { if (d.open) expanded.add(key); else expanded.delete(key); } };
        const body = el('div'); d.append(body); parent.append(d); draw(body); return d;
    }
    function badge(parent, label, state = '') { const b = el('span', label, 'nw-badge ' + state); parent.append(b); return b; }
    function image(parent, bytes, cls = '') {
        if (!bytes) { const placeholder = el('div', null, 'nw-placeholder ' + cls);placeholder.append(icon('image-placeholder'));placeholder.setAttribute('aria-label','No image selected');parent.append(placeholder); return; }
        if(typeof bytes==='string'){const im=el('img',null,cls);im.src=bytes;im.alt='Preset image preview';parent.append(im);return;}
        const url = URL.createObjectURL(new Blob([bytes])); objectURLs.push(url); const im = el('img', null, cls); im.src = url; im.alt = 'Layer carrier'; parent.append(im);
    }
    function dirty(node, pixel = false) {
        runTouched = true;
        C.dirty(node); lastOutput = null;
        if (pixel) { node.imageDirty = true; for (const s of P.steps(node)) s.status = 'Configured'; }
    }
    function rename(node, value) {
        value = C.path(value.trim()); if (value.endsWith('/')) throw new Error('Enter a filename.');
        const entry = node.parent?.entries.find(e => e.child === node); if (entry) { C.collision(node.parent.entries, value, entry); entry.name = value; }
        node.name = value; delete node.nameDraft; dirty(node); updateLinkedPreviews();
    }
    function extension(node) { const list = P.steps(node).filter(s => s.enabled !== false); return list.some(s => s.method === 'F5') ? 'jpg' : list.length ? 'png' : C.format(node.image) || 'png'; }
    function alignName(node) {
        const ext = extension(node); if (!(ext === 'jpg' ? /\.jpe?g$/i : /\.png$/i).test(node.name)) rename(node, node.name.replace(/\.[^/.]+$/, '') + '.' + ext);
    }
    function select(node) {
        selected = node.id; activeStep = null; activeFile = null; workspaceStage='layers';
        if (['file', 'payload', 'instructions', 'carrier'].includes(view)) view = '';
        render();
        if(view==='review'){
            const item=document.querySelector('.nw-review-layer.selected'),panel=item?.closest('.nw-editor');
            if(panel){if(item.offsetTop<panel.scrollTop)panel.scrollTop=item.offsetTop;else if(item.offsetTop+item.offsetHeight>panel.scrollTop+panel.clientHeight)panel.scrollTop=item.offsetTop+item.offsetHeight-panel.clientHeight;}
        }
        const viewport = $('nw-canvas'), card = document.querySelector(`[data-layer-id="${node.id}"]`);
        if (viewport && card) {
            const x = parseFloat(card.style.left) * zoom, y = parseFloat(card.style.top) * zoom;
            if (x < viewport.scrollLeft || x + 150 * zoom > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = Math.max(0, x - 35);
            if (y < viewport.scrollTop || y + 170 * zoom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = Math.max(0, y - 30);
        }
        document.querySelector('.nw-inspector h2')?.scrollIntoView({block:'nearest',inline:'nearest'});
    }
    function mutateRun() { runTouched = true; reviewed = false; generated = false; lastOutput = null; }
    function settingsFor(node) { return { width: node.resolution?.width || config.width, height: node.resolution?.height || config.height, source: node.imageSource || config.source }; }
    function validPixels(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Use a positive whole-pixel dimension.'); return n; }
    async function pick(accept = '', multiple = false) {
        return new Promise(resolve => { const f = el('input'); f.type = 'file'; f.accept = accept; f.multiple = multiple; f.onchange = () => resolve([...f.files]); f.oncancel = () => resolve([]); f.click(); });
    }
    async function dataURL(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file); }); }
    function thumbnailUpdate() { $('nw-root')?.querySelectorAll('[data-focus="resolution-width"],[data-focus="resolution-height"]').forEach(n => n.blur()); }
    function rebuildStructure(count, shape) {
        const old = nodes();
        if (count < old.length && !confirm(`Remove ${old.length - count} layers and their archive contents? Remaining layers keep their files and payloads.`)) return false;
        const list = old.slice(0, count); while (list.length < count) list.push(C.layer('layer-' + (list.length + 1) + '.png'));
        const ordinary = new Map(list.map(n => [n, n.entries.filter(e => !e.child)])), plans = [];
        for (let i = 1; i < list.length; i++) {
            const at = shape === 'branches' ? 0 : shape === 'balanced' ? Math.floor((i - 1) / 2) : shape === 'deep-branch' ? (i < 3 ? 0 : i - 2) : i - 1;
            const parent = list[at], child = list[i], entries = ordinary.get(parent); C.collision(entries, child.name); entries.push({ name: child.name, kind: 'layer', child }); plans.push([child, parent]);
        }
        for (const n of list) { n.entries = ordinary.get(n); n.parent = null; delete n.canvasBelowParent; C.dirty(n); }
        for (const [n, parent] of plans) n.parent = parent;
        config.count = count; config.shape = shape; selected = list.some(n => n.id === selected) ? selected : root.id;autoFit=true; mutateRun(); return true;
    }
    async function choosePreset(preset, initial = false) {
        if (!initial && (runTouched || [...fileDraftsPending()].length) && !confirm(`Load “${preset.title}” and replace the current run, including pending edits?`)) return;
        for(const node of nodes())rememberImage(node);
        activePreset = preset.id; previewPreset = preset.id; const n = C.layer(preset.names?.[0] + '.png'); n.name = preset.names?.[0] ? preset.names[0] + '.png' : 'outer.png';
        api.replaceRoot(n); root = n; knownRoot = root; selected = root.id;
        config.count = 1; config.shape = preset.shape; config.source = preset.source; config.width = 1024; config.height = 1024; config.brief = preset.brief || '';config.reference='';
        rebuildStructure(preset.count, preset.shape);
        const list = nodes();
        list.forEach((node, index) => {
            if (preset.names?.[index]) { node.name = preset.names[index] + '.png'; const entry = node.parent?.entries.find(e => e.child === node); if (entry) entry.name = node.name; }
            node.role = preset.names?.[index] || (index ? 'Inner layer ' + index : 'Outer image');
            if(preset.group==='Image sequences')node.previewImage=`assets/polyglot/previews/${['landscape','valley','tree','branch','leaf'][index%5]}.png`;
            node.prompt = sequencePrompt(node, index, list.length);
            node.variables = { title: node.role, notes: `Contents for ${node.name}.` };
            node.settings = { method: 'none', payload: '', options: {} }; node.payloadSteps = [];
            if (preset.method) {
                const step = P.create(preset.method); step.payload = `ST3GG ${preset.method} example, layer ${index + 1}.`;
                if (preset.method === 'F5') { step.options.password = 'demo-password'; node.name = node.name.replace(/\.png$/, '.jpg'); const e = node.parent?.entries.find(e => e.child === node); if (e) e.name = node.name; }
                if (preset.filePayload) { step.filePayload = textEncoder.encode('Example binary-file payload\n'); step.fileName = 'payload.txt'; }
                node.payloadSteps.push(step); node.imageDirty = true;
            }
            const add = (name, contents) => node.entries.push({ name, kind: 'file', bytes: typeof contents === 'string' ? textEncoder.encode(contents) : contents });
            if (preset.files) add('README.md', `# ${preset.title}\n\n${node.name}\n\nEdit this file in the archive editor.\n`);
            if (preset.files === 'instructions') { add('AGENTS.md', `# Layer ${index + 1}\n\nInstructions stored as archive content in ${node.name}.\n`); add('attachment.bin', new Uint8Array([83,84,51,71,71,index])); }
            if (preset.files === 'basic') add('attachment.txt', 'An ordinary archive entry, independent of the image payload.\n');
            if (preset.files === 'folders') { add('documents/', new Uint8Array()); node.entries[node.entries.length - 1].kind = 'folder'; add('documents/notes.txt', 'Notes in a relative archive folder.\n'); }
        });
        activeFile = null; activeStep = null; reviewed = false; generated = false; view = ''; error = ''; rootBaseline = 0; templateTargets = new Set(list.map(n => n.id)); presetOpen = false;
        root.recipe = preset; runTouched = false; workspaceStage='setup'; render();
    }
    const readyExamples = [
        {id:'message',title:'A photo with a hidden message',description:'One landscape photo, a hidden message and a README inside its ZIP.',images:['landscape'],shape:'chain',method:'LSB',brief:'A mountain landscape with a river valley.'},
        {id:'nested',title:'Three images, one inside the next',description:'Open the landscape ZIP to find the tree, then open the tree ZIP to find the leaf.',images:['landscape','tree','leaf'],shape:'chain',brief:'Mountain landscape → tree → leaf'},
        {id:'branches',title:'Two images inside one photo',description:'The landscape ZIP contains two separate images: a valley and a tree, each with its own note.',images:['landscape','valley','tree'],shape:'branches',brief:'A mountain landscape containing a valley image and a tree image.'}
    ];
    async function loadReadyExample(example) {
        if ((runTouched || [...fileDraftsPending()].length) && !confirm(`Load “${example.title}” and replace the current run, including pending edits?`)) return;
        await api.busy(async signal => {
            // Prepare every carrier before replacing the user's current project.
            const layers = [];
            for (const name of example.images) {
                const response = await fetch(`assets/polyglot/previews/${name}.png`, {signal});
                if (!response.ok) throw new Error('Could not load the example image. Please try again.');
                const bytes = new Uint8Array(await response.arrayBuffer());
                const bitmap = await createImageBitmap(new Blob([bytes], {type:'image/png'})); bitmap.close();
                C.check(signal);
                const node = C.layer(name+'.png', bytes);
                node.baseImage=bytes;node.imageSource='upload';node.imageSourceReady=true;
                node.role=name;node.scene=`A detailed photograph of a ${name}.`;node.prompt=node.scene;
                node.variables={title:name,notes:`This is the ${name} image in the ${example.title} example.`};
                node.settings={method:'none',payload:'',options:{}};node.payloadSteps=[];
                node.entries.push({name:'README.md',kind:'file',bytes:textEncoder.encode(`# ${name}\n\n${example.description}\n\nThis image and all example text are already supplied. Build and download the outer image, then open it as a ZIP to explore its files.\n`)});
                layers.push(node);
            }
            for(let i=1;i<layers.length;i++){
                const parent=layers[example.shape==='branches'?0:i-1];layers[i].parent=parent;
                parent.entries.push({name:layers[i].name,kind:'layer',child:layers[i]});
            }
            if(example.method){
                const step=P.create(example.method);step.payload='Hello from the mountains! This message is hidden in the landscape image.';
                step.options={...step.options,channels:'RGB',bits:1};layers[0].payloadSteps.push(step);layers[0].imageDirty=true;
                layers[0].entries.push({name:'decoding.txt',kind:'file',bytes:textEncoder.encode('Open the downloaded landscape.png in ST3GG Decode. Select LSB, RGB channels and 1 bit to read the hidden message. No password is needed.\n')});
            }
            C.check(signal);
            for(const node of nodes())rememberImage(node);
            root=layers[0];knownRoot=root;selected=root.id;api.replaceRoot(root);
            config.count=layers.length;config.shape=example.shape;config.source='upload';config.brief=example.brief;config.reference='';
            const dims=PolySize.dimensions(root.image);config.width=dims.width;config.height=dims.height;
            activePreset='';activeFile=null;activeStep=null;lastOutput=null;rootBaseline=0;help=null;
            templateTargets=new Set(layers.map(n=>n.id));reviewed=true;generated=true;runTouched=true;
            presetOpen=false;autoFit=true;canvasScroll={left:0,top:0};workspaceStage='layers';view='review';error='';
            progress=example.title+' loaded. All images and text are ready to build.';
        });
    }
    function drawReadyExamples(parent) {
        parent.append(el('h3','Three ready-to-build examples'));
        note(parent,'Images, filenames and sample text are included. Load an example, then choose Build & download. No typing, image generation or API key is needed.');
        const list=el('div',null,'nw-ready-examples');parent.append(list);
        for(const example of readyExamples){
            const card=el('section',null,'nw-ready-example');list.append(card);
            const previews=row(card,'nw-example-images');for(const name of example.images)image(previews,`assets/polyglot/previews/${name}.png`,'nw-example-image');
            card.append(el('h4',example.title));note(card,example.description);
            button(card,'Load example',()=>loadReadyExample(example),'primary').setAttribute('aria-label','Load example: '+example.title);
        }
    }
    function sequencePrompt(node, index, count) {
        return config.brief.includes('→')
            ? 'Depict {{layer.scene}}.\nSequence context: {{sequence.brief}}.\nShow this scene only, using a consistent subject and visual style.'
            : '{{layer.scene}}';
    }
    function promptFor(node) {
        return interpolate(node.prompt || sequencePrompt(node), node);
    }
    function missingImageDescription(node) {
        return /\{\{\s*layer.scene\s*\}\}/.test(node.prompt||sequencePrompt(node))&&!String(resolvedVars(node)['layer.scene']).trim();
    }
    function updatePrompt(node, text) {
        node.prompt = text; node.promptCustom = true; runTouched = true;
    }
    function layerNumber(node) { return nodes().indexOf(node) + 1; }
    function nextMissingImage(node) {
        const list = nodes(), at = list.indexOf(node);
        return list.slice(at + 1).concat(list.slice(0, at)).find(n => !n.image);
    }
    function imageAction(node) {
        const number = layerNumber(node), source = settingsFor(node).source;
        if (source === 'upload') return { label: `${node.image ? 'Replace' : 'Choose'} image file for layer ${number}…`, run: () => uploadImage(node) };
        return {
            label: source === 'ai' ? `${node.image ? 'Regenerate' : 'Generate'} layer ${number} image with AI` : `${node.image ? 'Recreate' : 'Create'} layer ${number} image locally`,
            run: () => generateLayers(node)
        };
    }
    function flowAction(node) {
        if (!node.image) {
            if (settingsFor(node).source === 'ai') {
                let promptText;
                try { promptText=promptFor(node); }
                catch(e){return { label: `Set layer ${layerNumber(node)} prompt variables`, detail: e.message, kind:'prompt',run:()=>{expanded.add(`prompt-template-${node.id}`);expanded.add(`prompt-variables-${node.id}`);focusPrompt(node);} };}
                if (!promptText.trim()||missingImageDescription(node)) return { label: `Describe layer ${layerNumber(node)} image`, detail: `Set the image description for ${node.name}.`, kind: 'prompt', run: () => focusPrompt(node) };
                if (!ST3GGImageAgent.settings().apiKey) return { label: 'Connect image model', detail: 'Add the Agent key in Model settings to generate images.', kind: 'connection', run: openModelSettings };
            }
            return { ...imageAction(node), detail: `Layer ${layerNumber(node)}: ${node.name}`, kind: 'image' };
        }
        const next = nextMissingImage(node);
        if (next) return { label: `Continue to layer ${layerNumber(next)}: ${next.name}`, detail: `${node.name} has an image. ${next.name} still needs one.`, run: () => select(next), kind: 'next', target: next };
        const conflict = nodes().find(n => !P.rules(P.steps(n)).ok);
        if (conflict) return { label: `Resolve payload settings in layer ${layerNumber(conflict)}`, detail: P.rules(P.steps(conflict)).conflicts[0].reason, run: () => { select(conflict); $(`nw-payloads-${conflict.id}`).scrollIntoView({block:'start'}); }, kind: 'conflict' };
        const pending = [...fileDraftsPending()][0];
        if (pending) return { label: `Continue editing ${pending.name}`, detail: 'Save the file draft before building.', run: () => { select(nodes().find(n => n.id === pending.nodeId)); activeFile = pending; view = 'file'; render(); }, kind: 'draft' };
        if (root.original && !root.dirty) return { label: `Download ${root.name}`, detail: 'Download the complete file with its readable image and archive structure.', run: () => api.download(root.original, root.name), kind: 'download' };
        return { label: 'Build & download', detail: 'Build the nested ZIPs and verify the images, files and configured payloads.', run: () => build(), kind: 'build' };
    }
    function focusPrompt(node) {
        selected=node.id;expanded.add(`prompt-${node.id}`);render();
        const input=document.querySelector(`[data-focus="scene-${node.id}"]`);input?.focus({preventScroll:true});input?.scrollIntoView({block:'center'});
    }
    function refreshNextAction() {
        const action=flowAction(current()),primary=$('nw-primary'),detail=$('nw-next-detail');
        if(primary){const next=headerAction();buttonLabel(primary,next.label);primary.title=next.detail||action.detail;}
        if(detail)detail.textContent=action.detail;
    }
    async function localCarrier(node) {
        const { width, height } = settingsFor(node), canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        if (canvas.width !== width || canvas.height !== height) throw new Error(`Browser could not allocate ${width} × ${height}.`);
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Browser could not allocate the carrier canvas.');
        const index = nodes().indexOf(node), hue = (205 + index * 23) % 360;
        const gradient = ctx.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, `hsl(${hue} 35% 20%)`); gradient.addColorStop(1, `hsl(${hue + 60} 25% 72%)`);
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
        if (config.localStyle === 'texture') {
            const pixels = ctx.getImageData(0, 0, width, height); let seed = 29 + index;
            for (let i = 0; i < pixels.data.length; i += 4) { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; const d = (seed >>> 29) - 3; for (let c = 0; c < 3; c++) pixels.data[i + c] += d; }
            ctx.putImageData(pixels, 0, 0);
        }
        return api.canvasBytes(canvas);
    }
    async function normalizeImage(bytes, target, mime) {
        const url = URL.createObjectURL(new Blob([bytes], { type: mime || '' }));
        try {
            const im = new Image(); im.src = url; await im.decode();
            if (!target && C.format(bytes)) return bytes;
            const canvas = document.createElement('canvas'); canvas.width = target?.width || im.naturalWidth; canvas.height = target?.height || im.naturalHeight;
            const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Browser could not allocate the requested image dimensions.');
            ctx.fillStyle = '#171a20'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            const scale = Math.min(canvas.width / im.naturalWidth, canvas.height / im.naturalHeight), w = im.naturalWidth * scale, h = im.naturalHeight * scale;
            ctx.drawImage(im, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h); return api.canvasBytes(canvas);
        } finally { URL.revokeObjectURL(url); }
    }
    function clearDetection(node) {
        const results=Array.isArray(node.detection)?node.detection:[];
        for(const result of results)if(result.autoExtracted?.downloadUrl)URL.revokeObjectURL(result.autoExtracted.downloadUrl);
        delete node.detection;
    }
    function rememberImage(node){if(node.image)void PolyImageLibrary.remember(node.name,node.baseImage||node.image).catch(()=>{});}
    function drawImageGallery(parent,node,close){
        const heading=el('h3','Choose an existing image');parent.append(heading);
        note(parent,'Reuse an example image or an image from your previous work. Only the image is copied; files and nested layers stay in their original project.');
        const grid=el('div',null,'nw-image-gallery');parent.append(grid);
        const use=async bytes=>{
            if(node.original&&!confirm('Replace this carrier image? Existing unknown image payloads may be lost. Archive files are retained.'))return;
            putImage(node,bytes.slice());node.imageSource='upload';generated=nodes().every(n=>n.image);close();render();
        };
        const tile=(name,bytes,source)=>{
            const card=el('div',null,'nw-library-card');grid.append(card);
            const choose=button(card,'',async()=>{
                let data=bytes;
                if(typeof data==='string'){
                    const response=await fetch(data);if(!response.ok)throw Error('Could not load this example image. Please try again.');
                    data=new Uint8Array(await response.arrayBuffer());
                }
                // The dialog may have been closed while an image was loading.
                if(!parent.isConnected||imageDialogLayer!==node.id)return;
                await use(data);
            },'nw-library-choice');
            choose.setAttribute('aria-label','Use '+name);image(choose,bytes,'nw-library-image');choose.append(el('strong',name));note(card,source);
        };
        for(const name of ['landscape','valley','tree','branch','leaf'])tile(name+'.png',`assets/polyglot/previews/${name}.png`,'Example image');
        const status=note(parent,'Loading saved images…');
        Promise.all(nodes().filter(n=>n.image).map(n=>PolyImageLibrary.remember(n.name,n.baseImage||n.image)))
            .then(()=>PolyImageLibrary.list()).then(items=>{
                if(!parent.isConnected)return;
                for(const item of items)tile(item.name,item.bytes,'Saved in this browser');
                status.textContent=PolyImageLibrary.warning||'Generated and uploaded images are saved in this browser for reuse.';
            }).catch(()=>{if(parent.isConnected)status.textContent='Saved images could not be loaded. The example images are still available.';});
    }
    function putImage(node, bytes) { if(node.image)rememberImage(node);void PolyImageLibrary.remember(node.name,bytes).catch(()=>{});clearDetection(node);node.image = bytes; node.baseImage = bytes; node.imageSourceReady = true; dirty(node, true); alignName(node); }
    async function uploadImage(node, resize = false) {
        const [file] = await pick('image/*'); if (!file) return;
        if (node.original && !confirm(`Replace ${node.name}’s carrier? Existing image payloads may be invalidated. Its archive contents are retained.`)) return;
        await api.busy(async signal => {
            let bytes = await api.bytesOf(file); try { bytes = (await C.readZip(bytes, signal)).image; } catch { C.check(signal); }
            bytes = await normalizeImage(bytes, resize ? settingsFor(node) : null, file.type); C.check(signal); putImage(node, bytes); node.imageSource = 'upload';
        });
    }
    async function reviewRun(useVision = false) {
        const list = nodes();
        if (useVision) await api.busy(async signal => {
            const plan = await ST3GGImageAgent.plan({ brief: config.brief, layers: list, reference: config.reference, signal, model: config.planModel });
            C.check(signal); for (const n of list) { const p = plan.find(p => String(p.id) === String(n.id)); n.scene = p.prompt; n.prompt = sequencePrompt(n); n.role = p.role || n.role; }
        });
        else for (const [i,n] of list.entries()) if (!n.prompt) n.prompt = sequencePrompt(n, i, list.length);
        reviewed = true; view = 'plan'; render();
    }
    async function generateLayers(only = null) {
        const list = only ? [only] : nodes().filter(n => !n.image);
        if (!list.length) { progress = 'Every layer has an image. You can build the output or edit a selected layer.'; render(); return; }
        // Resolve every prompt before starting paid requests, so missing variables cause no partial run.
        const prompts = new Map(list.filter(n => settingsFor(n).source === 'ai').map(n => [n.id, promptFor(n)]));
        const empty=list.find(n=>prompts.has(n.id)&&(!prompts.get(n.id).trim()||missingImageDescription(n)));
        if(empty){focusPrompt(empty);throw new Error(`Describe the image for ${empty.name} before generating it.`);}
        if (list.some(n => settingsFor(n).source === 'ai') && !ST3GGImageAgent.settings().apiKey) {
            expanded.add('models'); render(); throw new Error('Enter the Agent API key under Model settings before generating images.');
        }
        if (list.some(n => n.original) && !confirm('Replace the selected carriers? Existing imported image payloads may be invalidated; archive contents remain.')) return;
        await api.busy(async signal => {
            for (const [index,node] of list.entries()) {
                C.check(signal); progress = `Preparing image ${index + 1}/${list.length}: ${node.name}`; render();
                const setting = settingsFor(node); let bytes;
                if (setting.source === 'upload') { if (!node.image) throw new Error(`Upload a carrier for ${node.name}.`); continue; }
                if (setting.source === 'ai') {
                    const ref = node.parent?.image ? 'data:image/'+(C.format(node.parent.image)==='jpg'?'jpeg':'png')+';base64,' + bytes64(node.parent.image) : config.reference;
                    const result = await ST3GGImageAgent.generate({ prompt: prompts.get(node.id), signal, size: `${setting.width}x${setting.height}`, references: ref ? [ref] : [] });
                    bytes = await normalizeImage(result.bytes, setting, result.type);
                    node.imageAgent = { model: result.model, sourceBytes: result.bytes.length, outputBytes: bytes.length, width: setting.width, height: setting.height };
                } else bytes = await localCarrier(node);
                C.check(signal); putImage(node, bytes); await C.tick();
            }
            const recipe = root.recipe;
            if (recipe?.files === 'gallery') {
                for (let i = 0; i < 2; i++) { const name = `gallery/image-${i + 1}.png`; if (!root.entries.some(e => e.name === name)) root.entries.push({ name, kind: 'file', bytes: await localCarrier(root) }); }
            }
            generated = nodes().every(n => n.image); workspaceStage='layers'; view='previews';
            progress = only ? `${only.name}: image ready.` : `Created ${list.length} layer images.`;
            if (recipe?.importedExample && !root.exampleOpened) {
                const output = await C.build(root, P.adapter(api.adapter), signal, message => { progress = message; render(); });
                const imported = await C.open(output, root.name, api.canvasOf, signal); C.check(signal);
                const before = nodes(), stack = [imported], after = []; while (stack.length) { const n = stack.pop(); after.push(n); stack.push(...n.entries.filter(e => e.child).map(e => e.child).reverse()); }
                after.forEach((n,i) => { n.payloadSteps = structuredClone(before[i].payloadSteps); n.imageDirty = false; n.imageSourceReady = true; });
                api.replaceRoot(imported); root = imported; knownRoot = root; selected = root.id; root.exampleOpened = true;
            }
        });
    }
    function bytes64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i,i + 16384)); return btoa(s); }
    function addPayload(node, method) {
        const step = candidateFor(node,method);
        const check = P.rules([...P.steps(node), step]);
        if (!check.ok) throw new Error(check.conflicts[0].reason);
        if(node.original && !node.payloadSteps.length && !confirm(`Configure a new payload in ${node.name}? Existing unknown image payloads may be invalidated when re-encoding.`))return;
        P.steps(node).push(step); activeStep = step.id; view = 'payload'; dirty(node, true); render();
    }
    function candidateFor(node,method) {
        const step=P.create(method);
        if(method==='PNGCHUNK')step.options.keyword='Payload_'+step.id.slice(0,8);
        if(['LSB','SPECTER'].includes(method)&&!P.rules([...P.steps(node),step]).ok)for(const [index,channel]of ['R','G','B'].entries()){
            const candidate={...step,options:method==='LSB'?{channels:channel}:{steps:JSON.stringify([{channels:[index],bits:1}])}};
            if(P.rules([...P.steps(node),candidate]).ok)return candidate;
        }
        return step;
    }
    function resolvedVars(node, extra = {}) {
        const list = nodes(), index = list.indexOf(node), scenes = config.brief.split(/\s*→\s*/).filter(Boolean);
        return { ...config.variables, ...node.variables, ...extra,
            'layer.index': index + 1, 'layer.count': list.length, 'layer.filename': node.name, 'layer.name': node.name,
            'layer.depth': depth(node), 'layer.scene': node.scene ?? (config.brief.includes('→') ? scenes[index]||'' : config.brief),
            'sequence.brief': config.brief,
            'project.name': root.name.replace(/\.[^.]+$/, '') };
    }
    function interpolate(text, node, extra = {}) {
        const values = resolvedVars(node, extra);
        return String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => { if (!(key in values)) throw new Error(`Set {{${key}}} for ${node.name}.`); return String(values[key]); });
    }
    function updateLinkedPreviews() { /* Rendering resolves variables from the current structure. */ }
    function selectedTemplate() { const source=templates.find(t => t.id === templateId) || templates[0];if(!templateDrafts.has(source.id))templateDrafts.set(source.id,structuredClone(source));return templateDrafts.get(source.id); }
    function saveTemplate(tpl, silent=false) { const source=templates.find(t=>t.id===tpl.id);if(source)Object.assign(source,structuredClone(tpl));else templates.push(structuredClone(tpl));if(!silent){progress=`Template “${tpl.name}” saved for this run.`;render();} }
    function applyTemplate(tpl, targets, update = false) {
        const jobs = [], replacements=[];
        for (const node of targets) {
            const linked = node.entries.filter(e => e.template?.id === tpl.id);
            const source = update ? linked : [linked[0] || null];
            for (let entry of source) {
                if (entry?.template.override) continue;
                const value = interpolate(tpl.content, node, entry?.template.variables || {}), name = C.path(interpolate(tpl.filename, node, entry?.template.variables || {}));
                if(!entry){const existing=node.entries.find(e=>e.name===name);if(existing){if(existing.child||existing.kind==='folder'||!api.textDraft(existing))throw new Error(`${node.name} / ${name} already exists and is not an editable text file. Choose another filename pattern.`);entry=existing;replacements.push(node.name+' / '+name);}}
                const draft=entry&&fileDrafts.get(entry);if(draft&&draft.text!==draft.initial)throw new Error(`Save or discard pending edits to ${entry.name} before updating its template.`);
                if (name.endsWith('/')) throw new Error('A template needs a file path.'); C.collision(node.entries, name, entry);
                jobs.push({ node, entry, name, value });
            }
        }
        if(replacements.length&&!confirm('Replace the contents of these existing files and link them to this template?\n'+replacements.join('\n')))return;
        for (const job of jobs) {
            let e = job.entry; if (!e) { e = { name: job.name, kind: 'file', bytes: new Uint8Array(), template: { id: tpl.id, variables: {}, override: false } }; job.node.entries.push(e); }
            if(!e.template||e.template.id!==tpl.id)e.template={id:tpl.id,variables:{},override:false};
            e.name = job.name; api.saveText(job.node, e, job.value); dirty(job.node);
        }
        saveTemplate(tpl,true);
        progress = `${jobs.length} linked ${jobs.length === 1 ? 'file' : 'files'} updated.`; render();
    }
    function instructionText(source, step) {
        const opts = P.options(step), lines = [`Decode ${source.name} using ${step.method}.`, 'Decoding settings:'];
        for (const [key,value] of Object.entries(opts)) if (!/password|key|secret/i.test(key)) lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
        lines.push(`Decoding order: step ${P.steps(source).filter(s => s.enabled !== false).indexOf(step) + 1}.`);
        return step.instructions?.textOverride || lines.join('\n');
    }
    function removeInstructionArtifact(source, step) {
        const link = step.instructions?.installed; if (!link) return;
        const destination = nodes().find(n => n.id === link.layerId); if (!destination) return;
        if (link.stepId) { destination.payloadSteps = P.steps(destination).filter(s => s.id !== link.stepId); dirty(destination, true); }
        if (link.file) {
            const e = destination.entries.find(e => e.name === link.file), draft = e && api.textDraft(e);
            if (draft) { const from = `<!-- ST3GG decode:${step.id} -->`, to = `<!-- /ST3GG decode:${step.id} -->`, at = draft.text.indexOf(from), end = draft.text.indexOf(to, at); if (at >= 0 && end >= 0) api.saveText(destination, e, draft.text.slice(0,at) + draft.text.slice(end + to.length)); }
        }
        step.instructions.installed = null;
    }
    function applyInstructions(source, step, silent = false) {
        const link = step.instructions; if (!link?.enabled) return;
        const destination = nodes().find(n => n.id === Number(link.layerId)); if (!destination) throw new Error('Choose an instruction destination layer.');
        const text = instructionText(source, step), previous = link.installed;
        if (link.kind === 'payload') {
            const existing = previous && previous.layerId === destination.id && P.steps(destination).find(s => s.id === previous.stepId);
            const target = existing ? { ...existing, options: { ...existing.options } } : P.create(link.method);
            target.method = link.method; target.payload = text; target.filePayload = null; target.linkedInstructions = { sourceLayer: source.id, sourceStep: step.id };
            target.options = { ...(link.options || {}) };
            if (target.method === 'PNGCHUNK' && !target.options.keyword) target.options.keyword = 'Decode_' + step.id.slice(0,8);
            const candidates = P.steps(destination).filter(s => s.id !== existing?.id), check = P.rules([...candidates,target]);
            if (!check.ok) throw new Error(check.conflicts[0].reason);
            if (previous && (!existing || previous.file)) removeInstructionArtifact(source,step);
            if (existing) Object.assign(P.steps(destination).find(s => s.id === existing.id), target); else P.steps(destination).push(target);
            link.installed = { layerId: destination.id, stepId: target.id }; dirty(destination,true);
        } else {
            const name = C.path(link.file || 'decoding.md'); if (name.endsWith('/')) throw new Error('Choose a text filename.');
            let entry = destination.entries.find(e => e.name === name);
            if (entry?.child || entry?.kind === 'folder') throw new Error('Choose an ordinary text file destination.');
            if (entry && !api.textDraft(entry)) throw new Error('The destination file is not editable UTF-8 text. Choose another file.');
            if (previous && (previous.layerId !== destination.id || previous.file !== name)) removeInstructionArtifact(source,step);
            if (!entry) { entry = { name, kind: 'file', bytes: new Uint8Array() }; destination.entries.push(entry); }
            const draft = api.textDraft(entry), from = `<!-- ST3GG decode:${step.id} -->`, to = `<!-- /ST3GG decode:${step.id} -->`;
            const block = from + '\n' + text + '\n' + to, at = draft.text.indexOf(from), end = draft.text.indexOf(to,at);
            const value = at >= 0 && end >= 0 ? draft.text.slice(0,at) + block + draft.text.slice(end + to.length) : draft.text + (draft.text ? '\n\n' : '') + block + '\n';
            api.saveText(destination,entry,value); link.installed = { layerId: destination.id, file: name }; dirty(destination);
        }
        instructionErrors.delete(step.id); if (!silent) { progress = 'Decoding instructions updated in ' + destination.name; render(); }
    }
    async function build(download = true, target = root, zipOnly = false) {
        const scope=subtree(target),pending = [...fileDraftsPending()].filter(d=>scope.some(n=>n.id===d.nodeId)); if (pending.length) throw new Error('Save or discard the open file draft before building.');
        await api.busy(async signal => {
            const snapshot = nodes().flatMap(n => P.steps(n).map(step => ({ node:n,step })));
            for (const {node,step} of snapshot) if (step.instructions?.enabled && step.instructions.installed) applyInstructions(node,step,true);
            for (const n of scope) {
                if(n.nameDraft)throw new Error(`Fix the pending filename for ${n.name}: ${n.nameDraft}`);
                if (!n.image) { if (settingsFor(n).source !== 'local') throw new Error(`Generate or upload ${n.name}’s image first.`); putImage(n,await localCarrier(n)); }
                const check = P.rules(P.steps(n)); if (!check.ok) throw new Error(`${n.name}: ${check.conflicts[0].reason}`);
                alignName(n); C.check(signal);
            }
            const wrapped = P.adapter(api.adapter), adapter = { validateImage: wrapped.validateImage, encode: (node,signal) => wrapped.encode({ ...node, image: node.baseImage || node.image },signal) };
            const bytes = await C.build(target,adapter,signal,message => { progress = message; render(); });
            C.check(signal);
            for (const n of nodes()) for (const s of P.steps(n)) if (s.enabled !== false && n.validation.includes('payloads decoded')) s.status = 'Verified';
            if (zipOnly) { const zip = await C.readZip(bytes,signal); api.download(await C.writeZip(zip.entries,new Uint8Array(),signal),target.name.replace(/\.[^.]+$/,'.zip')); }
            else if (download) api.download(bytes,target.name);
            lastOutput = target === root ? bytes : lastOutput;expanded.add('result-layers');expanded.add('result-sizes');view = 'results'; workspaceStage='export'; generated = nodes().every(n=>n.image); reviewed = true;
        });
    }
    function* fileDraftsPending() { for (const node of nodes()) {for (const entry of node.entries) { const d = fileDrafts.get(entry); if (d && d.text !== d.initial) yield d; }const d=newFileDrafts.get(node.id);if(d&&d.text!==d.initial)yield d;} }
    async function addFiles(node) {
        const files = await pick('',true), staged = [], check = [...node.entries];
        for (const f of files) { const name = f.webkitRelativePath || f.name; C.collision(check,name); const e = { name,kind:'file',bytes:await api.bytesOf(f) }; check.push(e); staged.push(e); }
        node.entries.push(...staged); if (staged.length) dirty(node); render();
    }
    function editFile(node, entry = null) {
        if (entry?.bytes == null && entry) throw new Error(entry.issue || 'This file is preserved as opaque bytes and cannot be edited. Download its containing ZIP.');
        const base = entry ? api.textDraft(entry) : { text:'',initial:'' };
        if (!base) { activeFile = { nodeId:node.id,entry,binary:true }; view='file'; render(); return; }
        let draft = entry ? fileDrafts.get(entry) : newFileDrafts.get(node.id);
        if (!draft) draft = { nodeId:node.id, entry, name:entry?.name || 'README.md', text:base.text, initial:base.text, creating:!entry };
        if (entry) fileDrafts.set(entry,draft);else newFileDrafts.set(node.id,draft); activeFile = draft; view='file'; render();
    }
    function saveFile() {
        const d = activeFile, node = nodes().find(n => n.id === d.nodeId); if (!node) throw new Error('The containing layer has been removed.');
        const name = C.path(d.name.trim()); if (name.endsWith('/')) throw new Error('Choose a file path.'); C.collision(node.entries,name,d.entry);
        let entry = d.entry; if (!entry) { entry = {name,kind:'file',bytes:new Uint8Array()}; node.entries.push(entry); }
        entry.name = name; if (entry.template && d.text !== d.initial) entry.template.override = true;
        api.saveText(node,entry,d.text); dirty(node); d.entry = entry; d.initial = d.text; d.creating = false; newFileDrafts.delete(node.id);fileDrafts.set(entry,d); progress = name + ' saved.'; render();
    }
    function helpButton(parent, method) { const b = button(parent,'?',() => { help = help === method ? null : method;if(help)expanded.add('help-'+method+'-example');render(); },'nw-help-button',`About ${PolyTechniqueHelp[method].title}`); b.setAttribute('aria-label',`Explain ${method}`); b.setAttribute('aria-expanded',String(help === method)); }
    function drawPresets(parent) {
        const header = row(parent,'nw-presets-header');
        const toggle = button(header,'Presets',() => {presetOpen=!presetOpen;render();});toggle.prepend(icon(presetOpen?'chevron-down':'chevron-right'));badge(toggle,String(PolyPresets.length));toggle.append(icon('chevron-right'));toggle.setAttribute('aria-expanded',String(presetOpen));
        if (!presetOpen) return;
        field(parent,'Search presets',presetQuery,v=>{presetQuery=v;render();},{key:'preset-search',live:true});
        const categories=row(parent,'nw-preset-categories');categories.setAttribute('role','group');categories.setAttribute('aria-label','Preset category');for(const category of ['All','Containers','Structures','Image sequences','Encoding','Editing']){const choice=button(categories,category,()=>{presetGroup=category;render();},presetGroup===category?'active':'');choice.setAttribute('aria-pressed',String(presetGroup===category));}
        const list=el('div',null,'nw-preset-list');parent.append(list);
        const matches=PolyPresets.filter(p=>(presetGroup==='All'||p.group===presetGroup)&&(p.title+' '+p.description+' '+(p.brief||'')).toLowerCase().includes(presetQuery.toLowerCase()));
        if(matches.length&&!matches.some(p=>p.id===previewPreset))previewPreset=matches[0].id;
        for (const p of matches) {
            const b=button(list,'',()=>{previewPreset=p.id;render();},p.id===previewPreset?'nw-preset-selected':'');
            if(p.group==='Image sequences')image(b,`assets/polyglot/previews/${p.id==='zoom-out'?'leaf':p.id==='seasons'?'tree':'landscape'}.png`,'nw-preset-thumbnail');else b.append(icon(p.method?'file-text':p.group==='Structures'?'layers-intersect':'archive'));
            b.append(el('strong',p.title),el('span',String(p.count),'nw-preset-count'));b.setAttribute('aria-pressed',String(p.id===previewPreset));b.setAttribute('aria-label',`${p.title}, ${p.count} ${p.count===1?'image':'images'}`);
        }
        if(!matches.length)note(list,'No presets match this search.');else{const selectedRow=list.querySelector('.nw-preset-selected');if(selectedRow)list.scrollTop=Math.max(0,selectedRow.offsetTop-list.offsetTop-8);}
        const preview=matches.find(p=>p.id===previewPreset)||matches[0];
        if(preview){const detail=el('section',null,'nw-preset-detail');detail.append(el('strong',preview.title));note(detail,preview.description);button(detail,'Use this preset',()=>choosePreset(preview));parent.append(detail);}
    }
    function drawRun(parent) {
        button(parent,'Ready-to-build examples',()=>{view='ready-examples';render();},'nw-examples-entry');drawPresets(parent);const runHeading=row(parent,'nw-run-heading');runHeading.append(el('h3','Run configuration'));button(runHeading,'Usage examples',()=>{view='examples';render();},'quiet');
        const count=field(parent,'Total layers',nodes().length,v=>{if(rebuildStructure(validPixels(v),config.shape)) render();},{type:'number',key:'layer-count'});count.parentElement.classList.add('nw-count-field');count.min='1';
        field(parent,'Structure',config.shape,v=>{rebuildStructure(nodes().length,v);render();},{choices:[['chain','One inside the next'],['branches','Together inside the outer image'],['balanced','Split into groups'],['deep-branch','Together, with one nested further']]});
        disclosure(parent,'How this structure nests images','layout-explanation',drawLayoutDescription);
        const sourceControl=el('div',null,'nw-source-control');parent.append(sourceControl);sourceControl.append(el('label','Image source'));
        const sources=row(sourceControl,'nw-segmented');for(const [source,label]of[['local','Local carrier'],['ai','AI sequence']]){const b=button(sources,label,()=>{config.source=source;mutateRun();render();},config.source===source?'active':'');b.setAttribute('aria-pressed',String(config.source===source));}
        if(config.source==='upload')note(sourceControl,'Using uploaded images');
        const resolutions=['512x512','1024x1024','1536x1024','1024x1536','2048x2048','custom'], cur=config.width+'x'+config.height;
        field(parent,'Output resolution',resolutions.includes(cur)?cur:'custom',v=>{if(v!=='custom'){[config.width,config.height]=v.split('x').map(Number);mutateRun();render();}else{expanded.add('custom-resolution');render();}},{choices:resolutions.map(v=>[v,v==='custom'?'Custom dimensions…':v.replace('x',' × ')])});
        disclosure(parent,'Width & height','custom-resolution',body=>{field(body,'Width (px)',config.width,v=>{config.width=validPixels(v);mutateRun();},{type:'number',key:'resolution-width'});field(body,'Height (px)',config.height,v=>{config.height=validPixels(v);mutateRun();},{type:'number',key:'resolution-height'});});
        if(config.source==='local')field(parent,'Local image appearance',config.localStyle,v=>{config.localStyle=v;mutateRun();},{choices:[['texture','Textured gradient'],['gradient','Smooth gradient']]});
        if(config.source==='upload'&&nodes().some(n=>!n.image))button(parent,'Choose files for unfinished layers…',async()=>{const files=await pick('image/*',true);const list=nodes().filter(n=>!n.image);if(files.length>list.length)throw new Error(`There are ${list.length} layers without images. Choose an existing layer to replace its image.`);await api.busy(async signal=>{for(let i=0;i<files.length;i++){C.check(signal);putImage(list[i],await normalizeImage(await api.bytesOf(files[i]),null,files[i].type));list[i].imageSource='upload';}generated=nodes().every(n=>n.image);});});
        if(config.source==='ai'||nodes().some(n=>n.imageSource==='ai')) {
            field(parent,'Shared image description',config.brief,v=>{config.brief=v;for(const n of nodes())if(!n.promptCustom)n.prompt=sequencePrompt(n);mutateRun();render();},{area:true,key:'brief',placeholder:'Describe the images, or specify scenes in order: landscape → tree → leaf.'});
            const ref=el('div',null,'nw-reference');parent.append(ref);ref.append(el('label','Reference image (optional)'));
            if(config.reference){const im=el('img');im.src=config.reference;im.alt='Sequence reference';ref.append(im);}
            const refAction=button(ref,config.reference?'Replace reference image…':'Add a reference image',async()=>{const[f]=await pick('image/*');if(f){config.reference=await dataURL(f);runTouched=true;render();}},config.reference?'quiet':'nw-reference-empty');if(!config.reference)refAction.prepend(icon('photo'));
        }
        disclosure(parent,'Model settings','models',drawModelSettings);
        button(parent,'Manage prompt & file variables',()=>{view='variables';render();},'quiet');
    }
    function openModelSettings() {
        error='';expanded.add('models');render();
        const input=document.querySelector('.nw-run [data-focus="api-key"]');
        input?.focus({preventScroll:true});input?.scrollIntoView({block:'center',behavior:'instant'});
    }
    function agentModel() { const value=$('aiagent-model').value;return value==='custom'?$('aiagent-custom-model').value.trim():value; }
    function modelControl(parent,label,value,change,models,discover,key,defaultModel='') {
        const input=field(parent,label,value,change,{key,placeholder:defaultModel?'Agent default: '+defaultModel:'Search or enter a model ID'}),wrapper=input.parentElement;
        const control=el('div',null,'nw-model-control'),list=el('datalist');list.id='nw-model-options-'+uid();input.setAttribute('list',list.id);input.autocomplete='off';
        for(const model of [...new Map([{id:value},...models].filter(m=>m.id).map(m=>[m.id,m])).values()]){const option=el('option');option.value=model.id;if(model.name)option.label=model.name;list.append(option);}
        input.replaceWith(control);control.append(input);wrapper.append(list);
        const find=button(control,'',async()=>{find.disabled=true;await discover();render();},'quiet','Find '+(key==='plan-model'?'planning':'image')+' models');find.append(icon('refresh'));find.setAttribute('aria-label',find.title);
        if(defaultModel){const reset=button(control,'',()=>{change('');render();},'quiet','Use Agent default: '+defaultModel);reset.append(icon('arrow-left'));reset.setAttribute('aria-label',reset.title);}
    }
    function drawModelSettings(body) {
        ST3GGOpenRouterAuth.mount(body, 'nw-button quiet');
        const settings=ST3GGImageAgent.settings(),status=el('span',settings.apiKey?'Key loaded':'No key loaded','nw-key-status');status.id='nw-key-status-'+uid();status.setAttribute('role','status');
        const keyField=field(body,'Agent API key',settings.apiKey,v=>{ST3GGImageAgent.configure({apiKey:v});$('aiagent-api-key').dispatchEvent(new Event('input'));for(const indicator of document.querySelectorAll('.nw-key-status'))indicator.textContent=v.trim()?'Key loaded':'No key loaded';refreshNextAction();},{type:'password',key:'api-key',live:true});
        keyField.parentElement.classList.add('nw-key-field');keyField.parentElement.append(status);keyField.setAttribute('aria-describedby',status.id);
        note(body,'Keys are saved in this browser. Disconnect removes the saved key; revoke it in OpenRouter to disable it everywhere.');
        modelControl(body,'Image model',settings.model,v=>ST3GGImageAgent.configure({model:v}),modelList,async()=>{modelList=await ST3GGImageAgent.models();},'image-model');
        modelControl(body,'Vision / planning model',config.planModel||agentModel(),v=>{config.planModel=v.trim();},planningModels,async()=>{planningModels=await ST3GGImageAgent.models(undefined,'planning');},'plan-model',agentModel());
    }
    function drawLayoutDescription(parent) {
        const list=nodes(), children=list.filter(n=>n.parent===root), deep=list.filter(n=>n.parent&&n.parent!==root);
        const description=list.length===1?'One image with its own ZIP files.':config.shape==='chain'
            ? 'Extract the first image’s ZIP to find the next image. Repeat to reach the innermost image.'
            : `${children.length} images sit in the outer ZIP${deep.length?`; ${deep.length} more ${deep.length===1?'image is':'images are'} nested within those images`:''}.`;
        note(parent,description,'nw-layout-description');
        const listPreview=el('div',null,'nw-layout-preview');listPreview.setAttribute('aria-label','Nesting preview');
        for(const n of list.slice(0,7)){const item=el('span',`${depth(n)?'↳ ':''}${n.name}`);item.style.paddingLeft=Math.min(depth(n),4)*12+'px';listPreview.append(item);}
        if(list.length>7)listPreview.append(el('span',`+ ${list.length-7} more images`));parent.append(listPreview);
    }
    function layout() {
        const list=nodes(),positions=new Map(),slots=new Map(),occupied=new Set(),step=list.length<=3?235:174;
        for(const n of list){
            const parent=n.parent&&slots.get(n.parent.id),first=n.parent?.entries.find(e=>e.child)?.child===n;
            const below=parent&&(n.canvasBelowParent||!first||config.shape==='branches');
            const column=parent?parent.column+(below?0:1):0;let lane=parent?parent.lane+(below?1:0):0;
            while(occupied.has(column+':'+lane))lane++;
            occupied.add(column+':'+lane);slots.set(n.id,{column,lane});positions.set(n.id,{x:24+column*step,y:24+lane*280});
        }
        return {list,positions,width:Math.max(260,...[...positions.values()].map(p=>p.x+196)),height:Math.max(280,...[...positions.values()].map(p=>p.y+292))};
    }
    function drawCanvas(parent) {
        const toolbar=row(parent,'nw-canvas-title');toolbar.append(el('h3','Layers'));badge(toolbar,'Image + ZIP');
        if(nodes().some(n=>!n.image&&n.previewImage))note(toolbar,'Preset preview · images not generated','nw-preview-caption');
        const viewport=el('div',null,'nw-canvas-viewport');viewport.id='nw-canvas';parent.append(viewport);
        const graph=layout(),availableWidth=viewport.clientWidth||760,availableHeight=viewport.clientHeight||550;
        if(autoFit)zoom=Math.min(1,(availableWidth-36)/graph.width,(availableHeight-36)/graph.height);
        const stageWidth=Math.max(graph.width,availableWidth/zoom),stageHeight=Math.max(graph.height,availableHeight/zoom);
        const offsetX=(stageWidth-graph.width)/2,offsetY=(stageHeight-graph.height)/2;
        const positions=new Map([...graph.positions].map(([id,p])=>[id,{x:p.x+offsetX,y:p.y+offsetY}]));
        const stage=el('div',null,'nw-canvas-stage');stage.style.width=stageWidth+'px';stage.style.height=stageHeight+'px';stage.style.transform=`scale(${zoom})`;stage.style.transformOrigin='0 0';
        const sizer=el('div');sizer.style.width=stageWidth*zoom+'px';sizer.style.height=stageHeight*zoom+'px';sizer.append(stage);viewport.append(sizer);
        const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('width',stageWidth);svg.setAttribute('height',stageHeight);svg.classList.add('nw-edges');stage.append(svg);
        const defs=document.createElementNS(ns,'defs'),marker=document.createElementNS(ns,'marker');marker.id='nw-edge-arrow';marker.setAttribute('viewBox','0 0 8 8');marker.setAttribute('refX','7');marker.setAttribute('refY','4');marker.setAttribute('markerWidth','7');marker.setAttribute('markerHeight','7');marker.setAttribute('orient','auto');const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d','M1 1 L7 4 L1 7');arrow.setAttribute('fill','none');arrow.setAttribute('stroke','#d1dae2');marker.append(arrow);defs.append(marker);svg.append(defs);
        const next=nextMissingImage(current()),instructionTargets=new Set(graph.list.flatMap(n=>P.steps(n).filter(s=>s.instructions?.installed).map(s=>s.instructions.installed.layerId)));
        for(const n of graph.list)if(n.parent){const a=positions.get(n.parent.id),b=positions.get(n.id),path=document.createElementNS(ns,'path'),below=a.x===b.x;
            const bottom=instructionTargets.has(n.parent.id)?218:190;
            path.setAttribute('d',below?`M${a.x},${a.y+bottom-14} H${a.x-15} V${b.y+75} H${b.x-5}`:`M${a.x+126},${a.y+88} C${a.x+151},${a.y+88} ${b.x-26},${b.y+88} ${b.x-7},${b.y+88}`);path.setAttribute('class','nw-edge');path.setAttribute('marker-end','url(#nw-edge-arrow)');svg.append(path);if(!below){const label=document.createElementNS(ns,'text');label.setAttribute('x',(a.x+126+b.x)/2);label.setAttribute('y',(a.y+b.y)/2+70);label.setAttribute('text-anchor','middle');label.textContent='contains';svg.append(label);}}
        for(const n of graph.list){
            const p=positions.get(n.id),card=el('div',null,'nw-node'+(n.id===selected?' selected':'')+(next===n&&current().image?' nw-next-layer':''));stage.append(card);card.setAttribute('role','button');card.tabIndex=0;card.setAttribute('aria-label','Select '+n.name);card.onclick=()=>{if(!busy)select(n);};card.onkeydown=e=>{if(e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(!busy)select(n);}};card.dataset.layerId=n.id;card.style.left=p.x+'px';card.style.top=p.y+'px';
            image(card,n.image||n.previewImage,'nw-node-image');card.append(el('strong',n.name));
            const dims=PolySize.dimensions(n.image);card.append(el('small',dims?`${dims.width} × ${dims.height}`:'Image + ZIP'));
            if(n.image)card.append(el('small',PolySize.format(n.image.length)));
            if(n.image)badge(card,n.dirty?'Ready':'Built','good');
            else{const needs=button(card,'Needs image',()=>{selected=n.id;imageDialogLayer=n.id;render();},'nw-needs-image');needs.setAttribute('aria-label','Choose or create image for '+n.name);needs.addEventListener('click',e=>e.stopPropagation());}
            if(instructionTargets.has(n.id))badge(card,'Instructions stored here','instructions');
            if(instructionTargets.has(n.id))card.style.height='218px';
            const add=button(stage,'Nest image',()=>addChild(n),'nw-add-child'+(n.id===selected?' selected':'')),circle=el('span',null,'nw-add-circle');circle.append(icon('plus'));add.prepend(circle);add.style.left=p.x+48+'px';add.style.top=p.y+(instructionTargets.has(n.id)?232:204)+'px';add.title='Add a nested image inside '+n.name;
        }
        for(const source of graph.list)for(const step of P.steps(source))if(step.instructions?.installed){const target=graph.list.find(n=>n.id===step.instructions.installed.layerId);if(target&&target!==source){const a=positions.get(source.id),b=positions.get(target.id),path=document.createElementNS(ns,'path');path.setAttribute('d',`M${a.x+60},${a.y+181} Q${(a.x+b.x)/2},${Math.max(a.y,b.y)+270} ${b.x+60},${b.y+181}`);path.setAttribute('class','nw-instruction-edge');svg.append(path);}}
        const zooms=row(parent,'nw-zoom');button(zooms,'−',()=>{autoFit=false;zoom=Math.max(.05,zoom-.1);render();});badge(zooms,Math.round(zoom*100)+'%');button(zooms,'+',()=>{autoFit=false;zoom+=.1;render();});button(zooms,'Fit',()=>{autoFit=true;canvasScroll={left:0,top:0};render();});
        viewport.addEventListener('scroll',()=>{canvasScroll={left:viewport.scrollLeft,top:viewport.scrollTop};});viewport.scrollLeft=canvasScroll.left;viewport.scrollTop=canvasScroll.top;
        viewport.onpointerdown=e=>{if(e.target.closest('button,[role="button"]'))return;panning={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(e.pointerId);};
        viewport.onpointermove=e=>{if(panning){viewport.scrollLeft=panning.left+panning.x-e.clientX;viewport.scrollTop=panning.top+panning.y-e.clientY;}};viewport.onpointerup=()=>{panning=null;};viewport.onpointercancel=()=>{panning=null;};
    }
    function drawPrompt(parent,node) {
        const section=el('div',null,'nw-prompt-editor');parent.append(section);
        const usesDescription=/\{\{\s*layer.scene\s*\}\}/.test(node.prompt||sequencePrompt(node));
        field(section,usesDescription?'Image prompt':'Image model prompt',usesDescription?resolvedVars(node)['layer.scene']:node.prompt,v=>{if(usesDescription){node.scene=v;runTouched=true;}else updatePrompt(node,v);updatePreview();},{area:true,key:'scene-'+node.id,live:true,placeholder:'Describe the subject, composition and visual style for this image.'});
        if(node.scene!==undefined)button(section,'Use shared image description',()=>{delete node.scene;render();},'quiet');
        disclosure(section,'Usage examples',`prompt-examples-${node.id}`,body=>drawPromptExamples(body,node));
        const preview=el('pre',null,'nw-code nw-prompt-preview');
        function updatePreview(){try{preview.textContent=promptFor(node);preview.classList.remove('bad');}catch(e){preview.textContent=e.message;preview.classList.add('bad');}refreshNextAction();}
        disclosure(section,'Prompt template & variables',`prompt-template-${node.id}`,body=>{
            const textarea=field(body,'Prompt template',node.prompt||sequencePrompt(node),v=>{updatePrompt(node,v);updatePreview();},{area:true,key:'prompt-'+node.id,live:true,placeholder:'Use {{layer.scene}} or your own {{Variables}}.'});
            const tokens=row(body,'nw-variable-tokens');
            for(const key of ['layer.scene','layer.index','layer.count','sequence.brief',...Object.keys(config.variables),...Object.keys(node.variables||{})].filter((k,i,a)=>a.indexOf(k)===i)){
                button(tokens,`{{${key}}}`,()=>{const start=textarea.selectionStart,end=textarea.selectionEnd;textarea.setRangeText(`{{${key}}}`,start,end,'end');updatePrompt(node,textarea.value);render();const input=(document.querySelector(".nw-image-dialog[open]")||document).querySelector(`[data-focus="prompt-${node.id}"]`);input?.focus({preventScroll:true});if(input)input.setSelectionRange(start+key.length+4,start+key.length+4);},'quiet','Insert variable into this prompt');
            }
            body.append(el('h4','Prompt sent to the image model'),preview);updatePreview();
            button(body,'Manage variable values',()=>{imageDialogLayer=null;view='variables';render();},'quiet');
        });
    }
    function drawPromptExamples(parent,node) {
        for(const [title,scene,template]of[
            ['Single image','A botanical illustration of a fern on a charcoal background.','{{layer.scene}}'],
            ['Sequence','Mountain landscape → river valley → oak tree → branch → leaf.','Create image {{layer.index}} of {{layer.count}}. Sequence: {{sequence.brief}}. This image: {{layer.scene}}. Keep a consistent illustration style.'],
            ['Reusable subject','A detailed scientific illustration.','{{layer.scene}} Subject: {{subject}}. Layer {{layer.index}} of {{layer.count}}.']
        ]){const example=el('div',null,'nw-prompt-example');parent.append(example);example.append(el('strong',title));note(example,title==='Sequence'?'Set the shared description to the sequence, then describe this image’s scene.':scene);example.append(el('code',template));button(example,'Use example',()=>{node.scene=title==='Sequence'?'An oak tree beside the river.':scene;if(title==='Sequence')config.brief=scene;if(title==='Reusable subject'&&!Object.hasOwn(config.variables,'subject'))config.variables.subject='Fern';updatePrompt(node,template);expanded.add(`prompt-template-${node.id}`);render();},'quiet');}
    }
    function drawVariables(parent,node) {
        parent.append(el('h3','Prompt & file variables'));
        note(parent,'Write a name such as {{subject}} in an image prompt or text-file template, then set its replacement here. ST3GG inserts that text when generating the image or creating the file.');
        note(parent,'Set a value for all images, or enable “Different value for '+node.name+'” to change only the image you are editing. Changes are saved as you type; generate the image or update linked files to include them in the output.');
        const example=el('div',null,'nw-variable-example');parent.append(example);example.append(el('h4','Try it: one description, different subjects'));
        const template=el('code','Botanical illustration of {{subject}}'),preview=el('p',null,'nw-note');example.append(template);
        let subject=String(resolvedVars(node).subject??'a fern');
        field(example,'Replace {{subject}} with',subject,v=>{subject=v;preview.textContent='Result: Botanical illustration of '+v;},{key:'variable-example-subject',live:true});
        preview.textContent='Result: Botanical illustration of '+subject;example.append(preview);
        button(example,'Add this example to '+node.name+' prompt',()=>{node.variables=node.variables||{};node.variables.subject=subject;if(!Object.hasOwn(config.variables,'subject'))config.variables.subject=subject;const snippet='Botanical illustration of {{subject}}';updatePrompt(node,(node.prompt||'').trim()+((node.prompt||'').trim()?'\n':'')+snippet);render();},'quiet');
        const keys=[...new Set([...Object.keys(config.variables),...Object.keys(node.variables||{}),...[...(node.prompt||'').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map(m=>m[1])])].filter(k=>!k.startsWith('layer.')&&!k.startsWith('sequence.')&&k!=='project.name');
        for(const key of keys){const group=el('div',null,'nw-variable-row');parent.append(group);group.append(el('code','{{'+key+'}}'));
            field(group,'Value for all images',config.variables[key]??'',v=>{config.variables[key]=v;runTouched=true;},{key:'shared-variable-'+key,live:true});
            const own=Object.hasOwn(node.variables||{},key),label=el('label',null,'nw-check'),box=el('input');box.type='checkbox';box.checked=own;box.onchange=()=>{node.variables=node.variables||{};if(box.checked)node.variables[key]=config.variables[key]??'';else delete node.variables[key];runTouched=true;render();};label.append(box,el('span','Different value for '+node.name));group.append(label);
            if(own)field(group,'Value for '+node.name,node.variables[key],v=>{node.variables[key]=v;runTouched=true;},{key:'layer-variable-'+key,live:true});
        }
        button(parent,'Create variable',()=>{const key=prompt('Variable name, e.g. subject');if(!key)return;if(!/^[\w.-]+$/.test(key)||key.startsWith('layer.')||key.startsWith('sequence.')||key==='project.name')throw new Error('Use a name such as subject or visual.style.');if(!Object.hasOwn(config.variables,key))config.variables[key]='';runTouched=true;render();});
    }
    function addChild(parent) {
        let at=1,name;do{name=`nested-${at++}.png`;}while(parent.entries.some(e=>e.name===name));
        const n=C.layer(name);n.parent=parent;n.canvasBelowParent=true;n.prompt=sequencePrompt(n,nodes().length,nodes().length+1);parent.entries.push({name,child:n,kind:'layer'});dirty(parent);selected=n.id;config.count=nodes().length;reviewed=false;generated=false;autoFit=true;view='';imageDialogLayer=n.id;render();
    }
    function drawInspector(parent,node) {
        const listOfLayers=nodes(),at=listOfLayers.indexOf(node),level=node.uiLevel||'Easy';
        const heading=el('div',null,'nw-inspector-heading');parent.append(heading);
        const title=row(heading);title.append(el('h2',node.name));
        const pager=row(title,'nw-layer-pager');
        const previous=button(pager,'',()=>select(listOfLayers[at-1]),'quiet','Previous layer');previous.append(icon('chevron-left'));previous.setAttribute('aria-label','Previous layer');previous.disabled=busy||at===0;
        const next=button(pager,'',()=>select(listOfLayers[at+1]),'quiet','Next layer');next.append(icon('chevron-right'));next.setAttribute('aria-label','Next layer');next.disabled=busy||at===listOfLayers.length-1;
        note(heading,`Layer ${at+1} of ${listOfLayers.length}${node.parent?' · Inside '+node.parent.name:' · Outermost layer'}`);
        const levels=row(parent,'nw-levels');for(const tier of ['Easy','Medium','Expert'])button(levels,tier,()=>{node.uiLevel=tier;render();},level===tier?'active':'');
        const compactImage=['templates','instructions','results','review','size'].includes(view),imageParent=el('div',null,'nw-inspector-image-section');if(view!=='payload')parent.append(imageParent);
        const imageHeading=el('h3','Image');imageHeading.id=`nw-image-${node.id}`;imageParent.append(imageHeading);
        const summary=el('div',null,'nw-image-summary');imageParent.append(summary);const preview=el('div',null,'nw-image-preview'),fields=el('div',null,'nw-image-fields');summary.append(preview,fields);
        image(preview,node.image||node.previewImage,'nw-inspector-image');
        field(fields,'Filename',node.nameDraft||node.name,v=>{node.nameDraft=v;rename(node,v);render();},{key:'filename-'+node.id});
        const sourceNames={local:'Local carrier',upload:'Image file',ai:'AI sequence'};
        field(fields,'Image source',node.imageSource||'',v=>{node.imageSource=v||null;runTouched=true;render();},{choices:[['',`Use run default (${sourceNames[config.source]})`],['local','Create locally'],['upload','Use an image file'],['ai','Generate with AI']]});
        const dims=PolySize.dimensions(node.image);if(dims)note(preview,`${dims.width} × ${dims.height}\n${PolySize.format(node.image.length)}`);
        if(settingsFor(node).source==='ai'&&!compactImage)drawPrompt(fields,node);
        else disclosure(fields,'AI prompt & variables',`prompt-${node.id}`,body=>drawPrompt(body,node));
        if(level!=='Easy'&&!compactImage){
            const dimensions=el('div',null,'nw-layer-resolution');fields.append(dimensions);
            const useDefault=el('label',null,'nw-check'),box=el('input');box.type='checkbox';box.checked=!node.resolution;box.onchange=()=>{node.resolution=box.checked?null:{width:config.width,height:config.height};render();};useDefault.append(box,el('span',`Use run resolution (${config.width} × ${config.height})`));dimensions.append(useDefault);
            if(node.resolution){field(dimensions,'Width (px)',node.resolution.width,v=>{node.resolution.width=validPixels(v);},{type:'number'});field(dimensions,'Height (px)',node.resolution.height,v=>{node.resolution.height=validPixels(v);},{type:'number'});}
        }
        const imageActions=row(imageParent,'nw-image-actions'),action=imageAction(node);
        button(imageActions,settingsFor(node).source==='upload'?(node.image?'Replace image file…':'Choose image file…'):node.image?'Regenerate this image':'Generate this image',action.run,node.image?'':'primary');
        if(settingsFor(node).source!=='upload')button(imageActions,node.image?'Upload replacement':'Choose image file…',()=>uploadImage(node));
        button(imageActions,'Choose from gallery…',()=>{imageDialogLayer=node.id;render();});
        const nextMissing=node.image&&nextMissingImage(node);if(nextMissing)button(imageParent,`Continue to ${nextMissing.name}`,()=>select(nextMissing),'nw-image-continue nw-recommended');
        if(node.image&&level!=='Easy'&&!compactImage)button(imageParent,'Resize to run dimensions',async()=>{if(node.original&&!confirm('Resize this image? Unknown image payloads may be lost. Archive entries are retained.'))return;await api.busy(async signal=>{const bytes=await normalizeImage(node.image,settingsFor(node));C.check(signal);putImage(node,bytes);});},'quiet');
        const techniqueHeader=row(parent,'nw-section-heading');techniqueHeader.id=`nw-payloads-${node.id}`;techniqueHeader.append(el('h3','Payload techniques'));
        const list=P.steps(node), rule=P.rules(list);
        if(!list.length)field(parent,'','none',value=>{if(value!=='none')addPayload(node,value);},{choices:[['none','None'],...Object.entries(PolyWorkspace.methods).filter(([key])=>key!=='none').map(([key,definition])=>[key,definition.title])]});
        if(list.length)badge(techniqueHeader,rule.ok?(rule.ordered?'Ordered · compatible':'Compatible'):'Conflict',rule.ok?'good':'bad');
        if(rule.ordered)note(parent,'Encoding order: pixel steps, then PNG metadata. Step numbering sets the documented decoding order.');
        for(const [i,step]of list.entries()){
            const card=el('div',null,'nw-payload-card'+(activeStep===step.id?' selected':''));parent.append(card);const header=row(card);header.append(icon('grip-vertical'),el('span',String(i+1),'nw-step-number'));button(header,step.method,()=>{activeStep=step.id;view='payload';render();});helpButton(header,step.method);
            if(step.fileName)header.append(el('span',step.fileName,'nw-payload-filename'));else if(step.linkedInstructions)header.append(el('span','Decoding instructions','nw-payload-filename'));
            if(step.status==='Verified')badge(header,'Verified','good');
            const actions=row(card,'nw-payload-actions');button(actions,'Edit',()=>{activeStep=step.id;view='payload';render();});button(actions,'Instructions…',()=>{activeStep=step.id;view='instructions';if(!step.instructions)step.instructions={enabled:false,layerId:node.id,kind:'file',file:'decoding.md',method:'PNGCHUNK',options:{}};render();});
            if(node.uiLevel==='Expert'&&list.length>1){button(actions,'↑',()=>{if(i){[list[i-1],list[i]]=[list[i],list[i-1]];dirty(node,true);render();}});button(actions,'↓',()=>{if(i<list.length-1){[list[i+1],list[i]]=[list[i],list[i+1]];dirty(node,true);render();}});}
            button(actions,'Remove',()=>{if(step.instructions?.installed)removeInstructionArtifact(node,step);if(step.linkedInstructions){for(const owner of nodes())for(const s of P.steps(owner))if(s.instructions?.installed?.stepId===step.id){s.instructions.enabled=false;s.instructions.installed=null;}}node.payloadSteps=list.filter(s=>s!==step);dirty(node,true);activeStep=null;render();},'quiet');
        }
        if(!rule.ok)for(const c of rule.conflicts)note(parent,`${c.a.method} + ${c.b.method}: ${c.reason}`,'bad');
        if(list.length)disclosure(parent,'Add technique',`add-technique-${node.id}`,body=>{
            for(const [method,definition]of Object.entries(PolyWorkspace.methods)){
                if(method==='none')continue;
                const candidate=candidateFor(node,method),check=P.rules([...list,candidate]),r=row(body);
                const label=definition.title+(candidate.options.channels?' · '+candidate.options.channels:'');
                const b=button(r,label,()=>addPayload(node,method));helpButton(r,method);
                if(!check.ok){b.disabled=true;b.title=check.conflicts[0].reason;const reason=el('details',null,'nw-conflict-reason');reason.append(el('summary','Conflict'),el('p',check.conflicts[0].reason,'nw-note'));r.append(reason);}
            }
        });
        if(view==='instructions'){
            const source=list.find(s=>s.id===activeStep),link=source?.instructions;
            if(link){parent.append(el('h3','Decoding instructions'));
                const enabled=el('label',null,'nw-check'),box=el('input');box.type='checkbox';box.checked=link.enabled;box.onchange=()=>{if(!box.checked)removeInstructionArtifact(node,source);link.enabled=box.checked;render();};enabled.append(box,el('span','Include decoding instructions'));parent.append(enabled);
                const destination=nodes().find(n=>n.id===link.layerId);if(destination)note(parent,'Destination: '+destination.name);
            }
        }
        const archiveHeading=el('h3','Archive files (inside this layer)');archiveHeading.id=`nw-archive-${node.id}`;parent.append(archiveHeading);
        const files=el('div',null,'nw-archive-list');parent.append(files);
        for(const entry of node.entries){const r=row(files,'nw-file-row');const b=button(r,'',()=>entry.child?select(entry.child):entry.kind==='folder'?viewFolder(node,entry):editFile(node,entry),'nw-file-name');
            if(entry.child?.image)image(b,entry.child.image,'nw-file-thumbnail');else b.append(icon(entry.child?'archive':entry.kind==='folder'?'folder':'file-text'));b.append(el('span',entry.name));
            if(entry.child)badge(r,'Child layer');else if(entry.template)badge(r,entry.template.override?'Override':'Template linked');
            const menu=el('details',null,'nw-file-menu');const summary=el('summary');summary.append(icon('dots'));summary.setAttribute('aria-label','Actions for '+entry.name);menu.append(summary);r.append(menu);const items=el('div');menu.append(items);
            button(items,'Download',()=>entry.child?build(true,entry.child):entry.bytes?api.download(entry.bytes,entry.name):Promise.reject(new Error('Extraction is unavailable for this preserved entry. Download the containing ZIP.')));
            button(items,'Rename / move',()=>{const next=prompt('Relative path',entry.name);if(next===null)return;C.collision(node.entries,next,entry);entry.name=next;if(entry.child)entry.child.name=next;dirty(node);render();});
            if(!entry.child&&entry.kind!=='folder')button(items,'Replace file…',async()=>{const[f]=await pick();if(f){entry.bytes=await api.bytesOf(f);entry.raw=null;entry.issue='';fileDrafts.delete(entry);if(entry.template)entry.template.override=true;dirty(node);render();}});
            if(entry.template)button(items,'Edit source template',()=>{templateId=entry.template.id;templateTargets=new Set([node.id]);view='templates';render();});
            button(items,'Remove',()=>{if(!confirm(`Remove ${entry.name}${entry.child?' and its nested contents':''}?`))return;if(entry.kind==='folder')node.entries=node.entries.filter(e=>e!==entry&&!e.name.startsWith(entry.name));else node.entries=node.entries.filter(e=>e!==entry);dirty(node);render();});
        }
        if(!node.entries.length){const empty=el('div',null,'nw-empty-archive');empty.append(icon('archive'));note(empty,'No files added yet.');files.append(empty);}
        const actions=row(parent);button(actions,'Add files…',()=>addFiles(node));button(actions,'Add text',()=>editFile(node));button(actions,'Templates…',()=>{templateTargets=new Set([node.id]);view='templates';render();});
        if(level!=='Easy'){button(parent,'Add folder',()=>{const name=prompt('Relative folder path','documents/');if(!name)return;const path=name.replace(/\/?$/,'/');C.collision(node.entries,path);node.entries.push({name:path,kind:'folder',bytes:new Uint8Array()});dirty(node);render();});
            disclosure(parent,'Decode / extract existing payload',`decode-${node.id}`,body=>drawDecode(body,node));
            disclosure(parent,'Layer exports',`exports-${node.id}`,body=>{button(body,'Download selected layer',()=>build(true,node));button(body,'Download selected ZIP',()=>build(false,node,true));});
        }
        if(view==='payload')disclosure(parent,'Image & filename',`payload-image-${node.id}`,host=>host.append(imageParent));
        if(node.parent)button(parent,'Remove layer',()=>{if(!confirm(`Remove ${node.name} and all its nested contents?`))return;const parent=node.parent;parent.entries=parent.entries.filter(e=>e.child!==node);dirty(parent);selected=parent.id;render();},'quiet');
    }
    function viewFolder(node,entry){view='folder';activeFile={nodeId:node.id,entry};render();}
    function drawOptions(parent,step,changed,level='Expert') {
        const values=P.options(step), fields=PolyWorkspace.methods[step.method].fields;
        for(const[key,label,defaults]of fields){if(level==='Easy'&&!['password','keyword'].includes(key))continue;if(level==='Medium'&&key==='steps')continue;field(parent,label,values[key],value=>{const old=step.options[key];step.options[key]=value;try{changed();}catch(e){step.options[key]=old;throw e;}},{choices:Array.isArray(defaults)?defaults:null,type:key==='password'?'password':'text',key:step.id+'-'+key});}
    }
    function capacityText(node,step) {
        const d=PolySize.dimensions(node.image);if(!d)return 'Select a carrier to calculate capacity.';
        const o=P.options(step),pixels=d.width*d.height;
        const bytes=step.method==='LSB'?Math.floor(pixels*o.channels.length*Number(o.bits)/8):step.method==='DCT'?Math.floor(Math.floor(d.width/o.blockSize)*Math.floor(d.height/o.blockSize)/8)-9:step.method==='SPREAD'?Math.floor(pixels/o.spreadFactor/8)-8:null;
        return step.method==='PNGCHUNK'?'PNG metadata adds archive-independent bytes; base64 and chunk headers contribute to file size.':bytes!==null?`Raw capacity estimate: ${PolySize.format(Math.max(0,bytes))} before applicable framing and compression. Payload: ${PolySize.format(P.data(step).length)}.`:`Capacity varies with the carrier and selected settings. Payload: ${PolySize.format(P.data(step).length)}. Build performs exact encoding and verification.`;
    }
    function drawPayload(parent,node) {
        const step=P.steps(node).find(s=>s.id===activeStep);if(!step)return note(parent,'Select a payload technique in the layer inspector.');
        parent.append(el('h3',`${step.method} payload settings`));
        const grid=el('div',null,'nw-payload-editor-grid'),settings=el('div'),payload=el('div');grid.append(settings,payload);parent.append(grid);
        const identity=row(settings,'nw-payload-identity');image(identity,node.image||node.previewImage,'nw-payload-carrier');const label=el('div');label.append(el('strong',step.fileName||`${node.name} payload`));note(label,step.fileName?PolySize.format(step.filePayload.length):'Text or file payload');identity.append(label);
        const options=el('div',null,'nw-payload-options');settings.append(options);
        drawOptions(options,step,()=>{const check=P.rules(P.steps(node));if(!check.ok)throw new Error(check.conflicts[0].reason);dirty(node,true);render();},node.uiLevel||'Easy');
        if(step.linkedInstructions)note(payload,'Linked decoding instructions. Edit their source step to update this payload.');
        field(payload,'Payload data (text)',step.payload||'',v=>{step.payload=v;step.filePayload=null;step.fileName='';dirty(node,true);count.textContent=`${textEncoder.encode(v).length} bytes · UTF-8`;},{area:true,key:'payload-'+step.id,live:true,disabled:!!step.linkedInstructions});
        const count=note(payload,`${P.data(step).length} bytes · UTF-8`,'nw-payload-byte-count');
        const actions=row(settings);if(!step.linkedInstructions)button(actions,'Choose file payload…',async()=>{const[f]=await pick();if(f){step.filePayload=await api.bytesOf(f);step.fileName=f.name;dirty(node,true);render();}});
        button(actions,'Decoding instructions…',()=>{if(!step.instructions)step.instructions={enabled:false,layerId:node.id,kind:'file',file:'decoding.md',method:'PNGCHUNK',options:{}};view='instructions';render();},'quiet');
        disclosure(parent,'Payload capacity','capacity-'+step.id,body=>note(body,capacityText(node,step)));
    }
    function drawDecode(parent,node) {
        if(!node.decodeSettings)node.decodeSettings=P.create('LSB');const step=node.decodeSettings;
        button(parent,'Scan this image for payloads',()=>api.busy(async signal=>{if(!node.image)throw new Error('Choose an image for this layer first.');const result=await smartScan(await api.canvasOf(node.image));if(signal.aborted){for(const item of result)if(item.autoExtracted?.downloadUrl)URL.revokeObjectURL(item.autoExtracted.downloadUrl);}C.check(signal);clearDetection(node);node.detection=result;render();}));
        note(parent,'Scans LSB settings, DCT and chroma. Choose a method below to try other encodings.');
        if(node.detection)drawDetection(parent,node);
        disclosure(parent,'Decode with specific settings',`manual-decode-${node.id}`,body=>{
            field(body,'Technique',step.method,v=>{step.method=v;step.options={};render();},{choices:Object.entries(PolyWorkspace.methods).filter(([k])=>k!=='none').map(([k,v])=>[k,v.title])});
            drawOptions(body,step,()=>{},'Expert');
            button(body,'Decode and download payload',()=>api.busy(async signal=>{C.check(signal);if(!node.image)throw new Error('Choose an image for this layer first.');const bytes=await P.decodeStep(step,node.image);if(!bytes?.length)throw new Error('No payload recovered with these settings.');C.check(signal);api.download(bytes,node.name+'.payload.bin');progress=`Decoded ${bytes.length} bytes from ${node.name}.`; }));
        });
    }
    function scanFindings(results) {
        if(typeof results==='string'){try{results=JSON.parse(results);}catch{return [];}}
        if(!Array.isArray(results))return [];
        const findings=results.map(result=>{
            const channels=(result.headerConfig?.channels?.map(c=>'RGBA'[c]).join('')||String(result.channels||'').replace(/,/g,'')),bits=result.headerConfig?.bits||result.bits;
            const recovered=!!result.autoExtracted?.downloadUrl,header=!!result.hasHeader&&!result.isDCT&&!result.isChroma;
            const label=recovered?'Decoded ST3GG payload':header?'ST3GG header found':result.isDCT?'DCT decoder returned data':result.isChroma?'Chroma decoder returned data':result.hasFileMagic?`Possible ${result.fileFormat||'file'} data`:'Possible text match';
            const preview=String(result.autoExtracted?.text||result.preview||'').slice(0,180);
            const readable=preview&&!/[\ufffd\x00-\x08\x0e-\x1f]/.test(preview);
            return {result,label,channels,bits,recovered,header,preview:readable?preview:'',rank:recovered?5:header?4:result.isDCT||result.isChroma?3:result.hasFileMagic?2:1};
        }).sort((a,b)=>b.rank-a.rank||(b.result.confidence||0)-(a.result.confidence||0));
        const seen=new Set();
        return findings.filter(f=>{const method=f.result.isDCT?'DCT':f.result.isChroma?'CHROMA':'LSB',key=`${method}:${f.channels}:${f.bits}`;if(seen.has(key))return false;seen.add(key);return true;});
    }
    function drawDetection(parent,node) {
        const findings=scanFindings(node.detection),recovered=findings.filter(f=>f.recovered).length;
        const output=el('section',null,'nw-detection');parent.append(output);
        output.append(el('h4',recovered?`${recovered} ${recovered===1?'payload':'payloads'} decoded`:findings.length?'Possible payload matches':'No matches found'));
        if(!recovered)note(output,findings.length?'Use a candidate’s settings to decode and inspect its contents.':'Try a specific technique and its settings below.');
        const draw=(host,f)=>{
            const card=el('article',null,'nw-scan-match');host.append(card);card.append(el('strong',f.label));
            note(card,f.result.isDCT?'DCT':f.result.isChroma?'Chroma':`${f.channels} channels, ${f.bits} ${f.bits===1?'bit':'bits'} per channel`);
            if(f.preview)note(card,f.preview,'nw-scan-preview');
            if(f.recovered){const a=el('a','Download decoded payload','nw-scan-download');a.href=f.result.autoExtracted.downloadUrl;a.download=node.name+'.payload.bin';card.append(a);}
            const method=f.result.isDCT?'DCT':f.result.isChroma?'CHROMA':'LSB';
            if(method!=='LSB'||/^[RGB]+$/.test(f.channels))button(card,'Use these decoding settings',()=>{node.decodeSettings=P.create(method);if(method==='LSB')Object.assign(node.decodeSettings.options,{channels:f.channels,bits:String(f.bits)});expanded.add(`manual-decode-${node.id}`);render();});
            disclosure(card,'Match details',`scan-${node.id}-${f.result.name}-${f.bits}`,body=>{
                note(body,`Scanner result: ${f.result.status}. Heuristic score: ${f.result.confidence??'unavailable'}.`);
                if(f.result.rawData){const raw=f.result.rawData;button(body,'Download candidate bytes',()=>api.download(raw instanceof Uint8Array?raw:Uint8Array.from(Object.values(raw)),`${node.name}.${f.result.name}.candidate.bin`));}
            });
        };
        for(const f of findings.slice(0,3))draw(output,f);
        if(findings.length>3)disclosure(output,`Inspect ${findings.length-3} more candidates`,`more-detection-${node.id}`,body=>{body.classList.add('nw-scan-more');for(const f of findings.slice(3))draw(body,f);});
        if(findings.length)button(output,'Download scan summary',()=>api.download(textEncoder.encode(JSON.stringify(findings.map(f=>({match:f.label,method:f.result.name,channels:f.channels,bits:f.bits,status:f.result.status,score:f.result.confidence,preview:f.preview})),null,2)),node.name+'.scan.json'));
    }
    function drawPlan(parent) {
        parent.append(el('h3','Sequence plan'));
        const table=el('table',null,'nw-plan');const head=el('tr');for(const text of ['Layer','Filename','Image prompt','Resolution','Status'])head.append(el('th',text));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');table.append(body);parent.append(table);
        for(const [i,node]of nodes().entries()){
            const tr=el('tr',null,node.id===selected?'selected':''),number=el('td',String(i+1)),name=el('td');button(name,node.name,()=>select(node));
            const prompt=el('td'),usesScene=/\{\{\s*layer.scene\s*\}\}/.test(node.prompt||sequencePrompt(node));
            const input=field(prompt,'',usesScene?resolvedVars(node)['layer.scene']:node.prompt,v=>{if(usesScene){node.scene=v;runTouched=true;}else updatePrompt(node,v);refreshNextAction();},{key:'plan-prompt-'+node.id,live:true,placeholder:'Describe this image'});input.setAttribute('aria-label','Image prompt for '+node.name);
            const resolution=el('td');field(resolution,'',node.resolution?`${node.resolution.width}x${node.resolution.height}`:'default',v=>{node.resolution=v==='default'?null:{width:Number(v.split('x')[0]),height:Number(v.split('x')[1])};runTouched=true;},{choices:[['default',`${config.width} × ${config.height}`],['512x512','512 × 512'],['1024x1024','1024 × 1024'],['1536x1024','1536 × 1024'],['1024x1536','1024 × 1536'],['2048x2048','2048 × 2048'],...(node.resolution?[[`${node.resolution.width}x${node.resolution.height}`,`${node.resolution.width} × ${node.resolution.height}`]]:[])]});
            const state=el('td');badge(state,node.image?'Ready':'Planned',node.image?'good':'');tr.append(number,name,prompt,resolution,state);body.append(tr);
        }
        const actions=row(parent);if(config.source==='ai'||nodes().some(n=>n.imageSource==='ai'))button(actions,'Plan sequence with vision model',()=>reviewRun(true));
        const missing=nodes().filter(n=>!n.image);if(missing.length)button(actions,'Edit next unfinished layer',()=>select(missing[0]),'quiet');
    }
    function drawFile(parent) {
        const draft=activeFile;if(!draft)return;
        const node=nodes().find(n=>n.id===draft.nodeId);if(!node)return;
        parent.append(el('h3',`${draft.entry?.name||'New text file'} / ${node.name}`));
        if(draft.binary){if(C.format(draft.entry.bytes))image(parent,draft.entry.bytes,'nw-file-preview');note(parent,`${PolySize.format(draft.entry.bytes.length)} · exact file contents retained`);button(parent,'Download file',()=>api.download(draft.entry.bytes,draft.entry.name));return;}
        field(parent,'Archive path',draft.name,v=>{draft.name=v;},{key:'file-name'});
        const textarea=field(parent,'Contents',draft.text,v=>{draft.text=v;},{area:true,key:'file-content',live:true});textarea.classList.add('nw-file-text');
        if(draft.entry?.template)badge(parent,draft.entry.template.override?'File override':'Template linked');
        const actions=row(parent);button(actions,'Save text file',saveFile,'primary');button(actions,'Download text',()=>api.download(textEncoder.encode(draft.text),draft.name));button(actions,'Discard edits',()=>{draft.text=draft.initial;if(draft.creating){newFileDrafts.delete(draft.nodeId);activeFile=null;}view='';render();});
    }
    function drawTemplates(parent,node) {
        const tpl=selectedTemplate(), header=row(parent,'nw-editor-actions-heading');header.append(el('h3','Templates'));
        button(header,'Create template',()=>{const t={id:uid(),name:'New template',filename:'notes-{{layer.index}}.md',content:'# {{title}}\n\n{{notes}}\n'};templates.push(t);templateId=t.id;render();});
        const chooser=field(header,'',tpl.id,v=>{templateId=v;render();},{choices:templates.map(t=>[t.id,t.name])});chooser.setAttribute('aria-label','Choose template to edit');chooser.parentElement.classList.add('nw-template-choice');
        const grid=el('div',null,'nw-template-grid');parent.append(grid);const definition=el('div'),source=el('div'),variables=el('div');grid.append(definition,source,variables);
        field(definition,'Template name',tpl.name,v=>{tpl.name=v;},{key:'template-name'});
        field(definition,'Filename pattern',tpl.filename,v=>{tpl.filename=v;},{key:'template-path'});
        definition.append(el('h4','Apply to layers'));const all=row(definition);button(all,'All',()=>{templateTargets=new Set(nodes().map(n=>n.id));render();});button(all,'Current',()=>{templateTargets=new Set([node.id]);render();});
        for(const n of nodes()){const label=el('label',null,'nw-check'),box=el('input');box.type='checkbox';box.checked=templateTargets.has(n.id);box.onchange=()=>{if(box.checked)templateTargets.add(n.id);else templateTargets.delete(n.id);render();};label.append(box,el('span',n.name));definition.append(label);}
        field(source,'Template content',tpl.content,v=>{tpl.content=v;updatePreview();},{area:true,key:'template-content',live:true});
        variables.append(el('h4','Variables / '+node.name));node.variables=node.variables||{};
        const used=new Set([...tpl.content.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g),...tpl.filename.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map(m=>m[1]));
        for(const key of used){if(key.startsWith('layer.')||key==='project.name'){field(variables,key,String(resolvedVars(node)[key]),()=>{},{disabled:true});continue;}
            field(variables,key,node.variables[key]??config.variables[key]??'',v=>{node.variables[key]=v;updatePreview();},{key:'variable-'+key,live:true});if(Object.hasOwn(node.variables,key))button(variables,'Use project value',()=>{delete node.variables[key];render();},'quiet');}
        const previewSection=el('div',null,'nw-template-preview');variables.append(previewSection);
        const preview=el('pre','', 'nw-code');preview.id='nw-template-preview';previewSection.append(el('h4',`Generated file preview · ${node.name}`),preview);
        function updatePreview(){try{preview.textContent=interpolate(tpl.content,node);}catch(e){preview.textContent=e.message;}}
        updatePreview();
        const actions=row(parent);button(actions,'Save template',()=>saveTemplate(tpl));const targets=nodes().filter(n=>templateTargets.has(n.id));button(actions,`Update ${targets.length} linked ${targets.length===1?'file':'files'}`,()=>applyTemplate(tpl,targets),'primary');
        button(actions,'Refresh existing links',()=>applyTemplate(tpl,nodes(),true));
        note(parent,'Editing a generated file creates a file override. Template updates retain those overrides.');
    }
    function drawInstructions(parent,node) {
        const step=P.steps(node).find(s=>s.id===activeStep);if(!step)return;
        const link=step.instructions||(step.instructions={enabled:false,layerId:node.id,kind:'file',file:'decoding.md',method:'PNGCHUNK',options:{}});
        parent.append(el('h3',`Decoding instructions / ${node.name} / ${step.method}`));
        const grid=el('div',null,'nw-instruction-grid');parent.append(grid);let encodingSettings=null;
        const sources=nodes().flatMap(n=>P.steps(n).filter(s=>!s.linkedInstructions).map(s=>({node:n,step:s})));
        field(grid,'Source',`${node.id}:${step.id}`,value=>{const source=sources.find(s=>`${s.node.id}:${s.step.id}`===value);if(source){selected=source.node.id;activeStep=source.step.id;render();}},{choices:sources.map(s=>[`${s.node.id}:${s.step.id}`,`${s.step.method} in ${s.node.name}`])});
        field(grid,'Destination layer',String(link.layerId),v=>{link.layerId=Number(v);render();},{choices:nodes().map(n=>[String(n.id),n.name+(n===root?' (outer layer)':'')])});
        const destinationType=el('div',null,'nw-field');destinationType.append(el('span','Destination type'));grid.append(destinationType);
        const kinds=row(destinationType,'nw-segmented');kinds.setAttribute('role','group');kinds.setAttribute('aria-label','Destination type');
        for(const[value,label]of[['file','Archive text file'],['payload','Encoded payload']]){const b=button(kinds,label,()=>{link.kind=value;render();},link.kind===value?'active':'');b.setAttribute('aria-pressed',String(link.kind===value));}
        if(link.kind==='file')field(grid,'File path (new or existing)',link.file,v=>{link.file=v;},{key:'instruction-file'});
        else {
            field(grid,'Destination technique',link.method,v=>{link.method=v;link.options={};render();},{choices:Object.entries(PolyWorkspace.methods).filter(([k])=>k!=='none').map(([k,v])=>[k,v.title])});
            const candidate={id:step.id+'-instructions',method:link.method,options:link.options,payload:'',enabled:true};if(link.method==='PNGCHUNK'&&!link.options.keyword)link.options.keyword='Decode_'+step.id.slice(0,8);
            encodingSettings=body=>drawOptions(body,candidate,()=>{link.options=candidate.options;render();},'Expert');
            const target=nodes().find(n=>n.id===link.layerId);if(target){const check=P.rules([...P.steps(target).filter(s=>s.id!==link.installed?.stepId),candidate]);badge(parent,check.ok?'Compatible':'Conflict',check.ok?'good':'bad');if(!check.ok)note(parent,check.conflicts[0].reason,'bad');}
        }
        const preview=el('div',null,'nw-instruction-preview');parent.append(preview);
        field(preview,'Instruction text preview',instructionText(node,step),v=>{link.textOverride=v;},{area:true,key:'instruction-text',live:true});
        button(preview,link.installed?'Update linked instructions':link.kind==='payload'?'Add instruction payload':'Write instruction section',()=>{link.enabled=true;applyInstructions(node,step);},'primary');
        const extra=row(parent);button(extra,'Use generated wording',()=>{delete link.textOverride;render();},'quiet');
        if(encodingSettings)disclosure(parent,'Destination encoding settings','instruction-options-'+step.id,encodingSettings);
    }
    function drawSize(parent) {
        const measured=PolySize.measure(root);parent.append(el('h3',`Size breakdown · ${measured.exact?'':'~'}${PolySize.format(measured.total)}`));
        const list=[{record:measured,parent}];
        while(list.length){const{record,parent:host}=list.shift(),section=el('details',null,'nw-size-layer');section.open=record.node===root;section.append(el('summary',`${record.node.name} · ${PolySize.format(record.total)}`));host.append(section);
            const bar=el('div',null,'nw-size-bar');section.append(bar);for(const part of record.parts){const span=el('span');span.style.flex=String(part.bytes||.0001);span.className='nw-size-'+part.kind;span.title=`${part.name}: ${PolySize.format(part.bytes)}`;bar.append(span);}
            for(const part of record.parts){const r=row(section);r.append(el('span',part.name),el('strong',PolySize.format(part.bytes)));if(part.child)list.push({record:part.child,parent:section});}if(record.pendingEncoding)note(section,'Image payload encoding can change the final carrier size.');}
        note(parent,`Estimated working copies during rebuilding: ${PolySize.format(measured.workingBytes)}. Nested byte contributions are included once in their parent.`);
    }
    function drawCompactSize(parent) {
        const measure=PolySize.measure(root),parts=[['carrier','Carrier images',measure.imageBytes],['file','Archive files',measure.fileBytes],['overhead','ZIP overhead',measure.headers]];
        const bar=button(parent,'',()=>{view='size';render();},'nw-size-bar nw-size-map-action');bar.setAttribute('aria-label','Inspect detailed size map');bar.title='Inspect detailed size map';
        for(const[kind,label,bytes]of parts){const segment=el('span',null,'nw-size-'+kind);segment.style.flex=String(bytes||.0001);segment.title=`${label}: ${PolySize.format(bytes)}`;bar.append(segment);}
        const legend=row(parent,'nw-size-legend');for(const[kind,label,bytes]of parts){const part=el('div');part.append(el('span',null,'nw-size-dot nw-size-'+kind),el('strong',label));note(part,`${PolySize.format(bytes)} (${measure.total?Math.round(bytes/measure.total*100):0}%)`);legend.append(part);}

    }
    function drawResults(parent) {
        const list=nodes(),built=!!root.original&&!root.dirty,validated=list.filter(n=>!n.dirty&&n.validation.includes('image decoded')),payloads=list.flatMap(n=>P.steps(n).filter(s=>s.enabled!==false)),verified=payloads.filter(s=>s.status==='Verified'),opaque=list.some(n=>n.entries.some(e=>e.issue));
        const heading=row(parent,'nw-build-heading');heading.append(el('h3','Build results'));if(built)badge(heading,'Built '+root.name,'good');
        const table=el('div',null,'nw-validation-table');parent.append(table);
        for(const [name,status,good,details]of[
            ['Image decoding',`${validated.length} of ${list.length} layers verified`,validated.length===list.length,list.map(n=>`${n.name}: ${n.validation}`).join('\n')],
            ['ZIP extraction and contents',built?(opaque?'Partial validation':'Passed'):'Requires build',built&&!opaque,'Each rebuilt ZIP is read back and its entries extracted. '+(opaque?'Opaque entries retain their original bytes.':'Extracted contents are byte-compared with the workspace inputs.')],
            ['Payload round-trips',payloads.length?`${verified.length} of ${payloads.length} verified`:'No configured payloads',verified.length===payloads.length,payloads.length?payloads.map(s=>`${s.method}: ${s.status}`).join('\n'):'The output can contain archive files without a separate image payload.'],
            ['File contents',built?(opaque?'Readable files matched; opaque entries preserved':'Matched'):'Requires build',built&&!opaque,'Unchanged ordinary files and nested outputs retain their exact content.']
        ]){const line=el('details',null,'nw-validation-line'),summary=el('summary');summary.append(icon(name==='Image decoding'?'photo':name==='Payload round-trips'?'refresh':'file-text'),el('span',name));badge(summary,status,good?'good':'warn');summary.append(icon('chevron-down'));line.append(summary);note(line,details);table.append(line);}
        disclosure(parent,`Per-layer results (${list.length})`,'result-layers',body=>{
            const strip=el('div',null,'nw-results-layers');body.append(strip);
            for(const node of list){const item=el('div',null,'nw-results-layer');image(item,node.image,'nw-result-thumb');const text=el('div');item.append(text);button(text,node.name,()=>select(node),'quiet');badge(text,node.dirty?'Needs build':node.validation.startsWith('Partial')?'Partial':'Built',node.dirty?'':node.validation.startsWith('Partial')?'warn':'good');strip.append(item);}
        });
        disclosure(parent,`Size breakdown · ${PolySize.format(PolySize.measure(root).total)}`,'result-sizes',drawCompactSize);
        const downloads=el('div',null,'nw-download-actions');parent.append(downloads);
        if(built)button(downloads,'Download '+root.name,()=>api.download(root.original,root.name),'primary');else button(downloads,'Build & download',()=>build(),'primary');
        button(downloads,'Download selected layer',()=>build(true,current()));button(downloads,'Download selected ZIP',()=>build(false,current(),true));
    }
    function drawReview(parent) {
        const selectedNode=current();parent.append(el('h3',`Review ${selectedNode.name}`));
        for(const node of nodes()){
            const item=el('div',null,'nw-review-layer'+(node===selectedNode?' selected':'')),head=row(item),choose=button(head,`${layerNumber(node)}. ${node.name}`,()=>select(node));
            item.dataset.reviewLayer=node.id;if(node===selectedNode)choose.setAttribute('aria-current','step');
            badge(head,node.image?'Image ready':'Needs image',node.image?'good':'');
            const files=node.entries.filter(e=>!e.child&&e.kind!=='folder').length,children=node.entries.filter(e=>e.child).length,payloads=P.steps(node).filter(s=>s.enabled!==false).length;
            note(item,`${files} archive ${files===1?'file':'files'}, ${children} nested ${children===1?'image':'images'}, ${payloads} image ${payloads===1?'payload':'payloads'}`);parent.append(item);
        }
        const actions=row(parent),missing=nodes().find(n=>!n.image&&settingsFor(n).source!=='local');
        if(missing)button(actions,`Prepare layer ${layerNumber(missing)} image`,()=>select(missing),'primary');
        else button(actions,`Build, verify & download ${root.name}`,()=>build(),'primary');
        button(actions,'Inspect file sizes',()=>{view='size';render();});
    }
    function headerAction() {
        const list=nodes(),missing=list.filter(n=>!n.image);
        if(view==='plan'&&missing.length){
            if(missing.some(n=>settingsFor(n).source==='upload'))return {label:'Choose remaining images',run:()=>select(missing.find(n=>settingsFor(n).source==='upload')),detail:'Select an image file for each unfinished layer.'};
            return {label:`${missing.some(n=>settingsFor(n).source==='ai')?'Generate':'Create'} ${missing.length} ${missing.length===1?'image':'images'}`,run:()=>generateLayers(),detail:'Prepare the remaining layer images while preserving existing images.'};
        }
        if(!reviewed&&!list.some(n=>n.image))return {label:'Review run',run:()=>reviewRun(),detail:'Review the layer image descriptions before creating images.'};
        return flowAction(current());
    }
    function drawHeader(frame,node) {
        const header=el('header',null,'nw-header');frame.append(header);
        button(header,'New run',()=>choosePreset(PolyPresets.find(p=>p.id==='chain3')),'quiet','New nested image run');
        const stages=el('details',null,'nw-phase-menu'),phase=el('summary');stages.append(phase);header.append(stages);
        const title=view==='ready-examples'?'Choose a ready-to-build example':view==='review'?'Ready to build':view==='results'?'08 · Download the completed file':view==='instructions'?'07 · Choose where instructions are stored':view==='templates'?'06 · Create a linked file template':view==='payload'?'05 · Configure payload techniques':view==='previews'?'04 · Refine generated images':view==='plan'?'03 · Review the image sequence':presetOpen?'02 · Choose a preset':'01 · Configure a run';
        phase.append(el('span',title),icon('chevron-down'));const stageMenu=el('div',null,'nw-menu-items');stages.append(stageMenu);
        for(const[label,run]of[
            ['Run configuration',()=>{view='';workspaceStage='setup';render();}],
            ['Review image sequence',()=>reviewRun()],
            ['Image previews',()=>{view='previews';render();}],
            ['Payload settings',()=>{activeStep=P.steps(node)[0]?.id;view='payload';render();}],
            ['File templates',()=>{templateTargets=new Set([node.id]);view='templates';render();}],
            ['Review output & download',()=>{view='review';render();}],
            ['Size breakdown',()=>{view='size';render();}]
        ])button(stageMenu,label,run);
        const actions=row(header,'nw-header-actions');button(actions,'Import image + ZIP…',async()=>{const[f]=await pick('image/png,image/jpeg,.zip');if(f)await api.importFile(f);},'quiet');
        const action=headerAction(),primary=button(actions,action.label,()=>headerAction().run(),'primary');primary.id='nw-primary';primary.title=action.detail||'';
    }
    function drawPreviews(parent) {
        parent.append(el('h3',`Image previews (${nodes().length} layers)`));
        const gallery=el('div',null,'nw-preview-gallery');parent.append(gallery);
        for(const node of nodes()){
            const tile=el('article',null,'nw-preview-tile'+(node.id===selected?' selected':''));gallery.append(tile);
            const choose=button(tile,'',()=>select(node),'nw-preview-choose');image(choose,node.image||node.previewImage,'nw-gallery-image');choose.append(el('strong',node.name));
            const dims=PolySize.dimensions(node.image);if(dims)note(tile,`${dims.width} × ${dims.height}\n${PolySize.format(node.image.length)}`);else note(tile,'Image not generated');
            button(tile,node.image?'Regenerate':'Create image',imageAction(node).run);
        }
    }
    function drawHelp(parent) {
        if(!help)return;const guide=PolyTechniqueHelp[help],panel=el('aside',null,'nw-help-panel');panel.setAttribute('aria-label',guide.title+' help');parent.append(panel);
        const header=row(panel);header.append(el('h3',help+' / '+guide.title));button(header,'×',()=>{help=null;render();},'quiet','Close technique help');note(panel,guide.overview);
        for(const[key,title]of[['example','Worked example'],['science','Scientific mechanism'],['implementation','ST3GG implementation'],['settings','Settings & capacity'],['compatibility','Compatibility'],['verification','Automatic verification']])disclosure(panel,title,'help-'+help+'-'+key,body=>note(body,guide[key]));
        const a=el('a','Source / further reading');a.href=guide.source;a.target='_blank';a.rel='noopener';panel.append(a);
    }
    function drawEditor(parent,node) {
        if(!view)return;
        const panel=el('section',null,'nw-editor');parent.append(panel);const top=row(panel,'nw-editor-title');top.append(el('span',['review','results','size'].includes(view)?'Complete output':view==='plan'?'Image sequence':`Selected layer: ${node.name}`));const close=button(top,'×',()=>{view='';render();},'quiet','Close editor');close.setAttribute('aria-label','Close editor');
        if(view==='ready-examples')drawReadyExamples(panel);else if(view==='examples'){panel.append(el('h3','Image prompt examples'));note(panel,'Choose an example for '+node.name+', then edit its description before generating. The preset library also contains complete editable runs.');drawPromptExamples(panel,node);}else if(view==='variables')drawVariables(panel,node);else if(view==='previews')drawPreviews(panel);else if(view==='review')drawReview(panel);else if(view==='plan')drawPlan(panel);else if(view==='payload')drawPayload(panel,node);else if(view==='file')drawFile(panel);else if(view==='templates')drawTemplates(panel,node);else if(view==='instructions')drawInstructions(panel,node);else if(view==='size')drawSize(panel);else if(view==='results')drawResults(panel);else if(view==='folder'){note(panel,activeFile.entry.name);for(const entry of node.entries.filter(e=>e.name.startsWith(activeFile.entry.name)&&e!==activeFile.entry))button(panel,entry.name,()=>entry.child?select(entry.child):editFile(node,entry));}
    }
    function drawImageDialog(frame) {
        const node=nodes().find(n=>n.id===imageDialogLayer);if(!node){imageDialogLayer=null;return;}
        const dialog=el('dialog',null,'nw-image-dialog nw-gallery-dialog');frame.append(dialog);
        dialog.setAttribute('aria-labelledby','nw-image-dialog-title');
        const close=()=>{imageDialogLayer=null;dialog.close();dialog.remove();document.querySelector(`[data-layer-id="${node.id}"]`)?.focus();};
        const heading=row(dialog,'nw-dialog-heading');const title=el('h2',`Image for ${node.name}`);title.id='nw-image-dialog-title';heading.append(title);button(heading,'×',close,'quiet');
        note(dialog,`Layer ${layerNumber(node)} of ${nodes().length}${node.parent?' · Inside '+node.parent.name:' · Outermost image'}`);
        drawImageGallery(dialog,node,close);
        const other=el('details',null,'nw-disclosure');other.open=expanded.has('gallery-create');other.ontoggle=()=>{if(other.isConnected){if(other.open)expanded.add('gallery-create');else expanded.delete('gallery-create');}};other.append(el('summary','Upload or create a new image'));dialog.append(other);const sourcePanel=el('div');other.append(sourcePanel);
        field(sourcePanel,'Image source',settingsFor(node).source,v=>{node.imageSource=v;runTouched=true;render();},{choices:[['ai','Generate with AI'],['local','Create locally'],['upload','Use an image file']]});
        const source=settingsFor(node).source;
        if(source!=='upload'){
            const dimensions=row(sourcePanel);const size=settingsFor(node);
            field(dimensions,'Width (px)',size.width,v=>{node.resolution={...settingsFor(node),width:validPixels(v)};runTouched=true;},{type:'number',key:'dialog-width'});
            field(dimensions,'Height (px)',size.height,v=>{node.resolution={...settingsFor(node),height:validPixels(v)};runTouched=true;},{type:'number',key:'dialog-height'});
        }
        if(source==='ai'){
            drawPrompt(sourcePanel,node);
            disclosure(sourcePanel,'Image model settings','image-dialog-model',drawModelSettings);
        }
        const actions=row(sourcePanel,'nw-dialog-actions');button(actions,'Cancel',close,'quiet');
        const action=imageAction(node);button(actions,action.label,async()=>{imageDialogLayer=null;dialog.close();dialog.remove();await action.run();},'primary');
        dialog.addEventListener('cancel',e=>{e.preventDefault();e.stopPropagation();close();});
        dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}});
        dialog.addEventListener('click',e=>{if(e.target===dialog){const bounds=dialog.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)close();}});
        dialog.showModal();
    }
    function render() {
        if(!api||!root)return;
        if(api.getRoot()!==knownRoot){for(const node of nodes())rememberImage(node);root=api.getRoot();knownRoot=root;selected=root.id;generated=nodes().every(n=>n.image);reviewed=true;}
        const selectedNode=current();selected=selectedNode.id;
        const host=$('poly-flow'),focused=document.activeElement,key=focused?.dataset?.focus,selection=focused&&'selectionStart'in focused?[focused.selectionStart,focused.selectionEnd]:null;
        const pagePosition={left:window.scrollX,top:window.scrollY};
        const panelPositions=['nw-run','nw-inspector','nw-editor'].map(name=>[name,name==='nw-editor'&&host.querySelector('.nw-center')?.dataset.view!==view?0:host.querySelector('.'+name)?.scrollTop||0]);
        for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs=[];
        host.replaceChildren();const frame=el('div',null,'nw-root');frame.id='nw-root';host.append(frame);
        drawHeader(frame,selectedNode);
        if(error){const alert=el('div',null,'nw-error');alert.setAttribute('role','alert');alert.append(el('span',error));const actions=row(alert,'nw-error-actions');if(/API key|Model settings/i.test(error))button(actions,'Open model settings',openModelSettings);button(actions,'Dismiss',()=>{error='';render();});frame.append(alert);}
        const work=el('div',null,'nw-workspace');frame.append(work);const left=el('aside',null,'nw-run'),center=el('main',null,'nw-center'),right=el('aside',null,'nw-inspector');work.append(left,center,right);
        const canvasShell=el('section',null,'nw-canvas-shell');center.append(canvasShell);center.dataset.editor=view?'open':'closed';center.dataset.view=view;
        const controls=[left,center,right];for(const n of controls)n.inert=busy;
        drawRun(left);drawCanvas(canvasShell);drawEditor(center,selectedNode);drawHelp(center);drawInspector(right,selectedNode);
        const measurement=PolySize.measure(root);if(!rootBaseline&&nodes().every(n=>n.image))rootBaseline=measurement.total;const advice=PolySize.advisory(measurement,rootBaseline||measurement.total);if(advice){const notice=el('div',null,'nw-size-notice');note(notice,advice);button(notice,'View contributions',()=>{view='size';render();});center.append(notice);}
        if(progress&&!busy){const status=el('div',progress,'nw-status');status.setAttribute('role','status');frame.append(status);}
        if(busy){const status=el('div',null,'nw-working');status.setAttribute('role','status');status.append(el('span',progress||'Preparing run…'));const cancel=button(status,'Cancel',api.cancel);cancel.disabled=false;frame.append(status);}
        if(imageDialogLayer)drawImageDialog(frame);
        if(key){const next=(host.querySelector(".nw-image-dialog[open]")||host).querySelector(`[data-focus="${CSS.escape(key)}"]`);if(next){next.focus({preventScroll:true});if(selection&&next.type!=='number'&&next.tagName!=='SELECT')try{next.setSelectionRange(...selection);}catch{}}}
        for(const [name,top]of panelPositions){const panel=host.querySelector('.'+name);if(panel)panel.scrollTop=top;}
        window.scrollTo({...pagePosition,behavior:'instant'});
    }
    document.addEventListener('st3gg-openrouter-key-change',()=>refreshNextAction());
    window.PolyFlow={
        init(bridge){api=bridge;root=api.getRoot();knownRoot=root;selected=root.id;if(!root.image&&!root.entries.length)choosePreset(PolyPresets.find(p=>p.id==='chain3'),true);document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(help){help=null;render();}else if(view){view='';render();}}});document.addEventListener('click',e=>{for(const menu of document.querySelectorAll('.nw-file-menu[open],.nw-phase-menu[open]'))if(!menu.contains(e.target))menu.open=false;});window.addEventListener('resize',()=>{autoFit=true;render();});document.querySelector('.tabs [data-tab="polyglot"]')?.addEventListener('click',()=>requestAnimationFrame(()=>{autoFit=true;render();}));if(location.hash==='#polyglot'){document.querySelector('.tabs [data-tab="polyglot"]')?.click();requestAnimationFrame(()=>render());}},
        render,error(message){error=message;render();},status(message){progress=message;if(busy||message)render();},setBusy(value){busy=value;if(value){error='';progress='';}render();},
        projectLoaded(){if(!api)return;for(const node of nodes())rememberImage(node);root=api.getRoot();knownRoot=root;for(const node of nodes())rememberImage(node);selected=root.id;generated=nodes().every(n=>n.image);reviewed=true;activePreset='';view='plan';activeFile=null;activeStep=null;lastOutput=null;config.count=nodes().length;config.source='upload';runTouched=true;render();},
        showTools(node){selected=node.id;node.uiLevel='Expert';activeStep=P.steps(node)[0]?.id;view='payload';render();}
    };
})();
