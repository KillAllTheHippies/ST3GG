/* Integrates the existing ST3GG encoders without using their shared tab state. */
(function () {
    'use strict';
    const C = PolyCore, encoder = new TextEncoder();
    const methods = {
        none: { title: 'Preserve image bytes / no new payload', fields: [] },
        LSB: { title: 'LSB · PNG', fields: [['channels', 'Channels', ['RGB','R','G','B','RG','RB','GB']], ['bits', 'Bits per channel', [1,2,3,4,5,6,7,8]]] },
        SPECTER: { title: 'SPECTER · PNG', fields: [['steps', 'Channel steps (JSON)', '[{"channels":[0],"bits":1},{"channels":[1,2],"bits":1}]'], ['password', 'Password', ''], ['density', 'Density %', [100,75,50,25]], ['encryption', 'Encryption', ['none','xor','ghost']]] },
        DCT: { title: 'DCT · PNG', fields: [['robustness', 'Robustness', ['medium','high','low']], ['blockSize', 'Block size', [8,16]]] },
        F5: { title: 'F5 · JPEG', fields: [['password', 'Password', ''], ['quality', 'JPEG quality', [0.95,0.9,0.85,1]]] },
        PVD: { title: 'PVD · PNG', fields: [['direction', 'Direction', ['horizontal','vertical','both']], ['rangeType', 'Range table', ['wu-tsai','wide','narrow']]] },
        SPREAD: { title: 'Spread spectrum · PNG', fields: [['password', 'Password', ''], ['spreadFactor', 'Spread factor', [16,32,64,8]], ['strength', 'Strength', [2,4,8,16]]] },
        PALETTE: { title: 'Palette · PNG (index mode)', fields: [['numColors', 'Colors', [256,128,64,32]], ['mode', 'Mode', ['index']]] },
        CHROMA: { title: 'Chroma · PNG (YCbCr)', fields: [['colorSpace', 'Color space', ['ycbcr']], ['channel', 'Channel', ['both','cb','cr']], ['intensity', 'Intensity', [2,1,3,5]], ['pattern', 'Pattern', ['sequential','checkerboard','edges']]] },
        PNGCHUNK: { title: 'PNG chunk · PNG', fields: [['chunkType', 'Chunk type', ['tEXt','iTXt','zTXt']], ['keyword', 'Keyword', 'Comment']] }
    };
    let root = C.layer(), selected = { node: root }, controller = null, previewURL = null;
    let layerView = 'image', demo = null;
    const expanded = new Set(), drafts = new WeakMap(), inspectionSettings = new WeakMap();
    const $ = id => document.getElementById(id);
    function el(tag, text, className) {
        const node = document.createElement(tag);
        if (text != null) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function button(text, fn, parent, id) {
        const b = el('button', text, 'btn btn-sm btn-secondary'); b.type = 'button';
        if (id) b.id = id;
        b.onclick = () => Promise.resolve().then(fn).catch(error => { window.PolyFlow?.error(error.message); status(error.message); });
        parent.append(b); return b;
    }
    function status(message) { $('poly-status').textContent = message; window.PolyFlow?.status(message); }
    function field(parent, label, value, change, choices, type = 'text') {
        const wrap = el('label', label), input = el(choices ? 'select' : type === 'textarea' ? 'textarea' : 'input');
        if (choices) for (const choice of choices) {
            const option = el('option', Array.isArray(choice) ? choice[1] : String(choice));
            option.value = Array.isArray(choice) ? choice[0] : choice; input.append(option);
        } else if (type !== 'textarea') input.type = type;
        input.value = value;
        input.addEventListener(choices ? 'change' : 'input', () => change(input.value));
        wrap.append(input); parent.append(wrap); return input;
    }
    function download(bytes, name) {
        const url = URL.createObjectURL(new Blob([bytes])), a = el('a');
        a.href = url; a.download = name.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    async function pick(accept = '', multiple = false) {
        return new Promise(resolve => {
            const input = el('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple;
            input.onchange = () => resolve([...input.files]); input.oncancel = () => resolve([]); input.click();
        });
    }
    async function bytesOf(file) {
        return new Uint8Array(await file.arrayBuffer());
    }
    async function canvasOf(bytes) {
        if (!C.format(bytes)) throw new Error('This workspace supports PNG and JPEG carriers.');
        const url = URL.createObjectURL(new Blob([bytes]));
        try {
            const img = new Image(); img.src = url; await img.decode();
            const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0); return canvas;
        } finally { URL.revokeObjectURL(url); }
    }
    async function canvasBytes(canvas, mime = 'image/png', quality = 0.95) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
        if (!blob) throw new Error('Browser could not encode the carrier.');
        return new Uint8Array(await blob.arrayBuffer());
    }
    function options(node) {
        const method = methods[node.settings.method], out = {};
        for (const [key, , def] of method.fields) out[key] = node.settings.options[key] ?? (Array.isArray(def) ? def[0] : def);
        return out;
    }
    function steps(value) {
        const list = JSON.parse(value);
        if (!Array.isArray(list) || !list.length || list.some(s => !Array.isArray(s.channels) || !s.channels.length ||
            s.channels.some(c => !Number.isInteger(c) || c < 0 || c > 2) || !Number.isInteger(s.bits) || s.bits < 1 || s.bits > 8))
            throw new Error('SPECTER steps require RGB channel numbers 0–2 and bits 1–8.');
        return list;
    }
    function capacity(node, width, height) {
        const o = options(node), pixels = width * height, method = node.settings.method;
        let bytes, note = 'Estimated payload capacity';
        if (method === 'none') return 'Image bytes preserved.';
        if (method === 'PNGCHUNK') return 'Chunk payload adds metadata bytes rather than consuming pixel capacity; base64 encoding adds overhead.';
        if (method === 'LSB') {
            bytes = Math.floor(pixels * o.channels.length * +o.bits / 8);
            note = 'Raw LSB capacity including header and compressed payload';
        } else if (method === 'DCT') bytes = Math.floor(Math.floor(width / +o.blockSize) * Math.floor(height / +o.blockSize) / 8) - 8;
        else if (method === 'SPREAD') bytes = Math.floor(pixels / +o.spreadFactor / 8) - 8;
        else if (method === 'PALETTE') bytes = Math.floor((pixels - +o.numColors) / 8) - 8;
        else if (method === 'F5') bytes = Math.floor(Math.floor(pixels / 64) * 63 * .3 / 8) - 8;
        else if (method === 'PVD') bytes = Math.floor(pixels / 2 * 4 * 3 / 8) - 4;
        else if (method === 'CHROMA') bytes = Math.floor(pixels * (o.channel === 'both' ? 2 : 1) * (o.pattern === 'checkerboard' ? .5 : 1) / 8) - 8;
        else if (method === 'SPECTER') {
            try {
                const s = steps(o.steps), average = s.reduce((n, step) => n + step.channels.length * step.bits, 0) / s.length;
                bytes = Math.floor(pixels / Math.max(1, Math.floor(100 / +o.density)) * average / 8) - 12;
                if (o.encryption === 'ghost') return 'Ghost mode adds encryption and noise overhead; capacity is checked during encoding.';
            } catch { return 'Enter valid SPECTER channel steps to estimate capacity.'; }
        }
        const payload = node.settings.filePayload?.length ?? encoder.encode(node.settings.payload).length;
        return `${note}: ${Math.max(0, bytes).toLocaleString()} bytes · supplied payload: ${payload.toLocaleString()} bytes. Content-dependent limits and round-trip decoding are checked at build time.`;
    }
    async function decodePayload(node, bytes, canvas) {
        const o = options(node);
        switch (node.settings.method) {
            case 'LSB': return decode(canvas, o.channels, +o.bits);
            case 'SPECTER': return channelCipherDecode(canvas, steps(o.steps), o.password);
            case 'DCT': return dctDecode(canvas, +o.blockSize);
            case 'F5': return f5ForCanvas(o.password, canvas).extract(bytes);
            case 'PVD': return pvdDecode(canvas, o.direction, o.rangeType);
            case 'SPREAD': return spreadDecode(canvas, o.password, +o.spreadFactor);
            case 'PALETTE': return paletteDecode(canvas, o.mode);
            case 'CHROMA': return chromaDecode(canvas, o.colorSpace, o.channel, +o.intensity, o.pattern);
            case 'PNGCHUNK': return pngChunkDecode(bytes, o.chunkType, o.keyword);
            default: throw new Error('Choose a method and its settings for decoding.');
        }
    }
    function f5ForCanvas(password, canvas) {
        // Preserve the library's existing random-stream prefix while expanding its
        // allocation for larger carriers instead of inheriting a fixed pixel ceiling.
        const paddedPixels = Math.ceil(canvas.width / 8) * 8 * Math.ceil(canvas.height / 8) * 8;
        return new f5stego(encoder.encode(password), Math.max(4096 * 4096, paddedPixels * 3));
    }
    const adapter = {
        validateImage: canvasOf,
        async encode(node, signal) {
            C.check(signal);
            if (node.settings.method === 'none') return { bytes: node.image, status: 'No new image payload; image bytes preserved.' };
            const canvas = await canvasOf(node.image), o = options(node);
            const data = node.settings.filePayload ?? encoder.encode(node.settings.payload);
            if (!data.length) throw new Error('Supply a text or file payload.');
            let bytes;
            switch (node.settings.method) {
                case 'LSB': await encode(canvas, data, o.channels, +o.bits); break;
                case 'SPECTER':
                    if (o.encryption !== 'none' && !o.password) throw new Error('Supply an encryption password.');
                    await channelCipherEncode(canvas, data, steps(o.steps), { key: o.password, encrypt: o.encryption === 'xor', ghost: o.encryption === 'ghost', density: +o.density, balance: false }); break;
                case 'DCT': await dctEncode(canvas, data, o.robustness, +o.blockSize); break;
                case 'F5':
                    if (!o.password) throw new Error('F5 requires a password.');
                    bytes = f5ForCanvas(o.password, canvas).embed(await canvasBytes(canvas, 'image/jpeg', +o.quality), data); break;
                case 'PVD': await pvdEncode(canvas, data, o.direction, o.rangeType); break;
                case 'SPREAD': await spreadEncode(canvas, data, o.password, +o.spreadFactor, +o.strength); break;
                case 'PALETTE': await paletteEncode(canvas, data, +o.numColors, o.mode); break;
                case 'CHROMA': await chromaEncode(canvas, data, o.colorSpace, o.channel, +o.intensity, o.pattern); break;
                case 'PNGCHUNK': bytes = await pngChunkEncode(canvas, data, o.chunkType, o.keyword); break;
            }
            bytes = bytes || await canvasBytes(canvas);
            C.check(signal); await C.tick();
            const recovered = await decodePayload(node, bytes, await canvasOf(bytes));
            if (!recovered || !C.equal(data, recovered)) throw new Error('Image payload round-trip failed. Try different method settings or a larger carrier. No build was committed.');
            return { bytes, status: `${node.settings.method} payload decoded and byte-verified (${data.length} bytes).` };
        }
    };
    async function busy(fn) {
        if (controller) return;
        controller = new AbortController(); $('poly-controls').disabled = true; $('poly-cancel').disabled = false; $('poly-cancel').hidden = false;
        window.PolyFlow?.setBusy(true);
        try { return await fn(controller.signal); }
        catch (error) { status(error.message); window.PolyFlow?.error(error.message); }
        finally { controller = null; $('poly-controls').disabled = false; $('poly-cancel').disabled = true; $('poly-cancel').hidden = true; window.PolyFlow?.setBusy(false); render(); }
    }
    function owner() { return selected.node; }
    function location() { return selected.folder || (selected.entry?.kind === 'folder' ? selected.entry.name : ''); }
    function askPath(label, initial) {
        const value = prompt(label, initial);
        return value === null ? null : C.path(value);
    }
    function addEntry(node, entry) {
        if (entry.kind !== 'folder' && entry.name.endsWith('/')) throw new Error('A file path must not end with /. Use Add folder for folders.');
        C.collision(node.entries, entry.name); node.entries.push(entry); C.dirty(node); selected = { node, entry }; render();
    }
    async function addFiles() {
        const node = owner(), prefix = location(), files = await pick('', true);
        for (const file of files) addEntry(node, { name: prefix + file.name, bytes: await bytesOf(file), kind: 'file' });
    }
    async function addChild() {
        const node = owner(), name = askPath('Nested image path', location() + 'nested.png');
        if (!name) return;
        C.collision(node.entries, name);
        const child = C.layer(name); child.parent = node;
        node.entries.push({ name, child, kind: 'layer' }); C.dirty(node); selected = { node: child }; layerView = 'image'; render();
    }
    function addText() {
        const node = owner(), name = askPath('Text file path', location() + 'AGENTS.md');
        if (name) addEntry(node, { name, bytes: new Uint8Array(), kind: 'file' });
    }
    function addFolder() {
        const name = askPath('Folder path', location() + 'documents/');
        if (name) addEntry(owner(), { name: name.replace(/\/?$/, '/'), bytes: new Uint8Array(), kind: 'folder' });
    }
    function rename() {
        const { node, entry, folder } = selected;
        if (folder || entry?.kind === 'folder') {
            const old = folder || entry.name, next = askPath('New folder path', old);
            if (!next) return;
            const prefix = next.replace(/\/?$/, '/');
            const replacements = node.entries.map(e => ({ entry: e, name: e.name.startsWith(old) ? prefix + e.name.slice(old.length) : e.name }));
            const seen = [];
            for (const r of replacements) { C.collision(seen, r.name); seen.push({ name: r.name }); }
            for (const r of replacements) { r.entry.name = r.name; if (r.entry.child) r.entry.child.name = r.name; }
            selected = { node, folder: prefix }; C.dirty(node);
        } else {
            const target = entry || node, next = askPath('New filename or relative path', target.name);
            if (!next || next.endsWith('/')) return;
            const parent = entry ? node : node.parent;
            const parentEntry = entry || parent?.entries.find(e => e.child === node);
            if (parent) C.collision(parent.entries, next, parentEntry);
            target.name = next; if (parentEntry) parentEntry.name = next;
            C.dirty(parent || node);
        }
        render();
    }
    function remove() {
        const { node, entry, folder } = selected;
        if (!entry && !folder && !node.parent) throw new Error('Use New workspace to replace the outer layer.');
        const parent = entry || folder ? node : node.parent;
        const prefix = folder || (entry?.kind === 'folder' ? entry.name : null);
        const entries = prefix ? parent.entries.filter(e => e.name.startsWith(prefix)) : [entry || parent.entries.find(e => e.child === node)];
        if (!confirm(`Remove ${prefix || entries[0].name}, including all its nested contents? This cannot be undone.`)) return;
        parent.entries = parent.entries.filter(e => !entries.includes(e));
        C.dirty(parent); selected = { node: parent }; render();
    }
    function draftsPending(node) {
        const stack = [node];
        while (stack.length) {
            const n = stack.pop();
            for (const e of n.entries) { if (drafts.get(e)?.changed) return true; if (e.child) stack.push(e.child); }
        }
        return false;
    }
    async function buildDownload(node, zipOnly = false, downloadOutput = true) {
        if (draftsPending(node)) throw new Error('Save or discard pending text edits before building this subtree.');
        await busy(async signal => {
            const bytes = await C.build(node, adapter, signal, status);
            if (zipOnly) {
                const read = await C.readZip(bytes, signal);
                download(await C.writeZip(read.entries, new Uint8Array(), signal, read.commentBytes), node.name.replace(/\.[^.]+$/, '') + '.zip');
            } else if (downloadOutput) download(bytes, node.name);
            status(`${node.name}\n${node.validation}`);
            if (node === root && demo) {
                demo.done.add('build');
                demo.report = [];
                if (demo.verify) {
                    try { demo.report = await demo.verify(root); demo.compared = true; }
                    catch (error) { demo.compared = false; demo.done.delete('build'); demo.report = [error.message]; }
                }
            }
        });
    }
    function projectHasContent() { return !!(root.image || root.entries.length); }
    function loadDemo(id) {
        if (projectHasContent() && !confirm('Replace the current workspace with this demo project? Download any work you want to keep first.')) return;
        return busy(async signal => {
            const fixture = await PolyDemos.create(id, { core: C, adapter, canvasBytes, canvasOf, decodePayload }, signal, status);
            root = fixture.root; demo = { ...fixture, done: new Set(), report: [], compared: false };
            selected = { node: root }; layerView = 'image'; expanded.clear();
            window.PolyFlow?.projectLoaded();
            $('poly-demo-picker').open = false;
            status(`Loaded ${fixture.title}. Use the demo flow to inspect, edit and build this project. All contents are local demo data.`);
            return fixture;
        }).then(fixture => {
            if (fixture && $('poly-advanced').open) $('poly-demo-guide').scrollIntoView({ behavior: 'instant', block: 'start' });
        });
    }
    function demoSaved(node, entry) {
        if (!demo) return;
        for (const task of demo.tasks) {
            if (task.kind !== 'edit' || task.entry !== entry.name) continue;
            try { if (PolyDemos.find(root, task.route) === node) demo.done.add(task.id); } catch { /* Target may have been moved. */ }
        }
        demo.done.delete('build'); demo.report = []; demo.compared = false;
    }
    async function demoTask(task) {
        if (!demo) return;
        if (task.kind === 'build') return buildDownload(root, false, false);
        const node = PolyDemos.find(root, task.route || []);
        if (task.kind === 'decode') inspectionSettings.delete(node);
        const entry = task.entry ? node.entries.find(e => e.name === task.entry) : null;
        if (task.entry && !entry) throw new Error('This demo file was renamed or removed. Load the demo again to reset it.');
        selected = entry ? { node, entry } : { node }; layerView = task.view || 'image';
        for (let current = node; current; current = current.parent) expanded.delete(`closed:${current.id}`);
        if (task.kind === 'inspect') demo.done.add(task.id);
        render();
        $('poly-detail').scrollIntoView({ behavior: 'instant', block: 'nearest' });
        if (task.kind === 'edit') $('poly-detail').querySelector('textarea')?.focus({ preventScroll: true });
        else $('poly-detail').querySelector('h3')?.focus({ preventScroll: true });
    }
    function renderDemos() {
        const catalog = $('poly-demo-catalog');
        if (!catalog.childElementCount) for (const item of PolyDemos.catalog) {
            const row = el('div', null, 'poly-demo-row'), description = el('div');
            description.append(el('h3', item.title), el('p', item.description), el('p', item.scope, 'poly-note'));
            row.append(description);
            button('Load demo', () => loadDemo(item.id), row, `poly-demo-${item.id}`).setAttribute('aria-label', `Load ${item.title} demo`);
            catalog.append(row);
        }
        const guide = $('poly-demo-guide'); guide.replaceChildren(); guide.hidden = !demo;
        if (!demo) return;
        const heading = el('div', null, 'poly-demo-heading'), copy = el('div');
        copy.append(el('h3', demo.title), el('p', demo.note, 'poly-note')); heading.append(copy);
        button('Close guide', () => { demo = null; render(); }, heading); guide.append(heading);
        const tasks = el('ol', null, 'poly-demo-tasks');
        for (const [index, task] of demo.tasks.entries()) {
            const done = demo.done.has(task.id) && (task.kind !== 'build' || !root.dirty);
            const li = el('li'); li.dataset.complete = String(done);
            const number = el('span', String(index + 1), 'poly-task-number'); number.setAttribute('aria-hidden', 'true'); li.append(number);
            const control = button(task.title, () => demoTask(task), li, `poly-task-${task.id}`);
            control.setAttribute('aria-label', `${index + 1}. ${task.title}${done ? ' (complete)' : ''}`);
            li.append(el('span', done ? 'Complete' : task.kind === 'edit' ? 'Save a change to complete' : task.kind === 'decode' ? 'Decode to complete' : '', 'poly-note'));
            tasks.append(li);
        }
        guide.append(tasks);
        if (demo.report.length) {
            const report = el('div', null, `poly-demo-report${demo.compared ? '' : ' poly-warning'}`);
            report.setAttribute('role', 'status'); report.append(el('strong', demo.compared ? 'Preservation checks passed' : 'Demo comparison needs attention'));
            const list = el('ul'); for (const message of demo.report) list.append(el('li', message)); report.append(list); guide.append(report);
        }
        const exports = el('div', null, 'poly-toolbar');
        if (root.original && !root.dirty) button('Download built demo', () => download(root.original, root.name), exports);
        if (demo.tasks.some(task => task.kind === 'build') && demo.done.has('build')) {
            exports.append(el('p', 'The same editing controls remain available after the flow. Load another project to reset the sample.', 'poly-note'));
        }
        guide.append(exports);
    }
    function tree() {
        const host = $('poly-tree'); host.replaceChildren();
        const list = el('ul'); host.append(list);
        const jobs = [{ node: root, list }];
        while (jobs.length) {
            const { node, list: target } = jobs.pop();
            const li = el('li'), details = el('details'), summary = el('summary'), b = el('button', `◈ ${node.name.split('/').pop()}${node.dirty ? ' *' : ''}`);
            details.open = !expanded.has(`closed:${node.id}`);
            details.ontoggle = () => details.open ? expanded.delete(`closed:${node.id}`) : expanded.add(`closed:${node.id}`);
            b.type = 'button'; b.setAttribute('aria-current', String(selected.node === node && !selected.entry && !selected.folder));
            b.onclick = event => { event.preventDefault(); selected = { node }; render(); };
            summary.append(b); details.append(summary); li.append(details); target.append(li);
            const children = el('ul'); details.append(children);
            const folders = new Map([['', children]]);
            function folderList(path) {
                let prefix = '', parent = children;
                for (const part of path.split('/').filter(Boolean)) {
                    prefix += part + '/';
                    if (!folders.has(prefix)) {
                        const item = el('li'), d = el('details'), s = el('summary'), label = el('button', `▤ ${part}`);
                        const key = `${node.id}:${prefix}`, folderPath = prefix;
                        d.open = !expanded.has(key);
                        d.ontoggle = () => d.open ? expanded.delete(key) : expanded.add(key);
                        label.type = 'button'; label.setAttribute('aria-current', String(selected.node === node && selected.folder === folderPath));
                        label.onclick = event => { event.preventDefault(); selected = { node, folder: folderPath }; render(); };
                        s.append(label); d.append(s); const ul = el('ul'); d.append(ul); item.append(d); parent.append(item); folders.set(prefix, ul);
                    }
                    parent = folders.get(prefix);
                }
                return parent;
            }
            for (const entry of node.entries) {
                if (entry.kind === 'folder') { folderList(entry.name); continue; }
                const path = entry.name.includes('/') ? entry.name.slice(0, entry.name.lastIndexOf('/') + 1) : '';
                const parent = folderList(path);
                if (entry.child) { jobs.push({ node: entry.child, list: parent }); continue; }
                const item = el('li'), label = el('button', `${C.format(entry.bytes || []) ? '▧' : '·'} ${entry.name.split('/').pop()}${drafts.get(entry)?.changed ? ' (draft)' : ''}`);
                label.type = 'button'; label.setAttribute('aria-current', String(selected.entry === entry));
                label.onclick = () => { selected = { node, entry }; render(); }; item.append(label); parent.append(item);
            }
        }
    }
    function textDraft(entry) {
        if (drafts.has(entry)) return drafts.get(entry);
        if (!entry.bytes) return null;
        try {
            const original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.bytes);
            if (/[\x00-\x08\x0e-\x1f]/.test(original)) return null;
            const bom = original.startsWith('\ufeff'), text = original.slice(bom ? 1 : 0);
            const draft = { text: text.replace(/\r\n?/g, '\n'), initial: text.replace(/\r\n?/g, '\n'), bom, eol: text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n', changed: false };
            drafts.set(entry, draft); return draft;
        } catch { return null; }
    }
    function fileDetail(host, node, entry) {
        host.append(el('h3', entry.name), el('p', `${entry.bytes?.length ?? entry.raw?.size ?? 0} bytes`, 'poly-note'));
        if (entry.issue) host.append(el('p', entry.issue, 'poly-note poly-warning'));
        const actions = el('div', null, 'poly-toolbar'); host.append(actions);
        button('Download file', () => {
            if (!entry.bytes) throw new Error('This entry cannot be extracted. Download its containing layer to retain the original compressed bytes.');
            download(entry.bytes, entry.name);
        }, actions);
        button('Replace file', async () => {
            const [file] = await pick(); if (!file) return;
            if (!confirm(`Replace all contents of ${entry.name}?`)) return;
            entry.bytes = await bytesOf(file); entry.raw = null; entry.issue = ''; drafts.delete(entry); C.dirty(node); render();
        }, actions);
        const draft = textDraft(entry);
        if (!draft) { host.append(el('p', 'Binary or non-UTF-8 file: contents retained exactly. Use download or replace to manage it.', 'poly-note')); return; }
        host.append(el('p', 'UTF-8 editor. Opening does not change bytes. Save retains the original BOM and newline style; mixed line endings normalize to CRLF if present, otherwise CR or LF, only when you save an edit. Instruction files are inert archive contents.', 'poly-note'));
        const input = field(host, 'File contents', draft.text, value => { draft.text = value; draft.changed = value !== draft.initial; updateProjectActions(); }, null, 'textarea');
        input.className = 'poly-editor'; input.spellcheck = false;
        const controls = el('div', null, 'poly-toolbar'); host.append(controls);
        button('Save text changes', () => {
            if (draft.changed) {
                entry.bytes = encoder.encode((draft.bom ? '\ufeff' : '') + draft.text.replace(/\n/g, draft.eol));
                entry.raw = null; entry.issue = ''; draft.initial = draft.text; draft.changed = false; C.dirty(node); demoSaved(node, entry);
            }
            status(`Saved ${entry.name}`); render();
        }, controls);
        button('Discard text edits', () => { drafts.delete(entry); render(); }, controls);
    }
    async function carrier(node, generated) {
        if (node.image && !confirm('Replacing this carrier may destroy an unknown image payload. Archive entries will be retained. Continue?')) return;
        let bytes;
        if (generated) {
            const size = Number(prompt('Carrier width and height in pixels', '512'));
            if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Choose a positive whole-pixel dimension.');
            const type = prompt('Carrier type: noise, black, white', 'noise'); if (type === null) return;
            if (!['noise','black','white'].includes(type)) throw new Error('Choose noise, black or white.');
            let canvas;
            if (type === 'noise') canvas = generateNoiseCarrier(size, size);
            else {
                canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
                const ctx = canvas.getContext('2d'); ctx.fillStyle = type; ctx.fillRect(0, 0, size, size);
            }
            bytes = await canvasBytes(canvas);
        } else {
            const [file] = await pick('image/png,image/jpeg'); if (!file) return;
            bytes = await bytesOf(file); await canvasOf(bytes);
            try { bytes = (await C.readZip(bytes)).image; } catch { /* Plain image is valid. */ }
        }
        node.image = bytes; node.imageDirty = node.settings.method !== 'none'; C.dirty(node); render();
    }
    function layerDetail(host, node, view = layerView, compact = false) {
        let updateInfo = () => {};
        if (view === 'inspect' && !inspectionSettings.has(node)) {
            inspectionSettings.set(node, { method: node.settings.method, payload: '', options: { ...node.settings.options } });
        }
        const configured = view === 'inspect' ? { settings: inspectionSettings.get(node) } : node;
        if (!compact) {
        const heading = el('h3', node.name); heading.tabIndex = -1; host.append(heading);
        const navigation = el('div', null, 'poly-section-tabs'); navigation.setAttribute('role', 'group'); navigation.setAttribute('aria-label', 'Layer sections');
        for (const [id, label] of [['image', 'Image & payload'], ['archive', 'Archive contents'], ['inspect', 'Inspect / decode']]) {
            const tab = button(label, () => { layerView = id; render(); }, navigation, `poly-view-${id}`);
            tab.setAttribute('aria-pressed', String(view === id));
        }
        host.append(navigation);
        if (view === 'archive') { archiveDetail(host, node); return; }
        const actions = el('div', null, 'poly-toolbar'); host.append(actions);
        if (view === 'image') {
            button('Upload carrier', () => carrier(node, false), actions);
            button('Generate carrier', () => carrier(node, true), actions);
            if (!node.image) host.append(el('p', 'Carrier required. Upload a PNG/JPEG or generate a carrier to configure this layer.', 'poly-note'));
        }
        if (node.image) {
            previewURL = URL.createObjectURL(new Blob([node.image]));
            const image = el('img'); image.src = previewURL; image.className = 'poly-preview'; image.alt = `Carrier preview for ${node.name}`; host.append(image);
            const info = el('p', 'Reading image dimensions…', 'poly-note'); host.append(info);
            updateInfo = () => {
                info.textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${C.format(node.image)?.toUpperCase()} · ${node.image.length.toLocaleString()} image bytes. ` +
                    capacity(configured, image.naturalWidth, image.naturalHeight);
            };
            image.onload = updateInfo;
        }
        const archiveSize = node.entries.reduce((n, e) => n + (e.child?.original?.length ?? e.bytes?.length ?? e.raw?.size ?? 0), 0);
        host.append(el('p', `${node.entries.length} archive entries · ${archiveSize.toLocaleString()} content bytes before ZIP overhead (unbuilt child sizes excluded). Archive files do not consume image-payload capacity.`, 'poly-note'));
        host.append(el('p', node.validation, 'poly-note'));
        } else {
            const info = el('p', null, 'poly-note'); host.append(info);
            updateInfo = () => {
                const dimensions = PolySize.dimensions(node.image || new Uint8Array());
                info.textContent = dimensions ? capacity(configured, dimensions.width, dimensions.height) : 'Select an image to calculate payload capacity.';
            };
            updateInfo();
        }
        const config = el('section'); config.append(el('h4', view === 'inspect' ? 'Detect or decode an existing image payload' : 'Optional image payload')); host.append(config);
        field(config, 'Image technique', configured.settings.method, value => { configured.settings.method = value; configured.settings.options = {}; render(); }, Object.entries(methods).map(([k, v]) => [k, v.title]));
        config.append(el('p', view === 'inspect' ? 'Supply the method, settings and password for this image. Detection is heuristic. Changing these controls does not stage re-encoding.' : 'One technique per image. Pixel and chunk methods write PNG; F5 writes JPEG. Applying settings stages re-encoding for the next build and may replace an existing payload.', 'poly-note'));
        const fields = el('div', null, 'poly-fields'); config.append(fields);
        for (const [key, label, def] of methods[configured.settings.method].fields) {
            field(fields, label, options(configured)[key], value => { configured.settings.options[key] = value; updateInfo(); }, Array.isArray(def) ? def : null, key === 'password' ? 'password' : 'text');
        }
        if (node.settings.method !== 'none' && view === 'image') {
            field(config, 'Text payload', node.settings.payload, value => { node.settings.payload = value; node.settings.filePayload = null; updateInfo(); }, null, 'textarea');
            const fileInfo = el('p', node.settings.filePayload ? `File payload: ${node.settings.fileName} (${node.settings.filePayload.length} bytes)` : 'Text payload selected.', 'poly-note'); config.append(fileInfo);
            button('Choose file payload', async () => {
                const [file] = await pick(); if (!file) return;
                node.settings.filePayload = await bytesOf(file); node.settings.fileName = file.name; render();
            }, config);
        }
        const controls = el('div', null, 'poly-toolbar'); config.append(controls);
        if (view === 'image') button('Apply encoding on next build', () => {
            if (!node.image) throw new Error('Upload or generate a carrier first.');
            if (node.settings.method !== 'none' && !confirm('Re-encode this image on the next build? Existing image payloads may be lost. Archive entries will remain.')) return;
            node.imageDirty = node.settings.method !== 'none'; C.dirty(node);
            status('Encoding settings staged. Ensure the filename ends in ' + (node.settings.method === 'F5' ? '.jpg' : node.settings.method === 'none' ? 'the original image extension.' : '.png') + ' before building.'); render();
        }, controls);
        if (view === 'inspect') {
        const decodeButton = button('Decode selected method', () => busy(async () => {
            const bytes = await decodePayload(configured, node.image, await canvasOf(node.image));
            if (!bytes?.length) throw new Error('No payload decoded with those settings.');
            download(bytes, node.name + '.payload.bin');
            status(`Decoded ${bytes.length} bytes using ${configured.settings.method}. Without a known original payload this is not a byte-for-byte verification.`);
            if (demo) for (const task of demo.tasks) if (task.kind === 'decode') {
                try { if (PolyDemos.find(root, task.route || []) === node) demo.done.add(task.id); } catch { /* Sample changed. */ }
            }
        }), controls);
        decodeButton.disabled = !node.image || configured.settings.method === 'none';
        const detectButton = button('Detect locally', () => busy(async () => {
            const found = await smartScan(await canvasOf(node.image));
            status('Local detection results (heuristic, not proof of a payload):\n' + JSON.stringify(found, null, 2));
        }), controls);
        detectButton.disabled = !node.image;
        }
        const next = el('div', null, 'poly-toolbar'); host.append(next);
        if (!compact && view === 'image') button('Manage archive contents', () => { layerView = 'archive'; render(); }, next);
    }
    function archiveActions(host) {
        const actions = el('div', null, 'poly-toolbar'); host.append(actions);
        button('Add nested image', addChild, actions);
        const menu = el('details', null, 'poly-add-menu'); menu.append(el('summary', 'Add file or folder'));
        const items = el('div', null, 'poly-toolbar'); menu.append(items); actions.append(menu);
        button('Add files', addFiles, items); button('New text file', addText, items); button('Add folder', addFolder, items);
    }
    function archiveDetail(host, node) {
        host.append(el('p', 'Files in this layer’s ZIP. Nested images have independent carriers, payloads and archives.', 'poly-note'));
        archiveActions(host);
        if (!node.entries.length) host.append(el('p', 'Archive is empty. Add files or create a nested image.', 'poly-note'));
        else {
            const wrap = el('div', null, 'poly-entry-table'), table = el('table'), head = el('thead'), header = el('tr');
            for (const title of ['Entry', 'Type', 'Bytes']) header.append(el('th', title));
            head.append(header); table.append(head); const body = el('tbody'); table.append(body); wrap.append(table); host.append(wrap);
            for (const entry of node.entries) {
                const row = el('tr'), name = el('td');
                button(entry.name, () => {
                    selected = entry.child ? { node: entry.child } : entry.kind === 'folder' ? { node, folder: entry.name } : { node, entry };
                    if (entry.child) layerView = 'image'; render();
                }, name);
                row.append(name, el('td', entry.child ? 'Image + ZIP layer' : entry.kind === 'folder' ? 'Folder' : C.format(entry.bytes || []) ? 'Ordinary image' : 'File'),
                    el('td', (entry.child?.original?.length ?? entry.bytes?.length ?? entry.raw?.size)?.toLocaleString() || 'Not built'));
                body.append(row);
            }
        }
        const exports = el('details', null, 'poly-export-menu'); exports.append(el('summary', 'Export this layer'));
        const buttons = el('div', null, 'poly-toolbar'); exports.append(buttons); host.append(exports);
        button('Download layer', () => buildDownload(node), buttons); button('Download ZIP', () => buildDownload(node, true), buttons);
    }
    function updateProjectActions() {
        $('poly-build').disabled = !root.image;
        $('poly-build').title = root.image ? 'Build and validate the entire tree without downloading.' : 'Add a carrier or load a demo first.';
        $('poly-download').disabled = !root.original || root.dirty || draftsPending(root);
    }
    function render() {
        if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = null; }
        tree(); const host = $('poly-detail'); host.replaceChildren();
        const { node, entry, folder } = selected;
        renderDemos(); updateProjectActions();
        const common = el('details', null, 'poly-item-menu'); common.append(el('summary', 'Item actions')); host.append(common);
        const commonActions = el('div', null, 'poly-toolbar'); common.append(commonActions);
        button('Rename / move', rename, commonActions);
        if (entry || folder || node.parent) button('Remove', remove, commonActions);
        if (folder || entry?.kind === 'folder') host.append(el('h3', folder || entry.name), el('p', 'Add actions place entries in this folder.', 'poly-note'));
        else if (entry) fileDetail(host, node, entry);
        else layerDetail(host, node);
        if (folder || entry?.kind === 'folder') archiveActions(host);
        if (entry && entry.kind !== 'folder') {
            const back = el('div', null, 'poly-toolbar'); host.append(back);
            button('Back to containing archive', () => { selected = { node }; layerView = 'archive'; render(); }, back);
        }
        window.PolyFlow?.render();
    }
    async function importFile(file) {
        if (projectHasContent() && !confirm('Replace the current workspace with this image? Download any work you want to keep first.')) return;
        return busy(async signal => {
            const imported = await C.open(await bytesOf(file), file.name, canvasOf, signal, status);
            C.check(signal);
            root = imported; selected = { node: root }; demo = null; layerView = 'archive'; $('poly-demo-picker').open = false;
            window.PolyFlow?.projectLoaded();
            status('Opened image and archive. Existing image bytes are preserved.');
            return imported;
        });
    }
    document.addEventListener('DOMContentLoaded', () => {
        window.PolyFlow.init({
            core: C, adapter, canvasOf, canvasBytes, bytesOf, busy, textDraft, getDraft: entry => drafts.get(entry), draftsPending, loadDemo, importFile,
            getRoot: () => root,
            replaceRoot: node => { root = node; selected = { node }; demo = null; layerView = 'image'; },
            changed: render,
            cancel: () => controller?.abort(),
            download,
            advanced: node => window.PolyFlow.showTools(node),
            renderTechnique: (host, node, inspect) => layerDetail(host, node, inspect ? 'inspect' : 'image', true),
            exportLayer: (node, zipOnly) => buildDownload(node, zipOnly),
            saveText: (node, entry, value) => {
                const draft = textDraft(entry);
                if (!draft) throw new Error('This file cannot be edited as UTF-8 text.');
                draft.text = value; draft.changed = value !== draft.initial;
                if (draft.changed) {
                    entry.bytes = encoder.encode((draft.bom ? '\ufeff' : '') + value.replace(/\n/g, draft.eol));
                    entry.raw = null; entry.issue = ''; draft.initial = value; draft.changed = false; C.dirty(node); demoSaved(node, entry);
                }
            },
            discardText: entry => drafts.delete(entry),
            validation: () => demo?.report || []
        });
        $('poly-close-advanced').onclick = () => { $('poly-advanced').close(); window.PolyFlow.render(); };
        $('poly-new').onclick = () => {
            if (projectHasContent() && !confirm('Replace this workspace, including all pending edits? Download your work first.')) return;
            root = C.layer(); selected = { node: root }; demo = null; layerView = 'image'; window.PolyFlow.projectLoaded(); render(); status('New workspace. Upload or generate the outer carrier.');
        };
        $('poly-open').onclick = async () => {
            const [file] = await pick('image/png,image/jpeg,.zip'); if (!file) return;
            await importFile(file);
        };
        $('poly-build').onclick = () => buildDownload(root, false, false).catch(e => status(e.message));
        $('poly-download').onclick = () => { if (root.original && !root.dirty && !draftsPending(root)) download(root.original, root.name); };
        $('poly-show-demos').onclick = () => { const picker = $('poly-demo-picker'); picker.open = !picker.open; if (picker.open) picker.scrollIntoView({ block: 'nearest' }); };
        $('poly-cancel').onclick = () => { controller?.abort(); status('Cancellation requested; waiting for the current image operation to yield. Edits will be retained.'); };
        window.addEventListener('beforeunload', event => {
            if (root.image || root.entries.length) { event.preventDefault(); event.returnValue = ''; }
        });
        render();
    });
    // Exposed for reproducible browser validation, independent of the UI.
    window.PolyWorkspace = { adapter, canvasOf, canvasBytes, methods, options, textDraft, decodePayload };
})();
