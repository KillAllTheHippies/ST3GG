/* Browser-local artifact contracts, input ports and explicit one-shot transfers. */
(() => {
    'use strict';
    const inputs = new Map();
    const receiving = new Set();
    const mounted = new Map();
    function forMenus(action) { for (const [menu, place] of mounted) { if (!menu.isConnected) mounted.delete(menu); else action(menu, place); } }
    document.addEventListener('click', event => forMenus(menu => { if (!menu.contains(event.target)) menu.open = false; }));
    window.addEventListener('resize', () => forMenus((menu, place) => { if (menu.open) place(); }));
    const outputs = new Map();
    function publish(key, value) {
        outputs.set(key, value);
        document.dispatchEvent(new CustomEvent('st3gg-work-changed'));
        return value;
    }
    const sources = () => [...outputs.entries()].map(([id, value]) => ({ id, value }));
    function forget(id) { outputs.delete(id); document.dispatchEvent(new CustomEvent('st3gg-work-changed')); }
    function download(value) {
        const url = URL.createObjectURL(value.blob), link = document.createElement('a');
        link.href = url; link.download = value.name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function artifact({ blob, text, name, source, imageArchive = false }) {
        if (!(blob instanceof Blob) && typeof text !== 'string') throw new TypeError('An artifact needs a Blob or text.');
        return Object.freeze({
            kind: typeof text === 'string' ? 'text' : 'file',
            blob: blob || new Blob([text], { type: 'text/plain;charset=utf-8' }),
            text, name: name || 'output.bin', source: source || 'Result', imageArchive
        });
    }

    function register(input) {
        if (!input.id || inputs.has(input.id)) throw new Error('Input IDs must be unique.');
        for (const method of ['accepts', 'occupied', 'receive']) {
            if (typeof input[method] !== 'function') throw new TypeError(`Input needs ${method}().`);
        }
        inputs.set(input.id, Object.freeze({ available: () => true, ...input }));
    }

    function destinations(value) {
        return [...inputs.values()].filter(input => input.available() && input.accepts(value));
    }

    async function transfer(value, id, { replace = false } = {}) {
        const input = inputs.get(id);
        if (!input || !input.available() || !input.accepts(value)) throw new Error('This destination is unavailable for this output.');
        if (input.occupied() && !replace) return { needsReplacement: true, input };
        if (receiving.has(id)) throw new Error('This input is already receiving a file. Please wait for it to finish.');
        receiving.add(id);
        try { await input.receive(value); } finally { receiving.delete(id); }
        return { input };
    }

    // The same actions component can be mounted beside any result producer.
    function mount(host, produce) {
        const menu = document.createElement('details');
        menu.className = 'transfer-menu';
        const toggle = document.createElement('summary');
        toggle.textContent = 'Use in…';
        const choices = document.createElement('div');
        choices.className = 'transfer-choices';
        choices.setAttribute('aria-live', 'polite');
        menu.append(toggle, choices);
        host.append(menu);
        let revision = 0;
        const message = text => { const p = document.createElement('p'); p.textContent = text; choices.append(p); };
        const place = () => {
            choices.style.left = '0px';
            menu.classList.toggle('transfer-up', innerHeight - menu.getBoundingClientRect().bottom < choices.offsetHeight + 12);
            const rect = choices.getBoundingClientRect();
            const shift = Math.min(0, innerWidth - 16 - rect.right);
            choices.style.left = `${Math.max(16 - rect.left, shift)}px`;
        };
        mounted.set(menu, place); queueMicrotask(() => forMenus(() => {}));
        const button = (label, run) => {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
            b.className = 'btn btn-secondary'; b.onclick = run; choices.append(b); return b;
        };
        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') { menu.open = false; toggle.focus(); }
        });
        menu.addEventListener('toggle', async () => {
            const request = ++revision;
            if (!menu.open) return;
            choices.replaceChildren(); message('Preparing output…');
            try {
                const value = await produce();
                if (!menu.open || request !== revision) return;
                choices.replaceChildren();
                const options = destinations(value);
                if (!options.length) { message('No compatible destinations are available.'); place(); return; }
                async function send(input, replace = false) {
                    for (const b of choices.querySelectorAll('button')) b.disabled = true;
                    try {
                        const result = await transfer(value, input.id, { replace });
                        if (result.needsReplacement) {
                            choices.replaceChildren();
                            message(`${input.label} already has content. Replace that input? Other settings will be kept.`);
                            button('Replace input', () => send(input, true)).focus();
                            button('Cancel', () => { menu.open = false; toggle.focus(); });
                            place();
                        } else {
                            menu.open = false;
                            input.reveal?.(value);
                        }
                    } catch (error) {
                        choices.replaceChildren(); message(error.message);
                        button('Close', () => { menu.open = false; toggle.focus(); });
                        place();
                    }
                }
                const groups = new Map();
                for (const input of options) {
                    const b = button(input.labelFor?.(value) || input.label, () => send(input));
                    if (input.group) {
                        if (!groups.has(input.group)) {
                            const group = document.createElement('details'); group.className = 'transfer-group';
                            const heading = document.createElement('summary'); heading.textContent = input.group;
                            group.append(heading); choices.append(group); groups.set(input.group, group);
                        }
                        groups.get(input.group).append(b);
                    }
                }
                place();
            } catch (error) { choices.replaceChildren(); message(error.message); place(); }
        });
        return menu;
    }

    window.ST3GGTransfers = Object.freeze({ artifact, register, destinations, transfer, mount, publish, sources, forget, download,
        input: id => inputs.get(id), inputs: () => [...inputs.values()].filter(input => input.available()) });
})();
