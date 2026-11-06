/* Shared input picker and session output shelf. No payloads are persisted. */
(() => {
    'use strict';
    const T = ST3GGTransfers, $ = id => document.getElementById(id);
    let dialog, target, lastFocus, revision = 0;
    const descriptions = {
        encode: ['Encode', 'Choose a carrier and a payload. Reuse images, audio or text from Your work.'],
        decode: ['Decode', 'Extract a payload, then send the recovered text or file to another tool.'],
        analyze: ['Analyze', 'Inspect media and file structure. Continue with Decode or Agent using the same file.'],
        polyglot: ['Image + ZIP layers', 'Compose branching image-and-archive layers. Files and image payloads are independent.'],
        matryoshka: ['Nested image payloads', 'Wrap a secret inside successive steganographic image layers.'],
        godmode: ['SPECTER', 'Encode and decode with a channel cipher.'],
        textlab: ['Text Lab', 'Hide messages inside text and pass the output to other payload editors.'],
        aiagent: ['Agent', 'Reveal or conceal using your selected models. Transfers prepare inputs; you start the request.'],
        configuration: ['Configuration', 'One connection, with shared analysis, image and planning models.'],
        knowledgebase: ['Knowledgebase', 'Browse analysis guides, metadata acronyms and PNG chunk explanations.']
    };
    function el(tag, text, className) { const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; return e; }
    function button(label, run, host) { const b = el('button', label, 'btn btn-secondary'); b.type = 'button'; b.onclick = run; host.append(b); return b; }
    function close() { revision++; dialog.close(); lastFocus?.focus({ preventScroll: true }); }
    async function send(value) {
        const port = T.input(target);
        if (!port) return;
        let result;
        try {
            result = await T.transfer(value, target);
            if (result.needsReplacement) {
                const body = $('work-picker-body'); body.replaceChildren();
                body.append(el('p', `${port.label} already contains work. Replace this input? Other inputs and settings will be kept.`));
                button('Replace input', async () => {
                    try { await T.transfer(value, target, { replace: true }); close(); port.reveal?.(value); }
                    catch (error) { body.append(el('p', error.message, 'work-error')); }
                }, body);
                button('Cancel', close, body).focus();
            } else { close(); port.reveal?.(value); }
        } catch (error) { $('work-picker-body').prepend(el('p', error.message, 'work-error')); }
    }
    async function render() {
        const request = ++revision, body = $('work-picker-body'); body.replaceChildren();
        const input = target && T.input(target);
        $('work-picker-title').textContent = input ? input.label : 'Your work';
        const files = T.sources().filter(({ value }) => !input || input.available() && input.accepts(value));
        if (!files.length) body.append(el('p', input ? 'No compatible work is available yet. Choose a file below, or create a result in another tool.' : 'Your uploaded files and completed results appear here for reuse across tools. Nothing has been added yet.', 'work-empty'));
        for (const { id, value } of files) {
            const row = el('article', null, 'work-item');
            const label = el('div'); label.append(el('strong', value.name), el('p', `${value.source} · ${formatSize(value.blob.size)} · ${value.kind === 'text' ? 'Text' : value.blob.type || 'File'}`));
            row.append(label); const controls = el('div', null, 'result-actions'); row.append(controls);
            if (input) button('Use this', () => send(value), controls);
            else {
                T.mount(controls, () => value);
                button('Download', () => T.download(value), controls);
                button('Remove', () => { T.forget(id); render(); }, controls);
            }
            body.append(row);
        }
        const upload = el('label', 'Choose a file', 'work-upload');
        const picker = el('input'); picker.type = 'file';
        if (input?.accept) picker.accept = input.accept;
        picker.onchange = async () => {
            if (!picker.files[0]) return;
            try {
                const value = await ST3GGWorkflow.fromFile(picker.files[0], 'Uploaded file');
                if (input && !input.accepts(value)) throw new Error('This file is incompatible with the selected input.');
                T.publish('upload:' + value.name, value);
                if (input) await send(value); else await render();
            } catch (error) { body.prepend(el('p', error.message, 'work-error')); }
        };
        upload.append(picker); body.append(upload);
        if (input?.accepts(T.artifact({ blob: new Blob([], { type: 'image/png' }) })) && window.PolyImageLibrary) {
            const saved = el('details', null, 'work-saved'); saved.append(el('summary', 'Saved carrier images')); body.append(saved);
            const items = await PolyImageLibrary.list();
            if (request !== revision) return;
            if (!items.length) saved.append(el('p', 'No carrier images saved in this browser.'));
            for (const item of items) {
                const value = ST3GGWorkflow.fromBytes(item.bytes, item.name, 'Saved carrier');
                if (input.accepts(value)) button(item.name, () => send(value), saved);
            }
            if (PolyImageLibrary.warning) saved.append(el('p', PolyImageLibrary.warning));
        }
    }
    function open(id = null) {
        target = id; lastFocus = document.activeElement;
        if (!dialog.open) dialog.showModal();
        render().catch(error => $('work-picker-body').append(el('p', error.message, 'work-error')));
    }
    function inputButton(host, id, label = 'Use existing…') {
        const b = button(label, () => open(id), host); b.classList.add('work-reuse'); return b;
    }
    document.addEventListener('DOMContentLoaded', () => {
        const bar = el('div', null, 'workflow-bar'); bar.id = 'workflow-bar';
        const scope = el('div'); scope.append(el('strong', '', 'workflow-name'), el('p', '', 'workflow-description'));
        bar.append(scope); button('Your work · 0', () => open(), bar).id = 'work-count';
        document.querySelector('.tabs').after(bar);
        const refresh = () => {
            const tab = document.querySelector('.tabs .tab.active')?.dataset.tab || 'encode';
            const [name, description] = descriptions[tab] || descriptions.encode;
            bar.querySelector('strong').textContent = name; bar.querySelector('p').textContent = description;
            $('work-count').textContent = `Your work · ${T.sources().length}`;
        };
        document.querySelectorAll('.tabs .tab').forEach(tab => tab.addEventListener('click', refresh));
        document.addEventListener('st3gg-work-changed', refresh); refresh();
        dialog = el('dialog', null, 'work-picker'); dialog.id = 'work-picker'; dialog.setAttribute('aria-labelledby', 'work-picker-title');
        const heading = el('div', null, 'work-picker-heading'), title = el('h2', 'Your work'); title.id = 'work-picker-title';
        heading.append(title); button('Close', close, heading);
        const body = el('div'); body.id = 'work-picker-body'; dialog.append(heading, body); document.body.append(dialog);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    });
    window.ST3GGWorkbench = Object.freeze({ open, inputButton });
})();
