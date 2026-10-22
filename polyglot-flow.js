/* One composition surface; optional editors expand beside the controls that open them. */
(function () {
    'use strict';
    let api, current, knownRoot, folder = '', working = false, failure = '', progress = '';
    let urls = [], lastFocus = null, previousNode = null, statusMessage = '';
    const baselines = new WeakMap();
    const newTextDrafts = new WeakMap(), messageDrafts = new WeakMap(), nameDrafts = new WeakMap();
    const expanded = new WeakMap();
    let activeEditorSection = 'archive';
    function disclosure(parent, title, key, run) {
        if (!expanded.has(current)) expanded.set(current, {});
        const state = expanded.get(current), details = element('details', null, 'flow-inline-options');
        details.open = !!state[key]; details.append(element('summary', title));
        details.ontoggle = () => { if (details.isConnected) state[key] = details.open; };
        const body = element('div'); details.append(body); parent.append(details); run(body); return details;
    }
    function editorSlot(parent, section) {
        const slot = element('div', null, 'flow-inline-slot'); slot.id = 'flow-inline-' + section; parent.append(slot);
    }
    const utf8 = new TextEncoder(), $ = id => document.getElementById(id);
    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text != null) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function action(parent, text, run, style = 'quiet', id) {
        const button = element('button', text, `flow-button flow-${style}`); button.type = 'button';
        if (id) button.id = id;
        button.onclick = () => Promise.resolve().then(run).catch(error => showError(error.message));
        parent.append(button); return button;
    }
    function showError(message) {
        const inline = $('flow-dialog-error');
        if ($('poly-flow-dialog').open && inline) { inline.textContent = message; inline.hidden = false; }
        else { failure = message; render(); }
    }
    function picture(bytes, alt, className) {
        const url = URL.createObjectURL(new Blob([bytes])); urls.push(url);
        const image = element('img', null, className); image.src = url; image.alt = alt; return image;
    }
    function replaceProject(node) { api.replaceRoot(node); knownRoot = node; current = node; folder = ''; failure = ''; }
    function walk(root) {
        const nodes = [], stack = [root];
        while (stack.length) { const node = stack.pop(); nodes.push(node); for (const entry of node.entries) if (entry.child) stack.push(entry.child); }
        return nodes;
    }
    function totals(node) {
        const layers = walk(node); let files = 0;
        for (const layer of layers) files += layer.entries.filter(e => !e.child && e.kind !== 'folder').length;
        return { files, nested: layers.length - 1 };
    }
    function outputExtension(node) { return node.settings.method === 'F5' ? 'jpg' : node.settings.method === 'none' ? api.core.format(node.image) || 'png' : 'png'; }
    function rename(node, name) {
        api.core.path(name);
        if (name.endsWith('/')) throw new Error('Give the image a filename, without a trailing /.');
        const entry = node.parent?.entries.find(e => e.child === node);
        if (entry) { api.core.collision(node.parent.entries, name, entry); entry.name = name; }
        node.name = name; nameDrafts.delete(node); api.core.dirty(node.parent || node);
    }
    function matchExtension(node) {
        const extension = outputExtension(node);
        if (!(extension === 'jpg' ? /\.jpe?g$/i : /\.png$/i).test(node.name)) rename(node, node.name.replace(/\.[^/.]+$/, '') + '.' + extension);
    }
    async function generatedCover(style = 'dusk') {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        const palettes = { dusk: ['#233a53', '#8a8daa', '#e6c5b1'], ocean: ['#173c44', '#6eafa6', '#d2dec9'], ember: ['#442c44', '#a26772', '#e6b58a'] };
        const colors = palettes[style] || palettes.dusk;
        const gradient = ctx.createLinearGradient(0, 0, 640, 480);
        colors.forEach((color, index) => gradient.addColorStop(index / 2, color));
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 640, 480);
        // Small, deterministic grain gives the generated carrier texture without an external asset.
        const pixels = ctx.getImageData(0, 0, 640, 480); let seed = 17;
        for (let i = 0; i < pixels.data.length; i += 4) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const grain = (seed >>> 29) - 3;
            for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] += grain;
        }
        ctx.putImageData(pixels, 0, 0); return api.canvasBytes(canvas);
    }
    async function start() {
        const root = api.getRoot();
        if ((root.image || root.entries.length) && !confirm('Start a new image? Download your current work first if you want to keep it.')) return;
        await api.busy(async signal => {
            const bytes = await generatedCover(); api.core.check(signal);
            replaceProject(api.core.layer('outer.png', bytes));
        });
    }
    function field(parent, label, value, options = {}) {
        const wrap = element('label', null, 'flow-field'), caption = element('span', label);
        const input = element(options.multiline ? 'textarea' : 'input');
        if (!options.multiline) input.type = 'text';
        if (options.id) input.id = options.id;
        input.value = value; input.spellcheck = !!options.multiline;
        if (options.placeholder) input.placeholder = options.placeholder;
        wrap.append(caption, input); parent.append(wrap); return input;
    }
    function dialog(title, description, section = 'archive') {
        const host = $('poly-flow-dialog'); lastFocus = document.activeElement;
        activeEditorSection = section;
        const slot = $('flow-inline-' + section);
        if (slot) slot.append(host);
        host.setAttribute('aria-label', title);
        host.replaceChildren();
        const heading = element('div', null, 'flow-dialog-heading'); heading.append(element('h2', title));
        action(heading, 'Close', () => host.close(), 'text'); host.append(heading);
        if (description) host.append(element('p', description, 'flow-subtitle'));
        const error = element('p', '', 'flow-error'); error.id = 'flow-dialog-error'; error.hidden = true; error.setAttribute('role', 'alert'); host.append(error);
        const body = element('div'); host.append(body);
        if (!host.open) host.show();
        host.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        return { host, body };
    }
    function closeDialog() { $('poly-flow-dialog').close(); failure = ''; api.changed(); }
    function dismissOnBackdrop(host) {
        let pressedOutside = false;
        const outside = event => {
            const rect = host.getBoundingClientRect();
            return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
        };
        host.addEventListener('pointerdown', event => { pressedOutside = event.button === 0 && event.target === host && outside(event); });
        host.addEventListener('click', event => {
            if (pressedOutside && event.target === host && outside(event)) host.close();
            pressedOutside = false;
        });
        host.addEventListener('pointercancel', () => { pressedOutside = false; });
        host.addEventListener('close', () => { pressedOutside = false; });
    }
    function showExamples() {
        const { host, body } = dialog('Start with a working example', 'Load one, change its contents, then create your own output.');
        const examples = [
            ['image-archive', 'A message and a file', 'A hidden message and an editable note in one image.'],
            ['branches', 'Images inside an image', 'Two independent branches, with another image nested deeper.'],
            ['reopen-edit', 'Edit an existing image', 'Open a complete project and change a deeply nested note.']
        ];
        for (const [id, title, detail] of examples) {
            const row = element('div', null, 'flow-example');
            const label = element('div'); label.append(element('strong', title), element('p', detail)); row.append(label);
            action(row, 'Use example', async () => { host.close(); await api.loadDemo(id); }, 'secondary', `flow-example-${id}`);
            body.append(row);
        }
        action(body, 'Load technique comparison example', async () => { host.close(); await api.loadDemo('techniques'); }, 'text');
    }
    function editText(entry = null) {
        const node = current, creating = !entry;
        if (!newTextDrafts.has(node)) newTextDrafts.set(node, new Map());
        const pending = newTextDrafts.get(node), location = folder;
        const candidate = entry || pending.get(location) || { name: folder + 'README.md', bytes: new Uint8Array(), kind: 'file' };
        if (creating) pending.set(location, candidate);
        const draft = api.textDraft(candidate);
        if (!draft) { api.advanced(node); return; }
        const { body } = dialog(creating ? 'Create text file' : candidate.name.split('/').pop(), 'Edit archive text here. Closing keeps your draft; Save writes it into the archive.');
        const filename = field(body, 'Filename', candidate.name, { id: 'flow-note-name' });
        if (!creating) filename.readOnly = true;
        else filename.oninput = () => { candidate.name = filename.value; };
        const contents = field(body, 'Contents', draft.text, { multiline: true, id: 'flow-note-content', placeholder: 'Write your note…' });
        contents.oninput = () => { draft.text = contents.value; draft.changed = draft.text !== draft.initial; };
        const footer = element('div', null, 'flow-dialog-footer'); body.append(footer);
        action(footer, 'Discard changes', () => { api.discardText(candidate); if (creating) pending.delete(location); closeDialog(); }, 'text');
        action(footer, 'Save text file', () => {
            if (creating) {
                const name = api.core.path(filename.value.trim());
                if (name.endsWith('/')) throw new Error('A note needs a filename, not a folder path.');
                api.core.collision(node.entries, name); candidate.name = name;
            }
            api.saveText(node, candidate, contents.value);
            if (creating) { node.entries.push(candidate); pending.delete(location); api.core.dirty(node); }
            closeDialog();
        }, 'primary', 'flow-save-note');
        contents.focus();
    }
    function editMessage() {
        const node = current;
        const { body } = dialog('Image payload', 'Encode text into the image, separately from its ZIP contents. Closing keeps your draft.', 'payload');
        if (node.original) body.append(element('p', 'Saving a new message can replace an existing hidden payload in this image.', 'flow-caution'));
        const input = field(body, 'Message', messageDrafts.get(node) ?? (node.settings.filePayload ? '' : node.settings.payload), { multiline: true, id: 'flow-message-content', placeholder: 'Your hidden message…' });
        input.oninput = () => messageDrafts.set(node, input.value);
        const footer = element('div', null, 'flow-dialog-footer'); body.append(footer);
        action(footer, 'Encoding settings', () => { $('poly-flow-dialog').close(); api.advanced(node); }, 'text');
        action(footer, 'Discard draft', () => { messageDrafts.delete(node); closeDialog(); }, 'text');
        action(footer, 'Save message', () => {
            if (!input.value) throw new Error('Write a message, or close this panel to leave the image as it is.');
            const extension = node.settings.method === 'F5' ? 'jpg' : 'png';
            const nextName = node.name.replace(/\.[^/.]+$/, '') + '.' + extension;
            // Validate a possible extension change before modifying the image configuration.
            const parentEntry = node.parent?.entries.find(e => e.child === node);
            if (parentEntry) api.core.collision(node.parent.entries, nextName, parentEntry);
            if (node.settings.method === 'none') node.settings = { method: 'LSB', payload: '', options: { channels: 'RGB', bits: 1 } };
            node.settings.payload = input.value; node.settings.filePayload = null; node.imageDirty = true;
            rename(node, nextName); api.core.dirty(node); messageDrafts.delete(node); closeDialog();
        }, 'primary', 'flow-save-message');
        input.focus();
    }
    async function addFiles(files) {
        if (!files.length) return;
        const node = current, prefix = folder;
        await api.busy(async signal => {
            const added = [], checkEntries = [...node.entries];
            for (const file of files) {
                api.core.check(signal);
                const name = prefix + file.name; api.core.collision(checkEntries, name);
                const entry = { name, bytes: await api.bytesOf(file), kind: 'file' };
                added.push(entry); checkEntries.push(entry);
            }
            api.core.check(signal); node.entries.push(...added); api.core.dirty(node);
        });
    }
    async function addNested() {
        const parent = current, prefix = folder;
        await api.busy(async signal => {
            let index = 1, name;
            do { name = prefix + (index === 1 ? 'nested-image.png' : `nested-image-${index}.png`); index++; }
            while (parent.entries.some(e => e.name === name));
            api.core.collision(parent.entries, name);
            const child = api.core.layer(name, await generatedCover('ocean')); child.parent = parent;
            api.core.check(signal);
            parent.entries.push({ name, child, kind: 'layer' }); api.core.dirty(parent);
            current = child; folder = '';
        });
    }
    function entryMenu(parent, entry) {
        const menu = element('details', null, 'flow-entry-menu'), summary = element('summary', 'File actions');
        summary.setAttribute('aria-label', `Actions for ${entry.name}`); menu.append(summary);
        const items = element('div', null, 'flow-menu-items'); menu.append(items); parent.append(menu);
        action(items, 'Download', async () => {
            if (entry.child) {
                await api.busy(async signal => {
                    const bytes = await api.core.build(entry.child, api.adapter, signal, apiStatus);
                    api.download(bytes, entry.name);
                });
            } else if (entry.bytes) api.download(entry.bytes, entry.name);
            else throw new Error('This entry cannot be extracted. Use Advanced to download the containing image.');
        });
        action(items, 'Rename', () => {
            const { body } = dialog('Rename file', 'Use a relative path to move it into a folder.');
            const name = field(body, 'Name', entry.name);
            action(body, 'Save name', () => {
                const next = api.core.path(name.value.trim());
                if (next.endsWith('/')) throw new Error('A file path must not end with /.');
                api.core.collision(current.entries, next, entry); entry.name = next;
                if (entry.child) entry.child.name = next;
                api.core.dirty(current); closeDialog();
            }, 'primary');
        });
        action(items, 'Remove', () => {
            const extra = entry.child ? ' and everything nested inside it' : '';
            if (!confirm(`Remove ${entry.name}${extra}? This cannot be undone.`)) return;
            current.entries = current.entries.filter(item => item !== entry); api.core.dirty(current); api.changed();
        });
    }
    function rows(node) {
        const result = [], folders = new Set();
        for (const entry of node.entries) {
            if (!entry.name.startsWith(folder) || entry.name === folder) continue;
            const relative = entry.name.slice(folder.length), separator = relative.indexOf('/');
            if (separator >= 0) {
                const path = folder + relative.slice(0, separator + 1);
                if (!folders.has(path)) { result.push({ folder: path, name: relative.slice(0, separator) }); folders.add(path); }
            } else result.push({ entry, name: relative });
        }
        return result;
    }
    function fileList(parent) {
        const list = element('div', null, 'flow-file-list'); parent.append(list);
        for (const row of rows(current)) {
            const entry = row.entry, wrapper = element('div', null, 'flow-file-row'); list.append(wrapper);
            const open = action(wrapper, '', () => {
                if (row.folder) { folder = row.folder; render(); }
                else if (entry.child) { current = entry.child; folder = ''; render(); }
                else if (isTextEntry(entry)) editText(entry);
                else {
                    const { body } = dialog(row.name, entry.issue || 'This file will be included unchanged.');
                    if (api.core.format(entry.bytes || [])) body.append(picture(entry.bytes, row.name, 'flow-file-preview'));
                    action(body, 'Download file', () => {
                        if (!entry.bytes) throw new Error('Extraction is unavailable. The original bytes remain in the containing image.');
                        api.download(entry.bytes, entry.name);
                    }, 'primary');
                    action(body, 'File tools', () => { $('poly-flow-dialog').close(); api.advanced(current); }, 'text');
                }
            }, 'entry');
            if (entry?.child?.image || api.core.format(entry?.bytes || [])) open.append(picture(entry.child?.image || entry.bytes, '', 'flow-file-thumb'));
            else open.append(element('span', row.folder ? 'Folder' : row.name.split('.').pop().slice(0, 4).toUpperCase(), 'flow-file-mark'));
            const copy = element('span'); copy.append(element('strong', row.name));
            const draft = entry && api.getDraft(entry);
            copy.append(element('span', row.folder ? 'Open folder' : entry.child ? 'Nested image' : draft?.changed ? 'Unsaved note' : isTextEntry(entry) ? 'Editable text' : 'File', 'flow-file-meta'));
            open.append(copy);
            if (entry) entryMenu(wrapper, entry);
        }
    }
    function isTextEntry(entry) {
        if (!entry?.bytes || entry.child || entry.kind === 'folder') return false;
        // Probe, rather than decode entire attachments while painting the file list.
        // A selected text file is still read in full by the editor.
        const prefix = entry.bytes.subarray(0, 4096);
        try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(prefix, { stream: true });
            return !/[\x00-\x08\x0e-\x1f]/.test(text);
        } catch { return false; }
    }
    function uploadInput(parent, id, accept, multiple, run) {
        const input = element('input'); input.type = 'file'; input.id = id; input.hidden = true;
        input.accept = accept; input.multiple = multiple;
        input.onchange = () => { const files = [...input.files]; input.value = ''; Promise.resolve(run(files)).catch(error => showError(error.message)); };
        parent.append(input); return input;
    }
    function contents(parent) {
        const surface = parent, layout = element('div', null, 'flow-composition-layout'), editor = element('section'), map = element('aside', null, 'flow-layer-aside');
        layout.append(editor, map); parent.append(layout); parent = editor;
        heading(parent, current.parent ? `Edit layer / ${current.name.split('/').pop()}` : 'Build a nested image + ZIP', 'Set this layer’s image and ZIP contents below. Add nested polyglot creates a child; Build & download produces the complete outer file.');
        disclosure(parent, 'How the image, ZIP and nested layers fit together', 'technique', body => {
            body.append(element('p', 'Each layer is one file: image bytes followed by a readable ZIP archive. A child layer is a complete image + ZIP stored as a file in its parent’s archive. Select any layer in the map to edit it below.', 'flow-muted'));
            body.append(element('pre', 'outer.png  [image + ZIP]\n├─ README.md\n├─ branch-a.png  [image + ZIP]\n│  └─ deeper.png  [image + ZIP]\n└─ branch-b.jpg  [image + ZIP]', 'flow-structure'));
        });
        parent.append(element('h3', 'Image & filename', 'flow-section-title'));
        cover(parent);
        editorSlot(parent, 'image');
        parent.append(element('h3', 'Image payload', 'flow-section-title'));
        const message = element('div', null, 'flow-message-line'); parent.append(message);
        const hasMessage = current.settings.method !== 'none';
        message.append(element('span', hasMessage ? `${current.settings.method} payload configured` : 'Optional: encode text or a file in the image pixels or metadata.'));
        action(message, hasMessage ? 'Edit text payload' : 'Embed text payload', editMessage, 'text', 'flow-add-message');
        disclosure(parent, 'Encoding method, file payload & capacity', 'encoding', body => api.renderTechnique(body, current, false));
        disclosure(parent, 'Detect or decode an existing image payload', 'decoding', body => api.renderTechnique(body, current, true));
        editorSlot(parent, 'payload');
        parent.append(element('h3', 'ZIP contents & nested layers', 'flow-section-title'));
        map.append(element('h3', 'Layer map')); layerMap(map, api.getRoot());
        map.append(element('p', 'Select a layer to edit its image and archive. Add nested polyglot creates a child of the selected layer.', 'flow-muted'));
        const content = element('div', null, 'flow-contents'); parent.append(content);
        const input = uploadInput(content, 'flow-files', '', true, addFiles);
        const toolbar = element('div', null, 'flow-content-actions'); content.append(toolbar);
        action(toolbar, 'Add files', () => input.click(), 'secondary', 'flow-add-files');
        action(toolbar, 'Create text file', () => editText(), 'quiet', 'flow-add-note');
        action(toolbar, 'Add nested polyglot', addNested, 'quiet', 'flow-add-nested');
        action(toolbar, 'Add folder', () => {
            const name = prompt('Folder path', folder + 'documents/'); if (name === null) return;
            const path = api.core.path(name.replace(/\/?$/, '/')); api.core.collision(current.entries, path);
            current.entries.push({ name: path, kind: 'folder', bytes: new Uint8Array() }); api.core.dirty(current); render();
        }, 'text', 'flow-add-folder');
        if (!rows(current).length) {
            const empty = element('div', null, 'flow-drop-area'); empty.append(element('p', 'Drop files to add ZIP entries'), element('span', 'Use Create text file for README.md, AGENTS.md or other editable text.')); content.append(empty);
        } else fileList(content);
        content.ondragover = event => { event.preventDefault(); content.classList.add('flow-dragging'); };
        content.ondragleave = () => content.classList.remove('flow-dragging');
        content.ondrop = event => { event.preventDefault(); content.classList.remove('flow-dragging'); addFiles([...event.dataTransfer.files]); };
        editorSlot(parent, 'archive');
        disclosure(parent, 'Download this layer or its ZIP', 'exports', body => {
            action(body, 'Download selected layer', () => api.exportLayer(current, false), 'quiet');
            action(body, 'Download selected ZIP', () => api.exportLayer(current, true), 'quiet');
        });
        const root = api.getRoot(), count = totals(root), measured = PolySize.measure(root);
        const output = element('section', null, 'flow-build-summary'); map.append(output);
        const pendingCarriers = walk(root).some(node => !node.image);
        output.append(element('h3', 'Complete output'), element('strong', root.name), element('p', `${count.nested + 1} layers · ${count.files} files · ${measured.exact ? '' : '~'}${PolySize.format(measured.total)}${pendingCarriers ? ' + pending carriers' : ''}`, 'flow-muted'));
        action(output, 'Size breakdown', sizeMap, 'text', 'flow-size-map');
        if (root.original && !root.dirty && !api.draftsPending(root)) {
            const result = element('p', 'Current output available. See each layer’s validation below.', 'flow-built-status'); result.setAttribute('role', 'status'); output.append(result);
            action(output, 'Download again', () => api.download(root.original, root.name), 'quiet', 'flow-download-again');
        }
        if (walk(root).some(node => node.validation.startsWith('Partial'))) output.append(element('p', 'Some entries were preserved without extraction verification. See validation results.', 'flow-caution'));
        disclosure(output, 'Validation results', 'validation', body => {
            for (const node of walk(root)) body.append(element('p', `${node.name}: ${node.validation}`, 'flow-muted'));
        });
        if (statusMessage) disclosure(output, 'Activity & decoding results', 'activity', body => body.append(element('pre', statusMessage, 'flow-activity')));
        editorSlot(surface, 'output');
        footer(surface, 'Build & download', build);
    }
    async function replaceCover(files) {
        if (!files.length) return;
        const node = current;
        if (node.original && !confirm('Replace this image? An existing hidden payload may be lost. Its archive contents will be kept.')) return;
        await api.busy(async signal => {
            let bytes = await api.bytesOf(files[0]); await api.canvasOf(bytes);
            try { bytes = (await api.core.readZip(bytes, signal)).image; } catch (error) { api.core.check(signal); }
            api.core.check(signal); node.image = bytes; node.imageDirty = node.settings.method !== 'none'; matchExtension(node); api.core.dirty(node);
        });
    }
    function cover(parent) {
        const layout = element('div', null, 'flow-cover-layout'), visual = element('div', null, 'flow-cover-visual'), controls = element('div', null, 'flow-cover-controls');
        layout.append(visual, controls); parent.append(layout);
        if (current.image) visual.append(picture(current.image, 'Current image cover', 'flow-cover-image'));
        else visual.append(element('p', 'Upload an image or generate a carrier. Building with no selection creates a default carrier.', 'flow-muted'));
        const dimensions = PolySize.dimensions(current.image || new Uint8Array());
        if (dimensions) visual.append(element('p', `${dimensions.width} × ${dimensions.height} · ${api.core.format(current.image)?.toUpperCase()} · ${PolySize.format(current.image.length)}`, 'flow-muted'));
        const input = uploadInput(controls, 'flow-cover-file', 'image/png,image/jpeg', false, replaceCover);
        action(controls, 'Upload image', () => input.click(), 'secondary', 'flow-upload-cover');
        action(controls, 'Generate image · Agent', imageAgent, 'secondary', 'flow-image-agent');
        const presets = disclosure(controls, 'Local carrier presets', 'presets', () => {});
        const styles = element('div', null, 'flow-cover-styles'); presets.lastElementChild.append(styles);
        for (const [id, name] of [['dusk', 'Dusk'], ['ocean', 'Ocean'], ['ember', 'Ember']]) action(styles, name, async () => {
            const node = current;
            if (node.original && !confirm('Replace this cover? Existing hidden image data may be lost. Its files will be kept.')) return;
            await api.busy(async signal => { const bytes = await generatedCover(id); api.core.check(signal); node.image = bytes; node.imageDirty = node.settings.method !== 'none'; matchExtension(node); api.core.dirty(node); });
        });
        const filename = field(controls, 'Output filename', nameDrafts.get(current)?.value ?? current.name, { id: 'flow-filename' });
        controls.append(element('p', 'Use .png for PNG output or .jpg for JPEG. The downloaded file contains both this image and its ZIP archive.', 'flow-muted'));
        if (current.image) action(controls, 'Reduce image dimensions…', resizeCarrier, 'text', 'flow-resize-carrier');
        const nameError = element('p', '', 'flow-field-error'); controls.append(nameError);
        if (nameDrafts.has(current)) { nameError.textContent = nameDrafts.get(current).error; filename.setCustomValidity(nameDrafts.get(current).error); }
        filename.oninput = () => {
            try { rename(current, filename.value.trim()); nameError.textContent = ''; filename.setCustomValidity(''); }
            catch (error) { nameDrafts.set(current, { value: filename.value, error: error.message }); nameError.textContent = error.message; filename.setCustomValidity(error.message); }
        };
    }
    function returnToParent() {
        if (!current.parent) { render(); return; }
        const child = current; current = child.parent;
        const name = current.entries.find(e => e.child === child)?.name || '';
        folder = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : ''; render();
    }
    function heading(parent, title, subtitle) {
        const header = element('div', null, 'flow-heading'), titleNode = element('h2', title); titleNode.tabIndex = -1; header.append(titleNode);
        if (subtitle) header.append(element('p', subtitle, 'flow-subtitle')); parent.append(header);
    }
    function footer(parent, text, run) {
        const foot = element('div', null, 'flow-footer'); parent.append(foot);
        if (current.parent || folder) action(foot, current.parent && !folder ? 'Back to parent' : 'Up one folder', () => {
            if (folder) { folder = folder.replace(/[^/]+\/$/, ''); render(); } else returnToParent();
        }, 'text', 'flow-back');
        else { const count = walk(api.getRoot()).length; foot.append(element('span', `Output: ${api.getRoot().name} · ${count} ${count === 1 ? 'layer' : 'layers'} including nested contents`, 'flow-muted')); }
        const pending = api.draftsPending(api.getRoot());
        if (pending) foot.append(element('span', 'Save or discard your note drafts to continue.', 'flow-field-error'));
        const button = action(foot, text, run, 'primary', 'flow-build-direct'); button.disabled = working || pending; return button;
    }
    async function build() {
        const invalidName = walk(api.getRoot()).find(node => nameDrafts.has(node));
        if (invalidName) throw new Error(`Fix the filename for ${invalidName.name}: ${nameDrafts.get(invalidName).error}`);
        if ($('flow-filename') && !$('flow-filename').reportValidity()) return;
        if (api.draftsPending(api.getRoot())) throw new Error('Save or discard your note drafts before creating the image.');
        await api.busy(async signal => {
            const root = api.getRoot();
            // New empty layers created in Advanced receive the same usable default cover.
            for (const node of walk(root)) {
                if (!node.image) { const bytes = await generatedCover(); api.core.check(signal); node.image = bytes; api.core.dirty(node); }
                matchExtension(node);
            }
            const bytes = await api.core.build(root, api.adapter, signal, apiStatus);
            api.core.check(signal);
            api.download(bytes, root.name);
        });
    }
    function layerMap(parent, root) {
        const list = element('ul', null, 'flow-layer-map'); parent.append(list);
        const queue = [{ node: root, list }];
        while (queue.length) {
            const item = queue.shift(), li = element('li'); item.list.append(li);
            const button = action(li, '', () => { current = item.node; folder = ''; render(); }, 'map');
            if (item.node.image) button.append(picture(item.node.image, '', 'flow-map-thumb'));
            const copy = element('span'); copy.append(element('strong', item.node.name.split('/').pop()), element('span', 'Image + ZIP', 'flow-muted')); button.append(copy);
            if (item.node === current) button.setAttribute('aria-current', 'true');
            const children = item.node.entries.filter(entry => entry.child);
            if (children.length) { const nested = element('ul'); li.append(nested); for (const entry of children) queue.push({ node: entry.child, list: nested }); }
        }
    }
    function sizeMap() {
        const measured = PolySize.measure(api.getRoot());
        const { body } = dialog(`Size map / ${measured.exact ? '' : '~'}${PolySize.format(measured.total)}`, `${measured.exact ? 'Measured built output.' : 'Current output estimate; pending image encoding may change carrier sizes.'} Child sizes are already included in their parent.`, 'output');
        const grouped = new Map();
        for (const part of measured.parts) grouped.set(part.kind, (grouped.get(part.kind) || 0) + part.bytes);
        const bar = element('div', null, 'flow-size-bar'); bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', [...grouped].map(([kind, bytes]) => `${kind}: ${PolySize.format(bytes)}`).join(', '));
        body.append(bar);
        const legend = element('div', null, 'flow-size-legend'); body.append(legend);
        for (const [kind, bytes] of grouped) {
            const segment = element('span', '', `size-${kind}`); segment.style.width = `${measured.total ? bytes / measured.total * 100 : 0}%`; segment.title = `${kind}: ${PolySize.format(bytes)}`; bar.append(segment);
            legend.append(element('span', `${kind === 'carrier' ? 'Carrier' : kind === 'nested' ? 'Nested polyglots' : kind === 'overhead' ? 'ZIP overhead' : 'Files'} ${PolySize.format(bytes)}`, `size-key size-${kind}`));
        }
        const list = element('div', null, 'flow-size-tree'); body.append(list);
        const queue = [{ record: measured, parent: list }];
        while (queue.length) {
            const { record, parent } = queue.shift(), layer = element('details', null, 'flow-size-layer'); layer.open = record.node === api.getRoot();
            const title = element('summary'); title.append(element('strong', record.node.name), element('span', PolySize.format(record.total))); layer.append(title); parent.append(layer);
            for (const part of record.parts) {
                if (part.child) {
                    const child = element('div', null, 'flow-size-child');
                    if (part.bytes !== part.child.total) child.append(element('p', `Stored in parent: ${PolySize.format(part.bytes)}; decoded child: ${PolySize.format(part.child.total)}.`, 'flow-muted'));
                    layer.append(child); queue.push({ record: part.child, parent: child });
                } else {
                    const row = element('div', null, 'flow-size-row'); row.append(element('span', part.name), element('span', PolySize.format(part.bytes)));
                    const track = element('div', null, `flow-size-track size-${part.kind}`); track.style.width = `${record.total ? part.bytes / record.total * 100 : 0}%`; row.append(track); layer.append(row);
                }
            }
            if (record.pendingEncoding) layer.append(element('p', 'Image encoding is pending; this carrier’s final byte size can change.', 'flow-muted'));
            if (record.node.imageAgent) {
                const source = record.node.imageAgent;
                layer.append(element('p', `Agent / ${source.model}: received ${PolySize.format(source.sourceBytes)}, prepared ${PolySize.format(source.outputBytes)}, current image ${PolySize.format(record.image)}.`, 'flow-muted'));
            }
        }
        const largest = [...measured.records.values()].sort((a, b) => b.image - a.image)[0];
        body.append(element('p', `Largest carrier: ${largest.node.name} (${PolySize.format(largest.image)}). Estimated working copies during rebuilding: ${PolySize.format(measured.workingBytes)}.`, 'flow-muted'));
        const actions = element('div', null, 'flow-dialog-footer'); body.append(actions);
        action(actions, 'Reduce selected image dimensions…', () => { $('poly-flow-dialog').close(); resizeCarrier(); }, 'secondary');
        action(actions, 'Return to composition', () => $('poly-flow-dialog').close(), 'primary');
    }
    async function raster(bytes, type, edge = 0) {
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        try {
            const image = new Image(); image.src = url; await image.decode();
            const scale = edge > 0 ? Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight)) : 1;
            if (scale === 1 && ['image/png', 'image/jpeg'].includes(type)) return { bytes, width: image.naturalWidth, height: image.naturalHeight };
            const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            return { bytes: await api.canvasBytes(canvas), width: canvas.width, height: canvas.height };
        } finally { URL.revokeObjectURL(url); }
    }
    function resizeCarrier() {
        const node = current;
        if (!node.image) throw new Error('Select or generate a carrier first.');
        const dimensions = PolySize.dimensions(node.image);
        const { body } = dialog('Reduce image dimensions', 'Set a smaller longest edge to downsample the image while keeping its aspect ratio. This can reduce carrier bytes and lowers pixel-based payload capacity. ZIP entries are retained.', 'image');
        if (node.original || node.settings.method !== 'none') body.append(element('p', 'Resizing changes pixels and may invalidate an existing image payload. Configured payloads are re-encoded on the next build.', 'flow-caution'));
        body.append(element('p', `${dimensions ? `${dimensions.width} × ${dimensions.height} · ` : ''}${PolySize.format(node.image.length)} before resizing. Aspect ratio is retained.`, 'flow-muted'));
        const edge = field(body, 'Longest edge in pixels', dimensions ? Math.max(dimensions.width, dimensions.height) : '', { id: 'flow-resize-edge' });
        action(body, 'Apply dimensions', async () => {
            const pixels = Number(edge.value);
            if (!Number.isSafeInteger(pixels) || pixels <= 0) throw new Error('Enter a positive whole-pixel dimension.');
            const before = node.image.length;
            await api.busy(async signal => {
                const result = await raster(node.image, api.core.format(node.image) === 'jpg' ? 'image/jpeg' : 'image/png', pixels); api.core.check(signal);
                node.image = result.bytes; node.imageDirty = node.settings.method !== 'none'; matchExtension(node); api.core.dirty(node);
                body.append(element('p', `${PolySize.format(before)} → ${PolySize.format(result.bytes.length)} · ${result.width} × ${result.height}`, 'flow-caution'));
            });
        }, 'primary');
    }
    function imageAgent() {
        const { body, host } = dialog('Image Agent / polyglot layers', 'Uses the existing Agent module and OpenRouter connection. Only prompts and layer names are sent; archive files and hidden payloads remain local. Provider charges may apply.', 'image');
        const settings = ST3GGImageAgent.settings(), config = element('details', null, 'flow-agent-config'); config.open = !settings.apiKey;
        config.append(element('summary', 'Agent connection & image model')); body.append(config);
        const key = field(config, 'OpenRouter API key (shared with Agent)', settings.apiKey); key.type = 'password';
        const model = field(config, 'Image model', settings.model, { id: 'flow-agent-model' });
        const discovery = element('div'); config.append(discovery);
        action(discovery, 'Find available image models', async () => {
            const models = await ST3GGImageAgent.models();
            const select = element('select'); select.setAttribute('aria-label', 'Available image models');
            for (const item of models) { const option = element('option', item.name || item.id); option.value = item.id; select.append(option); }
            select.onchange = () => { model.value = select.value; }; discovery.replaceChildren(select);
            if (models.length) model.value = select.value;
        }, 'text');
        const prompt = field(body, 'Image direction', '', { multiline: true, placeholder: 'Describe the imagery for this layer or a common visual direction for the nested set.', id: 'flow-agent-prompt' });
        const scopeLabel = element('label', 'Generate for', 'flow-field'), scope = element('select'); scope.id = 'flow-agent-scope';
        for (const [value, title] of [['selected', `Selected layer / ${current.name}`], ['all', 'All polyglot layers']]) { const option = element('option', title); option.value = value; scope.append(option); } scopeLabel.append(scope); body.append(scopeLabel);
        const edge = field(body, 'Optional longest edge after generation', '', { placeholder: 'Keep model output dimensions', id: 'flow-agent-edge' });
        body.append(element('p', 'Resizing is applied before embedding. Review byte sizes and previews before replacing carriers; no image is applied automatically.', 'flow-muted'));
        const plan = element('div', null, 'flow-agent-plan'), previews = element('div', null, 'flow-agent-previews'); body.append(plan, previews);
        const jobs = [], previewURLs = []; let running = false;
        const footer = element('div', null, 'flow-dialog-footer'); body.append(footer);
        const stop = action(footer, 'Stop generation', api.cancel, 'text'); stop.disabled = true;
        const apply = action(footer, 'Apply generated carriers', () => {
            if (!jobs.length) throw new Error('Generate at least one carrier first.');
            if (jobs.some(job => job.node.image) && !confirm('Replace these layer carriers? Existing image payloads may be invalidated. Archive entries will be kept.')) return;
            const names = new Map(jobs.map(job => {
                const ext = job.node.settings.method === 'F5' ? 'jpg' : job.node.settings.method === 'none' ? api.core.format(job.bytes) : 'png';
                return [job.node, job.node.name.replace(/\.[^/.]+$/, '') + '.' + ext];
            }));
            // Preflight every renamed sibling before committing any generated bytes.
            for (const parent of new Set(jobs.map(job => job.node.parent).filter(Boolean))) {
                const checked = [];
                for (const entry of parent.entries) { const name = names.get(entry.child) || entry.name; api.core.collision(checked, name); checked.push({ name }); }
            }
            for (const job of jobs) {
                job.node.image = job.bytes; job.node.imageDirty = job.node.settings.method !== 'none'; job.node.name = names.get(job.node);
                const entry = job.node.parent?.entries.find(item => item.child === job.node); if (entry) entry.name = job.node.name;
                api.core.dirty(job.node);
                job.node.imageAgent = { model: job.model, sourceBytes: job.sourceBytes, outputBytes: job.bytes.length, width: job.width, height: job.height };
            }
            closeDialog(); api.changed();
        }, 'secondary', 'flow-agent-apply'); apply.disabled = true;
        const generate = action(footer, 'Generate previews', async () => {
            const pixels = edge.value.trim() ? Number(edge.value) : 0;
            if (edge.value.trim() && (!Number.isSafeInteger(pixels) || pixels <= 0)) throw new Error('Use a positive whole-pixel dimension or leave it blank.');
            if (!prompt.value.trim()) throw new Error('Enter an image direction.');
            ST3GGImageAgent.configure({ apiKey: key.value.trim(), model: model.value.trim() });
            const targets = scope.value === 'all' ? walk(api.getRoot()) : [current];
            const direction = prompt.value.trim(), chosenModel = model.value.trim(), chosenKey = key.value.trim();
            jobs.length = 0; previews.replaceChildren(); for (const url of previewURLs) URL.revokeObjectURL(url); previewURLs.length = 0;
            plan.textContent = `${targets.length} image ${targets.length === 1 ? 'request' : 'requests'} · ${model.value}. No archive contents will be sent.`;
            generate.disabled = true; apply.disabled = true; stop.disabled = false; running = true;
            await api.busy(async signal => {
                for (const node of targets) {
                    api.core.check(signal); plan.textContent = `Generating ${jobs.length + 1}/${targets.length}: ${node.name}`;
                    const generated = await ST3GGImageAgent.generate({ prompt: `${direction}\nCarrier layer: ${node.name}`, model: chosenModel, apiKey: chosenKey, signal });
                    const result = await raster(generated.bytes, generated.type, pixels); api.core.check(signal);
                    const job = { ...result, node, model: generated.model, sourceBytes: generated.bytes.length }; jobs.push(job);
                    const row = element('div', null, 'flow-agent-preview'); const url = URL.createObjectURL(new Blob([result.bytes])); previewURLs.push(url);
                    const image = element('img'); image.src = url; image.alt = `Generated preview for ${node.name}`;
                    const info = element('div'); info.append(element('strong', node.name), element('p', `${result.width} × ${result.height} · ${PolySize.format(generated.bytes.length)} model output → ${PolySize.format(result.bytes.length)} carrier`, 'flow-muted'));
                    if (generated.usage?.cost != null) info.append(element('p', `Reported generation cost: $${generated.usage.cost}`, 'flow-muted'));
                    row.append(image, info); previews.append(row);
                }
                plan.textContent = `${jobs.length} carrier previews ready. Apply to attach them to the selected layers.`;
            });
            running = false; generate.disabled = false; stop.disabled = true; apply.disabled = !jobs.length;
        }, 'primary', 'flow-agent-generate');
        host.addEventListener('close', () => { if (running) api.cancel(); for (const url of previewURLs) URL.revokeObjectURL(url); }, { once: true });
    }
    function apiStatus(message) { api.status?.(message); progress = message; updateProgress(); }
    function updateProgress() {
        const output = $('flow-progress-text');
        if (output) output.textContent = progress.startsWith('Building and validating') ? progress.replace('Building and validating', 'Creating') : progress || 'Preparing your image…';
    }
    function render() {
        if (!api) return;
        const root = api.getRoot();
        if (knownRoot !== root) { knownRoot = root; current = root; folder = ''; }
        if (!walk(root).includes(current)) { current = root; folder = ''; }
        for (const url of urls) URL.revokeObjectURL(url); urls = [];
        const host = $('poly-flow'), inlineEditor = $('poly-flow-dialog');
        if (previousNode && previousNode !== current && inlineEditor.open) inlineEditor.close();
        if (host.contains(inlineEditor)) $('polyglot-panel').append(inlineEditor);
        host.replaceChildren();
        const frame = element('div', null, 'flow-frame'); host.append(frame);
        const top = element('header', null, 'flow-topbar'); frame.append(top);
        top.inert = working;
        {
            const breadcrumb = element('nav', null, 'flow-breadcrumb'); breadcrumb.setAttribute('aria-label', 'Current image');
            const chain = []; for (let n = current; n; n = n.parent) chain.push(n);
            for (const node of chain.reverse()) action(breadcrumb, node.name.split('/').pop(), () => { current = node; folder = ''; render(); }, 'text');
            if (folder) breadcrumb.append(element('span', folder, 'flow-muted')); top.append(breadcrumb);
        }
        const quick = element('div', null, 'flow-quick-actions'); top.append(quick);
        action(quick, 'Load example', showExamples, 'text', 'flow-working-examples');
        const menu = element('details', null, 'flow-project-menu'); menu.append(element('summary', 'New / open'));
        const items = element('div', null, 'flow-menu-items'); menu.append(items); quick.append(menu);
        action(items, 'Create polyglot', start, 'quiet');
        const open = uploadInput(items, 'flow-menu-open-file', 'image/png,image/jpeg,.zip', false, async files => { if (files[0]) await api.importFile(files[0]); });
        action(items, 'Open polyglot', () => open.click());
        const controls = element('fieldset', null, 'flow-controls'); controls.disabled = working; frame.append(controls);
        if (failure) { const error = element('p', failure, 'flow-error'); error.setAttribute('role', 'alert'); controls.append(error); }
        {
            const measured = PolySize.measure(root);
            if (!baselines.has(root)) baselines.set(root, measured.total);
            const advice = PolySize.advisory(measured, baselines.get(root));
            if (advice) { const notice = element('div', null, 'flow-size-notice'); notice.append(element('span', advice)); action(notice, 'Inspect size map', sizeMap, 'text'); controls.append(notice); }
        }
        const content = element('main', null, 'flow-body'); controls.append(content);
        contents(content);
        const slot = $('flow-inline-' + activeEditorSection);
        if (slot) slot.append(inlineEditor);
        const moved = previousNode !== null && current !== previousNode;
        previousNode = current;
        if (moved && !working && !$('poly-advanced').open) queueMicrotask(() => {
            if (frame.getBoundingClientRect().top < 0) frame.scrollIntoView({ block: 'start', behavior: 'instant' });
            frame.querySelector('.flow-heading h2')?.focus({ preventScroll: true });
        });
        if (working) {
            const overlay = element('div', null, 'flow-progress'); overlay.setAttribute('role', 'status');
            const spinner = element('span', null, 'flow-spinner'); spinner.setAttribute('aria-hidden', 'true'); overlay.append(spinner);
            const text = element('p'); text.id = 'flow-progress-text'; overlay.append(text);
            action(overlay, 'Cancel', api.cancel, 'text', 'flow-cancel'); frame.append(overlay); updateProgress();
        }
    }
    window.PolyFlow = {
        init(bridge) {
            api = bridge; current = api.getRoot(); knownRoot = current;
            dismissOnBackdrop($('poly-advanced'));
            document.addEventListener('click', event => {
                for (const menu of document.querySelectorAll('#poly-flow details.flow-project-menu[open], #poly-flow details.flow-entry-menu[open]')) {
                    if (!menu.contains(event.target)) menu.open = false;
                }
            });
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape' && $('poly-flow-dialog').open && !working) $('poly-flow-dialog').close();
            });
            $('poly-flow-dialog').addEventListener('close', () => { if (lastFocus?.isConnected) lastFocus.focus(); render(); });
        },
        showTools(node) {
            current = node; folder = '';
            if (!expanded.has(node)) expanded.set(node, {});
            expanded.get(node).encoding = true; render();
            document.querySelector('.flow-inline-options[open] .poly-note')?.scrollIntoView({ block: 'nearest' });
        },
        render, status(message) {
            statusMessage = message;
            if (/^(Decoded |Local detection results)/.test(message)) {
                if (!expanded.has(current)) expanded.set(current, {});
                expanded.get(current).activity = true;
            }
            if (working) { progress = message; updateProgress(); } else render();
        },
        error: showError,
        setBusy(value) { working = value; if (value) { failure = ''; progress = ''; } render(); },
        projectLoaded() { if (!api) return; knownRoot = api.getRoot(); current = knownRoot; folder = ''; failure = ''; }
    };
})();
